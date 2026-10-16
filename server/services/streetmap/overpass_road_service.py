"""
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 """

"""Overpass road data: one query per bbox against the public Overpass API.

Retry policy is fail-fast: short timeout, immediate switch to the next
endpoint on any failure (including 429 — re-hitting a rate-limited endpoint
is self-harm). Endpoints are tested in parallel on launch and whenever a
timeout occurs to ensure the fastest responsive mirror is always prioritized.
A total failure RAISES rather than returning [] — an error must never look
like a roadless area.
"""

import concurrent.futures
import threading
import time
from typing import List, Optional, Tuple

import requests

from server.core.cache import road_cache, query_audit
from server.core.config import config
from server.core.logger import logger
from server.services.streetmap.base import RoadDataSource

DEFAULT_OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
OVERPASS_ENDPOINTS = DEFAULT_OVERPASS_ENDPOINTS

# Navigable street classes for pedestrians/vehicles (indexed allowlist query).
# Pedestrian plazas/malls stay IN; footways/sidewalks/cycleways/service roads stay OUT.
NAVIGABLE_HIGHWAYS = (
    "residential|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|"
    "unclassified|living_street|pedestrian"
)
NAVIGABLE_HIGHWAY_SET = frozenset(NAVIGABLE_HIGHWAYS.split("|"))
EXCLUDED_HIGHWAYS = (
    "motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|"
    "footway|path|cycleway|steps|corridor|bridleway|via_ferrata"
)
OSM_MAP_API_URL = "https://api.openstreetmap.org/api/0.6/map.json"

# One Overpass request in flight at a time, server-wide: the free tier
# rate-limits per client, and concurrent calls are how we earned 429s.
_overpass_lock = threading.Lock()


def probe_endpoint(endpoint: str, timeout_s: float = 4.0) -> Tuple[str, Optional[float]]:
    """Probes a single Overpass endpoint with a minimal query to measure latency.

    Returns:
        (endpoint, latency_in_seconds) if successful, or (endpoint, None) on failure.
    """
    probe_query = "[out:json][timeout:3];out;"
    try:
        t0 = time.time()
        resp = requests.post(
            endpoint,
            data={"data": probe_query},
            headers={"User-Agent": "StreetReaderAI/1.0"},
            timeout=timeout_s,
        )
        if resp.status_code == 200 and isinstance(resp.json(), dict):
            return endpoint, time.time() - t0
    except Exception as e:
        try:
            logger.debug(f"Overpass probe failed for {endpoint}: {e}")
        except Exception:
            pass
    return endpoint, None


def select_fastest_endpoint(endpoints: Optional[List[str]] = None, timeout_s: float = 4.0) -> List[str]:
    """Tests candidate Overpass endpoints in parallel and returns immediately with the first responsive server.

    The first server to respond is guaranteed to be the fastest. Remaining endpoints
    are appended as fallbacks without waiting for slower or unresponsive mirrors to time out.
    If all probes fail, the original candidate order is retained.
    """
    candidate_endpoints = endpoints if endpoints is not None else getattr(config, "OVERPASS_ENDPOINTS", DEFAULT_OVERPASS_ENDPOINTS)
    if not candidate_endpoints:
        return []
    if len(candidate_endpoints) <= 1:
        return list(candidate_endpoints)

    logger.info(f"Probing {len(candidate_endpoints)} Overpass endpoints in parallel (first to respond wins)...")
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=len(candidate_endpoints))
    winner: Optional[str] = None
    winner_latency: Optional[float] = None
    try:
        futures = {
            executor.submit(probe_endpoint, ep, timeout_s): ep for ep in candidate_endpoints
        }
        for future in concurrent.futures.as_completed(futures):
            ep, latency = future.result()
            if latency is not None:
                winner = ep
                winner_latency = latency
                break
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    if winner:
        remaining = [ep for ep in candidate_endpoints if ep != winner]
        sorted_endpoints = [winner] + remaining
        logger.info(
            f"Overpass endpoint probe complete. First responder: {winner} in {winner_latency:.2f}s. "
            f"Proceeding immediately without waiting for slower mirrors."
        )
        return sorted_endpoints
    else:
        logger.warning("All Overpass endpoint probes timed out or failed. Retaining original endpoint order.")
        return list(candidate_endpoints)


