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

"""Bundled road extracts: static map data shipped with the app (NOT a cache —
the stateless-server rule forbids caches, not bundled datasets).

`data/roads_*.json.gz` files from city/state OSM extracts answer road bbox queries
instantly for covered regions, so the public Overpass servers (slow, throttled,
intermittently down) are only consulted for places not covered by extracts.
"""

import glob
import gzip
import json
import os
import threading
from typing import List, Optional, Tuple

from server.core.logger import logger
from server.services.streetmap.base import RoadDataSource

# Extract edges clip ways, so only answer queries comfortably inside a region.
_EDGE_MARGIN_DEG = 0.005  # ~500 m


class _Region:
    def __init__(self, name: str, bounds: Tuple[float, float, float, float], elements: List[dict]):
        self.name = name
        self.bounds = bounds
        self.elements = elements
        # Precomputed per-way bbox for the linear intersection scan.
        self.way_boxes = []
        for way in elements:
            lats = [p["lat"] for p in way["geometry"]]
            lngs = [p["lon"] for p in way["geometry"]]
            self.way_boxes.append((min(lats), min(lngs), max(lats), max(lngs)))

    def covers(self, min_lat, min_lng, max_lat, max_lng) -> bool:
        b = self.bounds
        return (b[0] + _EDGE_MARGIN_DEG <= min_lat and b[1] + _EDGE_MARGIN_DEG <= min_lng
                and b[2] - _EDGE_MARGIN_DEG >= max_lat and b[3] - _EDGE_MARGIN_DEG >= max_lng)

    def query(self, min_lat, min_lng, max_lat, max_lng) -> List[dict]:
        return [
            way for way, (a, b, c, d) in zip(self.elements, self.way_boxes)
            if not (c < min_lat or a > max_lat or d < min_lng or b > max_lng)
        ]


class LocalExtractRoadService(RoadDataSource):
    def __init__(self, data_dir: Optional[str] = None):
        # __file__ is server/services/streetmap/<here> — repo root is 4 levels up.
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        self.data_dir = data_dir or os.path.join(repo_root, "data")
        self._regions: Optional[List[_Region]] = None
        self._lock = threading.Lock()

    def _load(self) -> List[_Region]:
        with self._lock:
            if self._regions is not None:
                return self._regions
            regions = []
            for path in sorted(glob.glob(os.path.join(self.data_dir, "roads_*.json.gz"))):
                try:
                    with gzip.open(path, "rt", encoding="utf-8") as f:
                        payload = json.load(f)
                    regions.append(_Region(payload.get("region", path),
                                           tuple(payload["bounds"]), payload["elements"]))
                    logger.info(f"Local roads: {payload.get('region')} "
                                f"({len(payload['elements'])} ways) from {os.path.basename(path)}")
                except Exception as e:
                    logger.warning(f"Local roads: failed to load {path}: {e}")
            self._regions = regions
            return regions

    def get_ways(self, min_lat: float, min_lng: float, max_lat: float, max_lng: float
                 ) -> Optional[List[dict]]:
        """Ways intersecting the bbox, or None if no bundled region covers it."""
        for region in self._load():
            if region.covers(min_lat, min_lng, max_lat, max_lng):
                return region.query(min_lat, min_lng, max_lat, max_lng)
        return None
