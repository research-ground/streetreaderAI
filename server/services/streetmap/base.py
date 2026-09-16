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

"""The standard API for road data.

The routing engine consumes raw OSM-shaped way dicts (id, nodes, geometry,
tags) for a bounding box and builds its own graph per request; where those
dicts come from is an implementation detail behind this interface.

Implementations:
  - LocalExtractRoadService — bundled city extracts (instant, offline).
  - OverpassRoadService     — the public Overpass API (network fallback).

Sources are consulted in order: a source returns None to say "I cannot answer
for this area" (e.g. the bbox is outside every bundled extract), letting the
caller fall through to the next one. The last source in a chain must either
answer or raise — a silent empty answer is indistinguishable from a roadless
area, and that lie is what strands users (see the design ledger in
routeprovider.py).
"""

from abc import ABC, abstractmethod
from typing import List, Optional


class RoadDataSource(ABC):
    @abstractmethod
    def get_ways(self, min_lat: float, min_lng: float, max_lat: float, max_lng: float
                 ) -> Optional[List[dict]]:
        """OSM-shaped way dicts intersecting the bbox, or None if this source
        cannot answer for that area."""
