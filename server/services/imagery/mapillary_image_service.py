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

from server.core.cache import image_cache, metadata_cache, query_audit, singleflight, window_cache
from server.core.config import config
from server.core.exceptions import APIException
from server.core.logger import logger
from server.core.models import LatLng, LocationMetadata
from server.services.imagery.base import ImageryProvider
from server.services.imagery.image_utils import crop_panorama


class MapillaryProvider(ImageryProvider):
    """Mapillary Graph API client. Contract with the navigation layer: a
    failed fetch RAISES (503) — it must never return [] and masquerade as an
    empty street (design ledger #5 in server/routing/route_provider.py)."""

    provider_name = "mapillary"

    def __init__(
        self,
        client_token: str,
        default_fov: int = 120,
        base_url: Optional[str] = None,
        panos_only: bool = True,
    ):
        self.client_token = client_token
        self.default_fov = default_fov
        self.base_url = (base_url or config.MAPILLARY_BASE_URL).rstrip('/')
        self.panos_only = panos_only

    def _meta_key(self, image_id: str) -> str:
        return f"mapillary:{image_id}"

    def get_metadata(self, image_id: str) -> Optional[LocationMetadata]:
        cached = metadata_cache.get(self._meta_key(image_id))
        if cached is not None:
            query_audit.record_cache_hit("mapillary_meta")
            return LocationMetadata(**cached)

        try:
            query_audit.record_external("mapillary_meta", str(image_id))
            resp = requests.get(f"{self.base_url}/{image_id}", params={
                "access_token": self.client_token,
                "fields": "id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence,thumb_original_url,thumb_2048_url",
            }, timeout=10).json()
            if 'geometry' in resp:
                meta = LocationMetadata(
                    coordinates=LatLng(latitude=resp['geometry']['coordinates'][1], longitude=resp['geometry']['coordinates'][0]),
                    imageId=str(resp['id']),
                    captureTime=str(resp.get('captured_at', '')),
                    heading=(resp.get('computed_compass_angle') or resp.get('compass_angle') or 0.0),
                    isPano=bool(resp.get('is_pano', False)),
                    sequenceId=str(resp.get('sequence')) if resp.get('sequence') else None,
                    thumbUrl=resp.get('thumb_original_url') or resp.get('thumb_2048_url'),
                    provider="mapillary",
                )
                metadata_cache.put(self._meta_key(meta.imageId), meta.model_dump())
                return meta
        except Exception:
            pass
        return None

    def get_sequence(self, sequence_id: str) -> List[LocationMetadata]:
        """Fetch all images belonging to a Mapillary sequence (`sequence_ids`)
        and cache the full sequence as a single entry in `window_cache`."""
        if not sequence_id:
            return []
        seq_str = str(sequence_id)
        seq_key = ("mapillary", "seq", seq_str)
        cached = window_cache.get(seq_key)
        if cached is not None:
            query_audit.record_cache_hit("mapillary_seq")
            return [LocationMetadata(**d) if isinstance(d, dict) else d for d in cached]

        def _do_fetch() -> List[LocationMetadata]:
            again = window_cache.get(seq_key)
            if again is not None:
                query_audit.record_cache_hit("mapillary_seq")
                return [LocationMetadata(**d) if isinstance(d, dict) else d for d in again]
            params = {
                "access_token": self.client_token,
                "sequence_ids": seq_str,
                "fields": "id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence",
                "limit": 500,
            }
            if self.panos_only:
                params["is_pano"] = "true"
            query_audit.record_external("mapillary_seq", seq_str)
            data = None
            for attempt in range(3):
                try:
                    resp = requests.get(
                        f"{self.base_url}/images",
                        params=params,
                        timeout=config.MAPILLARY_METADATA_TIMEOUT_S,
                    )
                    status_code = getattr(resp, "status_code", 500)
                    if status_code == 200:
                        payload = resp.json() or {}
                        data = payload.get("data") or []
                        break
                    logger.warning(f"Mapillary get_sequence({seq_str}) attempt {attempt + 1}/3 HTTP {status_code}")
                    if status_code < 500 and status_code != 429:
                        break
                except Exception as e:
                    logger.warning(f"Mapillary get_sequence({seq_str}) attempt {attempt + 1}/3 failed: {e}")
            if data is None:
                return []

            results: List[LocationMetadata] = []
            for img in data:
                geom = img.get("geometry") or {}
                coords = geom.get("coordinates") or []
                if len(coords) < 2:
                    continue
                meta = LocationMetadata(
                    coordinates=LatLng(latitude=coords[1], longitude=coords[0]),
                    imageId=str(img.get("id")),
                    captureTime=str(img.get("captured_at", "")),
                    heading=(img.get("computed_compass_angle") or img.get("compass_angle") or 0.0),
                    isPano=bool(img.get("is_pano", False)),
                    sequenceId=str(img.get("sequence")) if img.get("sequence") else seq_str,
                    provider="mapillary",
                )
                results.append(meta)
            results.sort(
                key=lambda m: (
                    int(m.captureTime) if m.captureTime and m.captureTime.isdigit() else 0,
                    m.imageId,
                )
            )
            window_cache.put(seq_key, [m.model_dump() for m in results])
            return results

        return singleflight(f"mapillary_seq:{self.panos_only}:{seq_str}", _do_fetch)

    def get_metadata_bbox(self, min_lat: float, min_lng: float, max_lat: float, max_lng: float) -> List[LocationMetadata]:
        return self._fetch_bbox(min_lng, min_lat, max_lng, max_lat)

    def _fetch_bbox(self, min_lng: float, min_lat: float, max_lng: float, max_lat: float, depth: int = 0) -> List[LocationMetadata]:
        """Fetch Mapillary image metadata in the given bbox. Uses server-side
        `is_pano=true` filtering when panos_only is enabled and omits
        `thumb_2048_url` on bulk queries so thumbnail URLs are only requested
        at the final image-render step."""
        bbox_str = f"{min_lng},{min_lat},{max_lng},{max_lat}"
        sf_key = f"mapillary_bbox:{self.panos_only}:{round(min_lng, 6)},{round(min_lat, 6)},{round(max_lng, 6)},{round(max_lat, 6)}"

        def _do_bbox() -> List[LocationMetadata]:
            params = {
                "access_token": self.client_token,
                "fields": "id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence",
                "bbox": bbox_str,
                "limit": 500,
            }
            if self.panos_only:
                params["is_pano"] = "true"

            query_audit.record_external("mapillary_bbox", f"{round(min_lat, 5)},{round(min_lng, 5)},{round(max_lat, 5)},{round(max_lng, 5)}")
            resp = None
            last_err: Optional[Exception] = None
            for attempt in range(3):
                try:
                    resp = requests.get(f"{self.base_url}/images", params=params, timeout=config.MAPILLARY_METADATA_TIMEOUT_S)
                    if resp.status_code < 500 or attempt == 2:
                        break
                    try:
                        p_err = ((resp.json() or {}).get("error") or {}).get("message", "").lower()
                    except Exception:
                        p_err = ""
                    if "reduce the amount of data" in p_err:
                        break
                    logger.warning(f"Mapillary bbox HTTP {resp.status_code} on attempt {attempt + 1}/3; retrying...")
                except Exception as e:
                    logger.warning(f"Mapillary bbox attempt {attempt + 1}/3 failed: {e}")
                    last_err = e
            if resp is None:
                raise APIException(f"Imagery service unavailable (timeout): {last_err}", 503)

            data: List[dict] = []
            payload: dict = {}
            try:
                payload = resp.json() or {}
            except Exception:
                payload = {}
            err_msg = ((payload.get("error") or {}).get("message") or "").lower() if isinstance(payload, dict) else ""
            if "reduce the amount of data" in err_msg or ("unexpected error" in err_msg and (max_lat - min_lat) > 0.00008):
                logger.debug(f"Mapillary bbox {params['bbox']} saturated ({err_msg}); caller will probe tighter radius")
                return []
            elif resp.status_code == 200:
                data = payload.get("data", []) or []
            else:
                logger.warning(f"Mapillary bbox {params['bbox']} status={resp.status_code} body={err_msg or resp.text[:120]}")
                raise APIException(f"Imagery service error (HTTP {resp.status_code})", 503)

            results: List[LocationMetadata] = []
            for img in data:
                geom = img.get("geometry") or {}
                coords = geom.get("coordinates") or []
                if len(coords) < 2:
                    continue
                meta = LocationMetadata(
                    coordinates=LatLng(latitude=coords[1], longitude=coords[0]),
                    imageId=str(img.get("id")),
                    captureTime=str(img.get("captured_at", "")),
                    heading=(img.get("computed_compass_angle") or img.get("compass_angle") or 0.0),
                    isPano=bool(img.get("is_pano", False)),
                    sequenceId=str(img.get("sequence")) if img.get("sequence") else None,
                    provider="mapillary",
                )
                results.append(meta)
            return results

        return singleflight(sf_key, _do_bbox)

    def get_image(self, image_id: str, heading: float = 0, pitch: float = 0) -> Optional[dict]:
        try:
            cache_key = f"hd:{image_id}"
            cached = image_cache.get(cache_key)
            img_bytes = None
            img_heading = 0.0
            is_pano = False
            from_cache = False
            if cached is not None:
                c_bytes, c_heading, c_pano = cached
                if isinstance(c_bytes, (bytes, bytearray)) and c_bytes and not (
                    c_bytes.startswith(b"Everstore ")
                    or c_bytes.startswith(b"<html")
                    or c_bytes.startswith(b"<!DOCTYPE")
                ):
                    query_audit.record_cache_hit("mapillary_image")
                    img_bytes, img_heading, is_pano = c_bytes, c_heading, c_pano
                    from_cache = True

            if img_bytes is None:
                meta_cached = metadata_cache.get(self._meta_key(image_id))
                if meta_cached and meta_cached.get("thumbUrl"):
                    query_audit.record_cache_hit("mapillary_meta")
                    thumb_url = meta_cached["thumbUrl"]
                    img_heading = float(meta_cached.get("heading") or 0.0)
                    is_pano = bool(meta_cached.get("isPano", False))
                else:
                    query_audit.record_external("mapillary_meta", str(image_id))
                    resp = requests.get(f"{self.base_url}/{image_id}", params={
                        "access_token": self.client_token,
                        "fields": "compass_angle,computed_compass_angle,thumb_original_url,thumb_2048_url,is_pano",
                    }, timeout=config.MAPILLARY_METADATA_TIMEOUT_S).json()

                    img_heading = resp.get('computed_compass_angle') or resp.get('compass_angle') or 0.0
                    thumb_url = resp.get('thumb_original_url') or resp.get('thumb_2048_url')
                    if not thumb_url:
                        return None
                    is_pano = bool(resp.get('is_pano', False))

                query_audit.record_external("mapillary_image", str(image_id))
                img_resp = requests.get(thumb_url, timeout=config.MAPILLARY_IMAGE_DOWNLOAD_TIMEOUT_S)
                if getattr(img_resp, "status_code", 200) != 200:
                    logger.warning(f"Mapillary image download failed for {image_id}: HTTP {img_resp.status_code}")
                    return None
                img_bytes = img_resp.content
                if not img_bytes or img_bytes.startswith(b"Everstore ") or img_bytes.startswith(b"<html"):
                    logger.warning(f"Mapillary image {image_id} returned invalid image payload ({len(img_bytes)} bytes)")
                    return None

            if is_pano:
                cropped = crop_panorama(
                    img_bytes, heading, img_heading, self.default_fov,
                    output_width=1440, output_height=1080, pitch_deg=pitch,
                )
                if not from_cache:
                    image_cache.put(cache_key, (img_bytes, img_heading, is_pano), size_bytes=len(img_bytes))
                return {
                    "image": base64.b64encode(cropped).decode('utf-8'),
                    "imageId": image_id,
                    "actualHeading": heading,
                }
            # Flat images: return the source thumbnail as-is; camera facing is fixed.
            if not from_cache:
                image_cache.put(cache_key, (img_bytes, img_heading, is_pano), size_bytes=len(img_bytes))
            return {
                "image": base64.b64encode(img_bytes).decode('utf-8'),
                "imageId": image_id,
                "actualHeading": img_heading,
            }
        except Exception as e:
            logger.warning(f"Mapillary get_image({image_id}) failed: {e}")
            return None