class OverpassRoadService(RoadDataSource):
    def __init__(
        self,
        timeout_s: Optional[float] = None,
        http_timeout_s: Optional[float] = None,
        endpoints: Optional[List[str]] = None,
        probe_on_init: bool = False,
    ):
        self.timeout_s = timeout_s if timeout_s is not None else getattr(config, "OVERPASS_TIMEOUT_S", 30.0)
        self.http_timeout_s = http_timeout_s if http_timeout_s is not None else getattr(config, "OVERPASS_HTTP_TIMEOUT_S", 30.0)
        self.endpoints = list(endpoints or getattr(config, "OVERPASS_ENDPOINTS", DEFAULT_OVERPASS_ENDPOINTS))
        if probe_on_init and self.endpoints:
            self.endpoints = select_fastest_endpoint(self.endpoints)
        self.active_endpoint = self.endpoints[0]

    def rotate_to_next_endpoint(self, failed_endpoint: Optional[str] = None) -> str:
        """Rotates to the next server in the endpoint list and stays with it until that one times out."""
        if len(self.endpoints) > 1:
            curr = failed_endpoint or self.active_endpoint
            try:
                curr_idx = self.endpoints.index(curr)
                next_idx = (curr_idx + 1) % len(self.endpoints)
            except ValueError:
                next_idx = 0
            self.active_endpoint = self.endpoints[next_idx]
            logger.info(f"Switched active Overpass endpoint to: {self.active_endpoint}")
        return self.active_endpoint

    def swap_to_fastest_endpoint(self, *args, **kwargs) -> str:
        """Sequential rollover alias for backward compatibility."""
        failed = kwargs.get("failed_endpoint") or (args[1] if len(args) > 1 else None)
        return self.rotate_to_next_endpoint(failed_endpoint=failed)

    def select_fastest_endpoint(self, *args, **kwargs) -> str:
        """Sequential rollover alias for backward compatibility."""
        return self.rotate_to_next_endpoint()

    def get_ways(self, min_lat: float, min_lng: float, max_lat: float, max_lng: float
                 ) -> List[dict]:
        cache_key = (round(min_lat, 5), round(min_lng, 5), round(max_lat, 5), round(max_lng, 5))
        cached = road_cache.get(cache_key)
        if cached is not None:
            query_audit.record_cache_hit("overpass")
            logger.info(f"Overpass: {len(cached)} ways from cache (0.0s)")
            return cached

        bbox_str = f"{min_lat},{min_lng},{max_lat},{max_lng}"
        query_audit.record_external("overpass", f"{cache_key[0]},{cache_key[1]},{cache_key[2]},{cache_key[3]}")
        query = (
            f"[out:json][timeout:{int(self.timeout_s)}];"
            f"way({bbox_str})[\"highway\"~\"^({NAVIGABLE_HIGHWAYS})$\"];"
            f"out body geom qt;"
        )
        max_attempts = len(self.endpoints)
        for attempt in range(max_attempts):
            endpoint = self.active_endpoint
            try:
                t0 = time.time()
                resp = requests.post(
                    endpoint, data={"data": query},
                    headers={"User-Agent": "StreetReaderAI/1.0"},
                    timeout=self.http_timeout_s,
                )
                resp.raise_for_status()
                elements = resp.json().get("elements", []) or []
                logger.info(f"Overpass: {len(elements)} ways in {time.time() - t0:.1f}s from {endpoint}")
                road_cache.put(cache_key, elements)
                return elements
            except Exception as e:
                import json
                is_swap_trigger = (
                    isinstance(e, requests.Timeout)
                    or isinstance(e, (json.JSONDecodeError, ValueError))
                    or (
                        isinstance(e, requests.HTTPError)
                        and e.response is not None
                        and e.response.status_code in (429, 504)
                    )
                )
                if is_swap_trigger and attempt < max_attempts - 1:
                    logger.warning(f"Overpass failure ({e}) at {endpoint}. Switching to next endpoint...")
                    self.rotate_to_next_endpoint(failed_endpoint=endpoint)
                    continue
                logger.error(f"Overpass request failed at {endpoint}: {e}")
                raise


class OsmMapApiRoadService(RoadDataSource):
    """Fast small-bbox road source backed by the official OpenStreetMap v0.6
    `/api/0.6/map.json` endpoint (Fastly CDN).

    Unlike public Overpass QL mirrors—which frequently rate-limit or time out
    evaluating regex queries—the OSM v0.6 map endpoint is purpose-built for
    small bounding boxes (~300m x 300m) and returns all ways and their full
    node geometries in ~1-2s. Returns None on any error so RouteProvider
    transparently falls back to OverpassRoadService.
    """

    def __init__(self, endpoint: str = OSM_MAP_API_URL, http_timeout_s: float = 10.0):
        self.endpoint = endpoint
        self.http_timeout_s = http_timeout_s

    def get_ways(self, min_lat: float, min_lng: float, max_lat: float, max_lng: float
                 ) -> Optional[List[dict]]:
        cache_key = (round(min_lat, 5), round(min_lng, 5), round(max_lat, 5), round(max_lng, 5))
        cached = road_cache.get(cache_key)
        if cached is not None:
            query_audit.record_cache_hit("overpass")
            logger.info(f"OsmMapApi: {len(cached)} ways from cache (0.0s)")
            return cached

        # OSM v0.6 map API uses bbox = min_lng,min_lat,max_lng,max_lat (left,bottom,right,top)
        bbox_param = f"{min_lng},{min_lat},{max_lng},{max_lat}"
        query_audit.record_external("overpass", f"osm06:{cache_key[0]},{cache_key[1]},{cache_key[2]},{cache_key[3]}")
        try:
            t0 = time.time()
            resp = requests.get(
                self.endpoint,
                params={"bbox": bbox_param},
                headers={
                    "User-Agent": "StreetReaderAI/1.0",
                    "Accept": "application/json",
                },
                timeout=self.http_timeout_s,
            )
            resp.raise_for_status()
            elements = (resp.json() or {}).get("elements") or []
            nodes = {
                el["id"]: (el["lat"], el["lon"])
                for el in elements
                if el.get("type") == "node" and "id" in el and "lat" in el and "lon" in el
            }
            ways: List[dict] = []
            for el in elements:
                if el.get("type") != "way":
                    continue
                tags = el.get("tags") or {}
                if tags.get("highway") not in NAVIGABLE_HIGHWAY_SET:
                    continue
                node_ids = [nid for nid in (el.get("nodes") or []) if nid in nodes]
                if len(node_ids) < 2:
                    continue
                ways.append({
                    "type": "way",
                    "id": el["id"],
                    "nodes": node_ids,
                    "tags": tags,
                    "geometry": [{"lat": nodes[nid][0], "lon": nodes[nid][1]} for nid in node_ids],
                })
            logger.info(f"OsmMapApi: {len(ways)} navigable ways in {time.time() - t0:.2f}s")
            road_cache.put(cache_key, ways)
            return ways
        except Exception as e:
            logger.warning(f"OsmMapApi failed ({e}); falling back to OverpassRoadService.")
            return None
