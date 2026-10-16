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

"""Panoramax STAC API provider.

Queries any Panoramax instance (defaults to the global federated metacatalog
`https://api.panoramax.xyz/api`). Supports server-side 360-degree filtering
(`filter="field_of_view=360"`), extracts sequence (`collection`) and native
`prev`/`next` STAC links, and caches metadata from bbox searches so subsequent
`get_metadata` / `get_image` calls make zero redundant metadata requests.
"""

import base64
from datetime import datetime
import pickle
from typing import List, Optional

import requests

from server.core.cache import image_cache, metadata_cache, query_audit, singleflight, window_cache
from server.core.config import config
from server.core.exceptions import APIException
from server.core.logger import logger
from server.core.models import LatLng, LocationMetadata
from server.services.imagery.base import ImageryProvider
from server.services.imagery.image_utils import crop_panorama


def _iso_to_epoch_ms(raw: object) -> str:
    """Normalizes ISO-8601 timestamps or numeric strings to epoch-ms string."""
    if not raw:
        return ""
    s = str(raw).strip()
    if s.isdigit():
        return s
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return str(int(dt.timestamp() * 1000))
    except Exception:
        return s


class PanoramaxProvider(ImageryProvider):
    """Panoramax STAC API client. Contract with the navigation layer: a failed
    fetch RAISES (503) rather than returning [] and masquerading as an empty street."""

    provider_name = "panoramax"

    def __init__(
        self,
        default_fov: int = 120,
        base_url: Optional[str] = None,
        panos_only: bool = True,
    ):
        self.default_fov = default_fov
        self.base_url = (
            base_url
            or getattr(config, "PANORAMAX_BASE_URL", "https://api.panoramax.xyz/api")
        ).rstrip("/")
        self.panos_only = panos_only
        self._mem_meta: dict[str, LocationMetadata] = {}

    def _meta_key(self, image_id: str) -> str:
        return f"panoramax:{image_id}"

    def _parse_feature(self, feat: dict, cache_meta: bool = False) -> Optional[LocationMetadata]:
        if not isinstance(feat, dict):
            return None
        image_id = feat.get("id")
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if not image_id or len(coords) < 2:
            return None

        props = feat.get("properties") or {}
        orient = props.get("pers:interior_orientation") or {}
        fov = orient.get("field_of_view")
        if fov is not None:
            try:
                is_pano = int(float(fov)) >= 360
            except (TypeError, ValueError):
                is_pano = False
        else:
            dims = orient.get("sensor_array_dimensions") or []
            is_pano = bool(len(dims) == 2 and dims[1] and abs(dims[0] / dims[1] - 2.0) < 0.15)

        heading = float(props.get("view:azimuth") or 0.0)
        capture_time = _iso_to_epoch_ms(props.get("datetime") or props.get("datetimetz") or "")
        seq_id = str(feat.get("collection")) if feat.get("collection") else None

        assets = feat.get("assets") or {}
        thumb_url = (
            (assets.get("hd") or {}).get("href")
            or (assets.get("sd") or {}).get("href")
            or props.get("geovisio:image")
            or (assets.get("thumb") or {}).get("href")
        )

        prev_id: Optional[str] = None
        next_id: Optional[str] = None
        for link in feat.get("links") or []:
            if not isinstance(link, dict):
                continue
            rel = link.get("rel")
            lid = link.get("id")
            if rel == "prev" and lid:
                prev_id = str(lid)
            elif rel == "next" and lid:
                next_id = str(lid)

        meta = LocationMetadata(
            imageId=str(image_id),
            coordinates=LatLng(latitude=float(coords[1]), longitude=float(coords[0])),
            captureTime=capture_time,
            heading=heading,
            isPano=is_pano,
            sequenceId=seq_id,
            thumbUrl=thumb_url,
            prevImageId=prev_id,
            nextImageId=next_id,
            provider="panoramax",
        )
        if len(self._mem_meta) >= 4096:
            self._mem_meta.clear()
        self._mem_meta[meta.imageId] = meta
        if cache_meta:
            metadata_cache.put(self._meta_key(meta.imageId), meta.model_dump())
        return meta

    def get_metadata(self, image_id: str) -> Optional[LocationMetadata]:
        mem = self._mem_meta.get(str(image_id))
        if mem is not None:
            query_audit.record_cache_hit("panoramax_meta")
            return mem
        cached = metadata_cache.get(self._meta_key(image_id))
        if cached is not None:
            query_audit.record_cache_hit("panoramax_meta")
            meta_obj = LocationMetadata(**cached)
            self._mem_meta[str(image_id)] = meta_obj
            return meta_obj

        try:
            timeout_s = getattr(config, "PANORAMAX_METADATA_TIMEOUT_S", 15.0)
            query_audit.record_external("panoramax_meta", str(image_id))
            resp = requests.get(
                f"{self.base_url}/search",
                params={"ids": str(image_id), "limit": 1},
                timeout=timeout_s,
            )
            if resp.status_code != 200:
                return None
            features = (resp.json() or {}).get("features") or []
            if features:
                return self._parse_feature(features[0], cache_meta=True)
        except Exception as e:
            logger.warning(f"Panoramax get_metadata({image_id}) failed: {e}")
        return None

    def get_sequence(self, sequence_id: str) -> List[LocationMetadata]:
        """Fetch all images belonging to a Panoramax STAC collection (`sequence_id`)
        and cache the full sequence in `window_cache`."""
        if not sequence_id:
            return []
        seq_str = str(sequence_id)
        seq_key = ("panoramax", "seq", seq_str)
        cached = window_cache.get(seq_key)
        if cached is not None:
            query_audit.record_cache_hit("panoramax_seq")
            return [LocationMetadata(**d) if isinstance(d, dict) else d for d in cached]

        def _do_fetch() -> List[LocationMetadata]:
            again = window_cache.get(seq_key)
            if again is not None:
                query_audit.record_cache_hit("panoramax_seq")
                return [LocationMetadata(**d) if isinstance(d, dict) else d for d in again]
            timeout_s = getattr(config, "PANORAMAX_METADATA_TIMEOUT_S", 15.0)
            query_audit.record_external("panoramax_seq", seq_str)
            try:
                resp = requests.get(
                    f"{self.base_url}/collections/{seq_str}/items",
                    params={"limit": 500},
                    timeout=timeout_s,
                )
                if getattr(resp, "status_code", 500) != 200:
                    return []
                features = (resp.json() or {}).get("features") or []
            except Exception as e:
                logger.warning(f"Panoramax get_sequence({seq_str}) failed: {e}")
                return []

            results: List[LocationMetadata] = []
            seen: set = set()
            for feat in features:
                meta = self._parse_feature(feat)
                if meta is None or meta.imageId in seen:
                    continue
                if self.panos_only and not meta.isPano:
                    continue
                seen.add(meta.imageId)
                results.append(meta)
            window_cache.put(seq_key, [m.model_dump() for m in results])
            return results

        return singleflight(f"panoramax_seq:{self.panos_only}:{seq_str}", _do_fetch)

    def get_metadata_bbox(
        self, min_lat: float, min_lng: float, max_lat: float, max_lng: float
    ) -> List[LocationMetadata]:
        return self._fetch_bbox(min_lng, min_lat, max_lng, max_lat)

    def _fetch_bbox(
        self, min_lng: float, min_lat: float, max_lng: float, max_lat: float
    ) -> List[LocationMetadata]:
        bbox_str = f"{min_lng},{min_lat},{max_lng},{max_lat}"
        sf_key = f"panoramax_bbox:{self.panos_only}:{round(min_lng, 6)},{round(min_lat, 6)},{round(max_lng, 6)},{round(max_lat, 6)}"

        def _do_bbox() -> List[LocationMetadata]:
            params: dict = {
                "bbox": bbox_str,
                "limit": 500,
            }
            if self.panos_only:
                params["filter"] = "field_of_view=360"

            timeout_s = getattr(config, "PANORAMAX_METADATA_TIMEOUT_S", 15.0)
            resp = None
            last_err: Optional[Exception] = None
            query_audit.record_external("panoramax_bbox", f"{round(min_lat, 5)},{round(min_lng, 5)},{round(max_lat, 5)},{round(max_lng, 5)}")
            for attempt in range(2):
                try:
                    resp = requests.get(
                        f"{self.base_url}/search",
                        params=params,
                        timeout=timeout_s,
                    )
                    break
                except Exception as e:
                    logger.warning(f"Panoramax bbox attempt {attempt + 1}/2 failed: {e}")
                    last_err = e

            if resp is None:
                raise APIException(f"Imagery service unavailable (timeout): {last_err}", 503)
            if resp.status_code != 200:
                logger.warning(f"Panoramax bbox {bbox_str} status={resp.status_code} body={resp.text[:120]}")
                raise APIException(f"Imagery service error (HTTP {resp.status_code})", 503)

            payload = resp.json() or {}
            features = payload.get("features") or []
            if not features and self.panos_only and "filter" in params:
                # Fallback to non-360 sequences if this region has no 360 spheres on Panoramax
                fallback_params = {"bbox": bbox_str, "limit": 500}
                try:
                    fb_resp = requests.get(f"{self.base_url}/search", params=fallback_params, timeout=timeout_s)
                    if fb_resp.status_code == 200:
                        features = (fb_resp.json() or {}).get("features") or []
                except Exception as e:
                    logger.debug(f"Panoramax flat fallback failed: {e}")

            results: List[LocationMetadata] = []
            seen: set = set()
            for feat in features:
                meta = self._parse_feature(feat)
                if meta is None or meta.imageId in seen:
                    continue
                seen.add(meta.imageId)
                results.append(meta)
            return results

        return singleflight(sf_key, _do_bbox)

    def get_image(self, image_id: str, heading: float = 0, pitch: float = 0) -> Optional[dict]:
        try:
            cache_key = f"panoramax_hd:{image_id}"
            cached = image_cache.get(cache_key)
            img_bytes = None
            img_heading = 0.0
            is_pano = False
            from_cache = False
            if cached is not None:
                c_bytes, c_heading, c_pano = cached
                if isinstance(c_bytes, (bytes, bytearray)) and c_bytes and not (
                    c_bytes.startswith(b"<html") or c_bytes.startswith(b"<!DOCTYPE")
                ):
                    query_audit.record_cache_hit("panoramax_image")
                    img_bytes, img_heading, is_pano = c_bytes, c_heading, c_pano
                    from_cache = True

            if img_bytes is None:
                meta = self.get_metadata(image_id)
                if meta is None or not meta.thumbUrl:
                    return None
                img_heading = meta.heading
                is_pano = meta.isPano
                timeout_s = getattr(config, "PANORAMAX_IMAGE_DOWNLOAD_TIMEOUT_S", 20.0)
                query_audit.record_external("panoramax_image", str(image_id))
                img_resp = requests.get(meta.thumbUrl, timeout=timeout_s)
                if getattr(img_resp, "status_code", 200) != 200:
                    return None
                img_bytes = img_resp.content
                if not img_bytes or img_bytes.startswith(b"<html") or img_bytes.startswith(b"<!DOCTYPE"):
                    return None

            if is_pano:
                cropped = crop_panorama(
                    img_bytes,
                    heading,
                    img_heading,
                    self.default_fov,
                    output_width=1440,
                    output_height=1080,
                    pitch_deg=pitch,
                )
                if not from_cache:
                    image_cache.put(cache_key, (img_bytes, img_heading, is_pano), size_bytes=len(img_bytes))
                return {
                    "image": base64.b64encode(cropped).decode("utf-8"),
                    "imageId": image_id,
                    "actualHeading": heading,
                }
            if not from_cache:
                image_cache.put(cache_key, (img_bytes, img_heading, is_pano), size_bytes=len(img_bytes))
            return {
                "image": base64.b64encode(img_bytes).decode("utf-8"),
                "imageId": image_id,
                "actualHeading": img_heading,
            }
        except Exception as e:
            logger.warning(f"Panoramax get_image({image_id}) failed: {e}")
            return None
