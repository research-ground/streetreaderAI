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

import base64
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

import requests

from server.core.cache import image_cache
from server.core.config import config
from server.core.exceptions import APIException
from server.core.logger import logger
from server.core.models import LatLng, LocationMetadata
from server.services.imagery.image_utils import crop_panorama


class MapillaryProvider:
    """Mapillary Graph API client. Contract with the navigation layer: a
    failed fetch RAISES (503) — it must never return [] and masquerade as an
    empty street (design ledger #5 in server/routing/route_provider.py)."""

    def __init__(self, client_token: str, default_fov: int = 120, base_url: Optional[str] = None):
        self.client_token = client_token
        self.default_fov = default_fov
        self.base_url = (base_url or config.MAPILLARY_BASE_URL).rstrip('/')

    def get_metadata(self, image_id: str) -> Optional[LocationMetadata]:
        try:
            resp = requests.get(f"{self.base_url}/{image_id}", params={
                "access_token": self.client_token,
                "fields": "id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence",
            }, timeout=10).json()
            if 'geometry' in resp:
                return LocationMetadata(
                    coordinates=LatLng(latitude=resp['geometry']['coordinates'][1], longitude=resp['geometry']['coordinates'][0]),
                    imageId=str(resp['id']),
                    captureTime=str(resp.get('captured_at', '')),
                    heading=(resp.get('computed_compass_angle') or resp.get('compass_angle') or 0.0),
                    isPano=bool(resp.get('is_pano', False)),
                    sequenceId=str(resp.get('sequence')) if resp.get('sequence') else None,
                )
        except Exception: pass
        return None

    def get_metadata_bbox(self, min_lat: float, min_lng: float, max_lat: float, max_lng: float) -> List[LocationMetadata]:
        return self._fetch_bbox(min_lng, min_lat, max_lng, max_lat)

    def _fetch_bbox(self, min_lng: float, min_lat: float, max_lng: float, max_lat: float, depth: int = 0) -> List[LocationMetadata]:
        """Fetch every Mapillary image in the given bbox. If Mapillary complains
        that we're asking for too much data (dense urban tiles hit this) or the
        response comes back at the 2000-item cap, we recursively split the bbox
        into four quadrants and try each. Depth capped at 3 (=64 sub-tiles) so
        we don't recurse forever on genuinely huge queries."""
        params = {
            "access_token": self.client_token,
            "fields": "id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence",
            "bbox": f"{min_lng},{min_lat},{max_lng},{max_lat}",
            "limit": 2000,
        }
        # A failed fetch must NOT look like an empty street — returning [] here
        # made transient timeouts present as "no imagery, direction closed" and
        # stranded the user mid-block (evidence: way_6484406_off_46, 7th Ave
        # Seattle). One retry, then fail the whole request loudly so the client
        # can show an error and retry.
        resp = None
        last_err: Optional[Exception] = None
        for attempt in range(2):
            try:
                resp = requests.get(f"{self.base_url}/images", params=params, timeout=config.MAPILLARY_METADATA_TIMEOUT_S)
                break
            except Exception as e:
                logger.warning(f"Mapillary bbox attempt {attempt + 1}/2 failed: {e}")
                last_err = e
        if resp is None:
            raise APIException(f"Imagery service unavailable (timeout): {last_err}", 503)

        needs_split = False
        data: List[dict] = []
        # Mapillary's "please reduce" refusal can come back as 200 (error in body),
        # 400, or 500. In every case the body has {"error": {"message": ...}}.
        # We always try to parse the body first and then decide.
        payload: dict = {}
        try:
            payload = resp.json() or {}
        except Exception:
            payload = {}
        err_msg = ((payload.get("error") or {}).get("message") or "").lower() if isinstance(payload, dict) else ""
        if "reduce the amount of data" in err_msg:
            needs_split = True
        elif resp.status_code == 200:
            data = payload.get("data", []) or []
            if len(data) >= 2000:
                needs_split = True  # likely paginated / truncated
        else:
            # Same principle: an HTTP error is a failure, not an empty street.
            logger.warning(f"Mapillary bbox {params['bbox']} status={resp.status_code} body={err_msg or resp.text[:120]}")
            raise APIException(f"Imagery service error (HTTP {resp.status_code})", 503)

        if needs_split and depth < 3:
            mid_lat = (min_lat + max_lat) / 2
            mid_lng = (min_lng + max_lng) / 2
            quadrants = [
                (min_lng, min_lat, mid_lng, mid_lat),
                (mid_lng, min_lat, max_lng, mid_lat),
                (min_lng, mid_lat, mid_lng, max_lat),
                (mid_lng, mid_lat, max_lng, max_lat),
            ]
            # Fetch quadrants concurrently — dense downtown boxes split
            # recursively, and doing that serially dominated cold-load time.
            with ThreadPoolExecutor(max_workers=4) as pool:
                parts = list(pool.map(
                    lambda q: self._fetch_bbox(q[0], q[1], q[2], q[3], depth=depth + 1),
                    quadrants,
                ))
            all_meta: List[LocationMetadata] = [m for part in parts for m in part]
            # Dedup by image id (adjacent quads may occasionally overlap).
            seen: set = set()
            unique: List[LocationMetadata] = []
            for m in all_meta:
                if m.imageId in seen:
                    continue
                seen.add(m.imageId)
                unique.append(m)
            return unique
        if needs_split and depth >= 3:
            logger.warning(f"Mapillary bbox {params['bbox']} still saturated after 3 splits; returning what we have")

        results: List[LocationMetadata] = []
        for img in data:
            geom = img.get("geometry") or {}
            coords = geom.get("coordinates") or []
            if len(coords) < 2:
                continue
            results.append(LocationMetadata(
                coordinates=LatLng(latitude=coords[1], longitude=coords[0]),
                imageId=str(img.get("id")),
                captureTime=str(img.get("captured_at", "")),
                heading=(img.get("computed_compass_angle") or img.get("compass_angle") or 0.0),
                isPano=bool(img.get("is_pano", False)),
                sequenceId=str(img.get("sequence")) if img.get("sequence") else None,
            ))
        return results

    def get_image(self, image_id: str, heading: float = 0, pitch: float = 0) -> Optional[dict]:
        try:
            cached = image_cache.get(image_id)
            if cached is not None:
                img_bytes, img_heading, is_pano = cached
            else:
                resp = requests.get(f"{self.base_url}/{image_id}", params={
                    "access_token": self.client_token,
                    "fields": "compass_angle,computed_compass_angle,thumb_2048_url,is_pano",
                }, timeout=config.MAPILLARY_METADATA_TIMEOUT_S).json()

                img_heading = resp.get('computed_compass_angle') or resp.get('compass_angle') or 0.0
                thumb_url = resp.get('thumb_2048_url')
                if not thumb_url:
                    return None
                is_pano = bool(resp.get('is_pano', False))

                img_bytes = requests.get(thumb_url, timeout=config.MAPILLARY_IMAGE_DOWNLOAD_TIMEOUT_S).content
                image_cache.put(image_id, (img_bytes, img_heading, is_pano), size_bytes=len(img_bytes))

            if is_pano:
                cropped = crop_panorama(img_bytes, heading, img_heading, self.default_fov, output_width=1024, output_height=768)
                return {
                    "image": base64.b64encode(cropped).decode('utf-8'),
                    "imageId": image_id,
                    "actualHeading": heading,
                }
            # Flat images: return the source thumbnail as-is; camera facing is fixed.
            return {
                "image": base64.b64encode(img_bytes).decode('utf-8'),
                "imageId": image_id,
                "actualHeading": img_heading,
            }
        except Exception:
            return None

