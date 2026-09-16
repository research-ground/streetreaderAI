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

"""
RouteProvider — the single navigation engine: OSM roads + Mapillary imagery.

This file is the DOMAIN LOGIC: the per-request road graph, the tight-window
imagery snapshot, and the selection algorithm. All external API access lives
behind interfaces under server/services/ — road data through `RoadDataSource`
(services/streetmap: bundled extracts first, Overpass fallback), imagery
through the injected image service, geocoding through the injected location
service. Every operational number lives in `RouteParams` so a human or an AI
can retune behavior without touching logic (constructor override or the
ROUTE_* environment variables).

============================ DESIGN LEDGER ============================
Why this works the way it does — each rule earned its place by evidence.
Parameters marked [user] are the product owner's explicit spec; change them
only with sign-off. [config] marks heuristic tuning constants configured in
server/streetreaderai.conf. [plumbing] bounds compute, not behavior.

1. THE ALGORITHM (user spec, implemented as literally as possible):
   Seed:  snap the geocoded point to its NAMED street (corner buildings are
          equidistant from two roads; the address already names the right
          one), then search ±1 m doubling until any image is found — nearest
          wins outright. Sidewalk preference: right (if it has a continuation
          point before the next intersection), then left, then center.
   Step:  look 0.8–1.2 steps ahead along the road; among candidates pick the
          one minimizing perpendicular movement (stay in your lane). Empty →
          expand ahead one step-window at a time up to the condensing zone;
          same side anywhere beats the other side anywhere ("a sparse
          straight line beats a dense zigzag"). No waypoints within
          min(capture_max, block/2) of an intersection — that zone belongs to
          the intersection. Block empty → the step IS the intersection (if it
          has an image in its zone); otherwise that direction is closed.
   Turn:  keep the lane class; junctions within junction_merge_m are ONE
          corner (split roadways put 2-4 OSM nodes on a physical crossing —
          evidence: 1600 7th Ave, Seattle). Facing follows the road: each
          link carries the road tangent at its landing (arrivalHeading) so
          the client can reorient along curves.
   Changes to the algorithm require a specific map location that goes
   failure → success, plus regression on the known-good routes. Do not tune
   from assumptions.

2. TIGHT WINDOWS, ALWAYS (measured 2026-07-11): Mapillary bbox reads are
   silently TRUNCATED server-side — identical queries returned 24/0/76/297
   images; boxes ≤~100 m are exact and reproducible, ~300 m boxes lose up to
   a third per read. So every fetch here is the
   small window a single decision needs; nothing is prefetched. Corollary: a
   single empty read proves nothing — absence is only accepted after the
   expand-on-empty doubling (seeds, reference lookups).

3. PANOS ONLY (user decision, 2026-07-11): flat photos have a fixed facing;
   chosen as a landing view they hijack the user's heading (observed
   bounce-backs at way_6457203 off_226/off_348/off_123). Only panoramas are
   navigation views — a pano crops to any requested heading, so orientation
   hijack is structurally impossible.

4. JUNCTION IMAGES COME FROM THE ARMS, NEVER THE CENTER (user correction,
   2026-07-11): the geometric center of a crossing is the one place imagery
   structurally cannot exist (capture tracks run on approaches and
   sidewalks). Candidates are gathered along each merged arm within the
   condensing window; there is deliberately no distance-to-center test.

5. NO DATA GAPS: every "no imagery exists there" claim in this project's
   history was false — our own filtering or truncated reads. When a query
   returns nothing, the correct thought is: "the data is there; why isn't my
   query showing it?" Likewise a failed imagery fetch must never present as
   an empty street (the Mapillary client raises instead of returning []).

6. STATELESS SERVER (user): each request builds a throwaway snapshot and
   forgets. The client caches traversed nodes; within-session consistency
   lives there. Reasoning scope is the current node, its neighbors, and at
   most the block ahead to the next intersection.
=======================================================================

Layout: §0 parameters · §1 road geometry (RoadNetwork) · §2 imagery windows
(AreaSnapshot) · §3 selection (seed/step/links) · §4 the RouteProvider class.
"""

import concurrent.futures
import math
import os
import time
from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass, field, fields
from typing import Dict, List, Optional, Set, Tuple

from server.core.cache import window_cache
from server.core.config import config
from server.core.exceptions import APIException
from server.core.logger import log_call, logger
from server.core.models import (
    DebugEdge,
    DebugNode,
    LatLng,
    LocalGraphResponse,
    LocationMetadata,
    NavigationLink,
    PanoramaMetadata,
    ViewResponse,
)
from server.services.streetmap.base import RoadDataSource
from server.services.streetmap.local_extract_road_service import LocalExtractRoadService
from server.routing.map_math import calculate_distance
from server.services.streetmap.overpass_road_service import OverpassRoadService

M_PER_DEG_LAT = 111139.0  # matches server.routing.map_math.calculate_distance


# =====================================================================
# §0 PARAMETERS — every operational number, tweakable by human or AI.
# =====================================================================


@dataclass(frozen=True)
class RouteParams:
    """All tunables in one place. Override per instance
    (`RouteProvider(..., params=RouteParams(step_m=10))`) or via environment
    (`ROUTE_STEP_M=10`, see `from_env`). Provenance tags as in the ledger."""

    step_m: float = 20.0
    """[user] Target stride. Was 10; raised to 20 for the visual-navigation
    eval (2026-07-11). The step slice below scales with it."""

    slice_lo_frac: float = 0.8
    slice_hi_frac: float = 1.2
    """[user] The step window ("8-12 m forward for a 10 m step"): a landing is
    sought at step_m*[lo,hi] first; expansion happens only when it's empty."""

    seed_windows_m: Tuple[float, ...] = (1.0, 2.0, 4.0, 8.0, 16.0, 32.0)
    """[user] "±1 m and expand as needed": the first non-empty window wins and
    nothing outside it is ever considered — being at the right place outranks
    having a better photo (anchor-drift regression, 2026-07-11)."""

    capture_max_m: float = 30.0
    """[user] Condensing-zone cap: min(this, block/2) around a junction admits
    no waypoints; near-corner satellites show the same scene and masquerade as
    decision points. (Eval tuning round 1; was 3x step.)"""

    junction_merge_m: float = 30.0
    """[user] Decision markers within this distance are ONE junction
    (split roadways; evidence: 1600 7th Ave, 2-4 OSM nodes per corner)."""

    panos_only: bool = True
    """[user] Only panoramas are navigation views (ledger #3)."""

    perp_max_m: float = field(default_factory=lambda: getattr(config, "ROUTE_PERP_MAX_M", 30.0))
    """[config] Configured in server/streetreaderai.conf (ROUTE_PERP_MAX_M).
    How far off the centerline an image may sit and still belong to the street
    ("generous borders" per spec, no number given). 15 m dropped real downtown
    sidewalk imagery — raised with evidence (eval tuning round 1, change 2; was 22)."""

    center_half_width_m: float = field(default_factory=lambda: getattr(config, "ROUTE_CENTER_HALF_WIDTH_M", 2.0))
    """[config] Configured in server/streetreaderai.conf (ROUTE_CENTER_HALF_WIDTH_M).
    |perp| below this = "center" lane class; beyond it the sign picks the sidewalk
    side. Defines right/left/center preference to prevent zigzagging."""

    reference_windows_m: Tuple[float, ...] = (3.0, 6.0, 12.0)
    """Landing-reference lookup windows, expand-on-empty: a single tiny read
    can flake (way_8071899_off_39: ±3 m read empty, ±6 m held 95 panos)."""

    locate_max_perp_m: float = field(default_factory=lambda: getattr(config, "ROUTE_LOCATE_MAX_PERP_M", 60.0))
    """[config] Configured in server/streetreaderai.conf (ROUTE_LOCATE_MAX_PERP_M).
    Max snap distance from a geocoded point to a road."""

    intersection_probe_m: float = field(default_factory=lambda: getattr(config, "ROUTE_INTERSECTION_PROBE_M", 25.0))
    """[config] Configured in server/streetreaderai.conf (ROUTE_INTERSECTION_PROBE_M).
    "Am I at an intersection?" marker search radius."""

    block_cap_m: float = field(default_factory=lambda: getattr(config, "ROUTE_BLOCK_CAP_M", 60.0))
    """[plumbing] Max look-ahead per direction (~one long block)."""

    snapshot_radius_m: float = field(default_factory=lambda: getattr(config, "ROUTE_SNAPSHOT_RADIUS_M", 60.0))
    """[plumbing] Road geometry loaded per request (60m radius = 120m x 120m box)."""

    overpass_timeout_s: float = field(default_factory=lambda: getattr(config, "OVERPASS_TIMEOUT_S", 30.0))
    """[plumbing] Per-attempt Overpass timeout; endpoints rotate on failure."""

    @property
    def slice_lo(self) -> float:
        return self.slice_lo_frac * self.step_m

    @property
    def slice_hi(self) -> float:
        return self.slice_hi_frac * self.step_m

    @classmethod
    def from_env(cls) -> "RouteParams":
        """Build params with `ROUTE_<FIELD>` env overrides (e.g.
        ROUTE_STEP_M=10, ROUTE_PANOS_ONLY=false,
        ROUTE_SEED_WINDOWS_M=1,2,4,8). Lets anyone retune a running system
        without code edits."""
        overrides = {}
        for f in fields(cls):
            raw = os.environ.get(f"ROUTE_{f.name.upper()}")
            if raw is None:
                continue
            if isinstance(f.default, bool):
                overrides[f.name] = raw.strip().lower() in ("1", "true", "yes")
            elif isinstance(f.default, tuple):
                overrides[f.name] = tuple(float(x) for x in raw.split(","))
            else:
                overrides[f.name] = float(raw)
        if overrides:
            logger.info(f"RouteParams env overrides: {overrides}")
        return cls(**overrides)


# =====================================================================
# §1 ROAD GEOMETRY — the per-request road network (pure domain logic; the
# way dicts come from a RoadDataSource, see server/routing/base.py).
# =====================================================================


# ---- data types ----


@dataclass(frozen=True)
class Leg:
    """One outgoing direction from a position on the network."""
    way_id: int
    along: float
    direction: int        # +1 = increasing along-offset, -1 = decreasing
    bearing: float        # compass bearing of travel
    street_name: str


@dataclass
class RoadMarker:
    """A significant OSM node: intersection, same-street join, or dead end."""
    osm_node_id: int
    lat: float
    lng: float
    kind: str             # "intersection" | "join" | "dead_end"
    legs: List[Leg]
    street_names: Tuple[str, ...]

    def is_decision_point(self) -> bool:
        return self.kind != "join"


@dataclass(frozen=True)
class PathSlice:
    way_id: int
    from_along: float
    to_along: float
    direction: int
    start_dist: float

    @property
    def length(self) -> float:
        return abs(self.to_along - self.from_along)


@dataclass
class WalkResult:
    slices: List[PathSlice]
    end_marker: Optional[RoadMarker]   # decision point reached, None if budget ran out
    total_dist: float


@dataclass
class _Way:
    way_id: int
    pts: List[Tuple[float, float]]
    offsets: List[float]
    length: float
    name: str
    node_alongs: List[Tuple[float, int]]
    xy: List[Tuple[float, float]] = field(default_factory=list)


class RoadNetwork:
    """Per-request container: parse one ways response, answer geometry
    questions about it, get garbage-collected. No cross-request state
    (ledger #6)."""

    def __init__(self, params: Optional[RouteParams] = None):
        self.p = params or RouteParams()
        self._ways: Dict[int, _Way] = {}
        self._node_ways: Dict[int, Dict[int, List[float]]] = defaultdict(dict)
        self._node_coords: Dict[int, Tuple[float, float]] = {}
        self._markers: Dict[int, RoadMarker] = {}
        self._way_markers: Dict[int, List[Tuple[float, int]]] = {}
        self._cluster_rep: Dict[int, int] = {}   # marker id -> representative id
        self._cluster_members: Dict[int, List[int]] = defaultdict(list)

    # ---- integration ----

    def add_ways(self, overpass_ways: List[dict]) -> int:
        touched_nodes: set = set()
        added = 0
        for way in overpass_ways:
            way_id = way.get("id")
            geom = way.get("geometry") or []
            osm_nodes = way.get("nodes") or []
            if way_id is None or way_id in self._ways or len(geom) < 2 or len(osm_nodes) != len(geom):
                continue
            pts = [(p["lat"], p["lon"]) for p in geom]
            offsets = [0.0]
            for (a_lat, a_lng), (b_lat, b_lng) in zip(pts[:-1], pts[1:]):
                offsets.append(offsets[-1] + calculate_distance(a_lat, a_lng, b_lat, b_lng))
            name = (way.get("tags") or {}).get("name") or ""
            w = _Way(way_id=way_id, pts=pts, offsets=offsets, length=offsets[-1],
                     name=name, node_alongs=sorted(zip(offsets, osm_nodes)))
            origin_lat, origin_lng = pts[0]
            lng_scale = M_PER_DEG_LAT * math.cos(math.radians(origin_lat))
            w.xy = [((lng - origin_lng) * lng_scale, (lat - origin_lat) * M_PER_DEG_LAT)
                    for (lat, lng) in pts]
            self._ways[way_id] = w
            for along, nid in w.node_alongs:
                self._node_ways[nid].setdefault(way_id, []).append(along)
            for i, nid in enumerate(osm_nodes):
                self._node_coords[nid] = pts[i]
            touched_nodes.update(osm_nodes)
            added += 1

        affected_ways: set = set()
        for nid in touched_nodes:
            if self._rebuild_marker(nid):
                affected_ways.update(self._node_ways[nid].keys())
        for way_id in affected_ways | set(self._ways.keys()):
            self._rebuild_way_markers(way_id)
        self._rebuild_clusters()
        return added

    def _rebuild_clusters(self) -> None:
        """Union-find over decision markers within junction_merge_m of each
        other [user]. The representative (lowest OSM id — deterministic)
        stands in for the whole junction wherever a landing or a label is
        needed."""
        decision = [m for m in self._markers.values() if m.kind != "join"]
        parent = {m.osm_node_id: m.osm_node_id for m in decision}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i, a in enumerate(decision):
            for b in decision[i + 1:]:
                if calculate_distance(a.lat, a.lng, b.lat, b.lng) <= self.p.junction_merge_m:
                    ra, rb = find(a.osm_node_id), find(b.osm_node_id)
                    if ra != rb:
                        parent[max(ra, rb)] = min(ra, rb)
        self._cluster_rep = {nid: find(nid) for nid in parent}
        self._cluster_members = defaultdict(list)
        for nid, rep in self._cluster_rep.items():
            self._cluster_members[rep].append(nid)

    def junction_of(self, marker: RoadMarker) -> RoadMarker:
        rep_id = self._cluster_rep.get(marker.osm_node_id, marker.osm_node_id)
        return self._markers.get(rep_id, marker)

    def junction_legs(self, marker: RoadMarker) -> List[Leg]:
        rep_id = self._cluster_rep.get(marker.osm_node_id, marker.osm_node_id)
        legs: List[Leg] = []
        for member_id in self._cluster_members.get(rep_id, [marker.osm_node_id]):
            member = self._markers.get(member_id)
            if member is not None:
                legs.extend(member.legs)
        return legs

    def _rebuild_marker(self, osm_node_id: int) -> bool:
        occurrences = self._node_ways.get(osm_node_id) or {}
        legs: List[Leg] = []
        names: List[str] = []
        endpoint = False
        for way_id, alongs in occurrences.items():
            w = self._ways[way_id]
            for along in alongs:
                if along <= 0.5 or along >= w.length - 0.5:
                    endpoint = True
                if along > 0.5:
                    legs.append(Leg(way_id, along, -1, self.bearing_at(way_id, along, -1), w.name))
                if along < w.length - 0.5:
                    legs.append(Leg(way_id, along, +1, self.bearing_at(way_id, along, +1), w.name))
            if w.name:
                names.append(w.name)
        if (len(occurrences) < 2 and not endpoint) or not legs:
            self._markers.pop(osm_node_id, None)
            return False
        if len(legs) == 1:
            kind = "dead_end"
        elif len(legs) == 2 and len({l.street_name for l in legs}) == 1:
            kind = "join"
        else:
            kind = "intersection"
        lat, lng = self._node_coords[osm_node_id]
        seen = set()
        uniq = tuple(n for n in names if not (n in seen or seen.add(n)))
        self._markers[osm_node_id] = RoadMarker(
            osm_node_id=osm_node_id, lat=lat, lng=lng, kind=kind, legs=legs, street_names=uniq,
        )
        return True

    def _rebuild_way_markers(self, way_id: int) -> None:
        w = self._ways.get(way_id)
        if w is not None:
            self._way_markers[way_id] = sorted(
                (along, nid) for along, nid in w.node_alongs if nid in self._markers
            )

    # ---- accessors ----

    def way(self, way_id: int) -> Optional[_Way]:
        return self._ways.get(way_id)

    def marker(self, osm_node_id: int) -> Optional[RoadMarker]:
        return self._markers.get(osm_node_id)

    def markers_in_bbox(self, min_lat, max_lat, min_lng, max_lng) -> List[RoadMarker]:
        return [m for m in self._markers.values()
                if min_lat <= m.lat <= max_lat and min_lng <= m.lng <= max_lng]

    def way_street_name(self, way_id: int) -> str:
        w = self._ways.get(way_id)
        return w.name if w else ""

    # ---- geometry ----

    def point_at(self, way_id: int, along: float) -> Tuple[float, float]:
        w = self._ways[way_id]
        i = max(0, min(bisect_right(w.offsets, along) - 1, len(w.pts) - 2))
        seg = w.offsets[i + 1] - w.offsets[i]
        frac = max(0.0, min(1.0, (along - w.offsets[i]) / seg if seg > 0 else 0.0))
        lat = w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * frac
        lng = w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * frac
        return lat, lng

    def bearing_at(self, way_id: int, along: float, direction: int) -> float:
        w = self._ways[way_id]
        i = max(0, min(bisect_right(w.offsets, min(along, w.length - 0.01)) - 1, len(w.xy) - 2))
        dx = w.xy[i + 1][0] - w.xy[i][0]
        dy = w.xy[i + 1][1] - w.xy[i][1]
        if direction < 0:
            dx, dy = -dx, -dy
        return math.degrees(math.atan2(dx, dy)) % 360.0

    def project_to_way(self, way_id: int, lat: float, lng: float) -> Tuple[float, float]:
        """(signed perpendicular metres, along metres). Positive perp = left of
        the way's own direction."""
        w = self._ways[way_id]
        origin_lat, origin_lng = w.pts[0]
        lng_scale = M_PER_DEG_LAT * math.cos(math.radians(origin_lat))
        px = (lng - origin_lng) * lng_scale
        py = (lat - origin_lat) * M_PER_DEG_LAT
        best_perp = float("inf")
        best_signed = float("inf")
        best_along = 0.0
        for i, ((x1, y1), (x2, y2)) in enumerate(zip(w.xy[:-1], w.xy[1:])):
            dx, dy = x2 - x1, y2 - y1
            seg_sq = dx * dx + dy * dy
            if seg_sq == 0:
                continue
            t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / seg_sq))
            cx, cy = x1 + t * dx, y1 + t * dy
            perp = math.hypot(px - cx, py - cy)
            if perp < best_perp:
                best_perp = perp
                cross = dx * (py - y1) - dy * (px - x1)
                best_signed = perp if cross >= 0 else -perp
                best_along = w.offsets[i] + t * math.sqrt(seg_sq)
        return best_signed, best_along

    def locate(self, lat: float, lng: float, max_perp_m: float = 40.0,
               street_hint: Optional[str] = None) -> Optional[Tuple[int, float, float]]:
        """Snap to a way: (way_id, along, signed_perp). A street-name hint wins
        over raw distance — the address already names its street, and nearest-
        by-distance picks the wrong road for corner buildings."""
        hint = _norm_street(street_hint) if street_hint else None
        best_named = None
        best_any = None
        for way_id, w in self._ways.items():
            if not _near_bbox(w.pts, lat, lng, max_perp_m):
                continue
            signed, along = self.project_to_way(way_id, lat, lng)
            if abs(signed) > max_perp_m:
                continue
            entry = (way_id, along, signed)
            if best_any is None or abs(signed) < abs(best_any[2]):
                best_any = entry
            if hint and _norm_street(w.name) == hint:
                if best_named is None or abs(signed) < abs(best_named[2]):
                    best_named = entry
        return best_named or best_any

    # ---- the arc-walk ----

    def walk(self, way_id: int, along: float, direction: int, max_dist: float,
             max_hops: int = 20) -> WalkResult:
        """Advance up to `max_dist` metres, crossing same-street joins, stopping
        at decision points or when the loaded geometry runs out."""
        slices: List[PathSlice] = []
        dist = 0.0
        cur_way, cur_along, cur_dir = way_id, along, direction
        for _ in range(max_hops):
            w = self._ways.get(cur_way)
            if w is None:
                break
            markers = self._way_markers.get(cur_way, [])
            nxt = _next_marker(markers, cur_along, cur_dir)
            target = nxt[0] if nxt is not None else (w.length if cur_dir > 0 else 0.0)
            seg_len = abs(target - cur_along)
            if dist + seg_len >= max_dist:
                end = cur_along + cur_dir * (max_dist - dist)
                slices.append(PathSlice(cur_way, cur_along, end, cur_dir, dist))
                return WalkResult(slices, None, max_dist)
            if seg_len > 0:
                slices.append(PathSlice(cur_way, cur_along, target, cur_dir, dist))
                dist += seg_len
            if nxt is None:
                return WalkResult(slices, None, dist)
            marker = self._markers.get(nxt[1])
            if marker is None:
                cur_along = target
                continue
            if marker.is_decision_point():
                return WalkResult(slices, marker, dist)
            arrived_by = None
            onward = None
            for leg in marker.legs:
                if leg.way_id == cur_way and abs(leg.along - target) < 0.6 and leg.direction == -cur_dir:
                    arrived_by = leg
                else:
                    onward = leg
            if onward is None or arrived_by is None:
                return WalkResult(slices, marker, dist)
            cur_way, cur_along, cur_dir = onward.way_id, onward.along, onward.direction
        return WalkResult(slices, None, dist)


def _next_marker(markers: List[Tuple[float, int]], along: float, direction: int
                 ) -> Optional[Tuple[float, int]]:
    if direction > 0:
        i = bisect_right(markers, (along + 0.1, 1 << 62))
        return markers[i] if i < len(markers) else None
    i = bisect_left(markers, (along - 0.1, -1)) - 1
    return markers[i] if i >= 0 else None


def _near_bbox(pts: List[Tuple[float, float]], lat: float, lng: float, pad_m: float) -> bool:
    pad = pad_m / M_PER_DEG_LAT * 1.5
    return (min(p[0] for p in pts) - pad <= lat <= max(p[0] for p in pts) + pad
            and min(p[1] for p in pts) - pad <= lng <= max(p[1] for p in pts) + pad)


def _norm_street(name: Optional[str]) -> str:
    return (name or "").strip().casefold()


# =====================================================================
# §2 IMAGERY WINDOWS — tight per-decision reads over Mapillary (ledger #2).
# =====================================================================


@dataclass(frozen=True)
class WayImage:
    along: float
    perp: float                # signed, way frame (positive = left of way direction)
    meta: LocationMetadata


class AreaSnapshot:
    """Roads + imagery for one request, fetched on demand, discarded after.
    This layer knows nothing about steps, seeds, or junctions — it answers
    `candidates(way_id, along_lo, along_hi)` and fetches exactly that window
    on demand. Selection logic (§3) depends on it, never the reverse."""

    def __init__(self, roads: RoadNetwork, images: List[LocationMetadata], provider=None,
                 params: Optional[RouteParams] = None, visited_image_ids: Optional[Set[str]] = None):
        self.p = params or getattr(roads, "p", None) or RouteParams()
        self.roads = roads
        self.images = list(images)
        self.provider = provider
        self.visited_image_ids: Set[str] = set(visited_image_ids or [])
        self._image_ids = {m.imageId for m in self.images}
        self._fetched_windows: Dict[int, List[Tuple[float, float]]] = {}
        self._way_proj: Dict[int, List[WayImage]] = {}

    def _ensure_window(self, way_id: int, along_lo: float, along_hi: float) -> None:
        """Fetch imagery for exactly this along-window of this way — the tight,
        per-decision window of ledger #2. Boxes stay in the measured-exact size
        class (<=~60 m); nothing is prefetched."""
        if self.provider is None:
            return
        covered = self._fetched_windows.setdefault(way_id, [])
        # subtract already-fetched intervals
        want = [(max(along_lo, 0.0), along_hi)]
        for (a, b) in covered:
            nxt = []
            for (lo, hi) in want:
                if hi <= a or lo >= b:          # no overlap
                    nxt.append((lo, hi))
                else:                            # clip out [a, b]
                    if lo < a:
                        nxt.append((lo, a))
                    if hi > b:
                        nxt.append((b, hi))
            want = [(lo, hi) for (lo, hi) in nxt if hi - lo > 0.5]
        if not want:
            return
        w = self.roads.way(way_id)
        if w is None:
            return
        pad = (self.p.perp_max_m + 5) / M_PER_DEG_LAT
        t0 = time.time()
        for (lo, hi) in want:
            window_key = (way_id, round(lo, 1), round(hi, 1))
            metas = window_cache.get(window_key)
            if metas is None:
                pts = [self.roads.point_at(way_id, a) for a in
                       [lo + i * 15.0 for i in range(int((hi - lo) // 15) + 1)] + [hi]]
                min_lat = min(p[0] for p in pts) - pad
                max_lat = max(p[0] for p in pts) + pad
                min_lng = min(p[1] for p in pts) - pad * 1.5
                max_lng = max(p[1] for p in pts) + pad * 1.5
                metas = self.provider.get_metadata_bbox(min_lat, min_lng, max_lat, max_lng) or []
                window_cache.put(window_key, metas)
            new = [m for m in metas if m.imageId not in self._image_ids]
            if new:
                self.images.extend(new)
                self._image_ids.update(m.imageId for m in new)
                self._way_proj.clear()
            covered.append((lo, hi))
        logger.info(f"window fetch way {way_id} [{along_lo:.0f},{along_hi:.0f}]m "
                    f"({len(want)} boxes, {time.time() - t0:.1f}s)")

    def way_images(self, way_id: int) -> List[WayImage]:
        cached = self._way_proj.get(way_id)
        if cached is not None:
            return cached
        w = self.roads.way(way_id)
        out: List[WayImage] = []
        if w is not None:
            pad = (self.p.perp_max_m + 10) / M_PER_DEG_LAT
            min_lat = min(p[0] for p in w.pts) - pad
            max_lat = max(p[0] for p in w.pts) + pad
            min_lng = min(p[1] for p in w.pts) - pad * 1.5
            max_lng = max(p[1] for p in w.pts) + pad * 1.5
            for meta in self.images:
                if self.p.panos_only and not meta.isPano:
                    continue  # ledger #3: flat photos hijack the heading
                ilat, ilng = meta.coordinates.latitude, meta.coordinates.longitude
                if not (min_lat <= ilat <= max_lat and min_lng <= ilng <= max_lng):
                    continue
                perp, along = self.roads.project_to_way(way_id, ilat, ilng)
                if abs(perp) <= self.p.perp_max_m:
                    out.append(WayImage(along=along, perp=perp, meta=meta))
            out.sort(key=lambda wi: (wi.along, wi.meta.imageId))
        self._way_proj[way_id] = out
        return out

    def candidates(self, way_id: int, lo: float, hi: float) -> List[WayImage]:
        self._ensure_window(way_id, lo, hi)
        imgs = self.way_images(way_id)
        alongs = [wi.along for wi in imgs]
        return imgs[bisect_left(alongs, lo):bisect_right(alongs, hi)]

    def image_by_id(self, image_id: str) -> Optional[LocationMetadata]:
        for meta in self.images:
            if meta.imageId == image_id:
                return meta
        return None


# =====================================================================
# §3 SELECTION — the user's seed/step/turn algorithm (ledger #1), literally.
# =====================================================================


def lane_of(p: RouteParams, travel_perp: float) -> str:
    """Lane class in the travel frame. Positive perpendicular = left of travel."""
    if travel_perp <= -p.center_half_width_m:
        return "right"
    if travel_perp >= p.center_half_width_m:
        return "left"
    return "center"


def capture_radius(p: RouteParams, block_length_m: float) -> float:
    """[user] min(cap, block/2): the zone around an intersection where no
    waypoint may exist — it belongs to the intersection."""
    return min(p.capture_max_m, block_length_m / 2 if block_length_m > 0 else p.capture_max_m)


def _capture_ms(meta: LocationMetadata) -> int:
    try:
        return int(meta.captureTime)
    except (TypeError, ValueError):
        return 0


@dataclass
class NodePlace:
    node_id: str
    kind: str                  # "waypoint" | "intersection"
    lat: float
    lng: float
    way_id: Optional[int] = None
    along: Optional[float] = None
    marker: Optional[RoadMarker] = None
    street_names: Tuple[str, ...] = ()


@dataclass
class LinkOut:
    node_id: str
    lat: float
    lng: float
    bearing: float             # travel bearing leaving the current node
    arrival_bearing: float     # road tangent at the landing, same travel sense
    distance_m: float
    street_name: str
    image: Optional[LocationMetadata]
    lane: Optional[str]


# ---- node placement ----


def _junction_place(snap: AreaSnapshot, marker: RoadMarker) -> NodePlace:
    """[user] intersections within junction_merge_m merge: the representative
    marker stands in for the whole junction."""
    rep = snap.roads.junction_of(marker)
    names = []
    for leg in snap.roads.junction_legs(rep):
        if leg.street_name and leg.street_name not in names:
            names.append(leg.street_name)
    return NodePlace(node_id=f"osm_{rep.osm_node_id}", kind="intersection",
                     lat=rep.lat, lng=rep.lng, marker=rep, street_names=tuple(names))


def place_node(snap: AreaSnapshot, node_id: str) -> Optional[NodePlace]:
    if node_id.startswith("osm_"):
        try:
            marker = snap.roads.marker(int(node_id[4:]))
        except ValueError:
            return None
        if marker is None:
            return None
        return _junction_place(snap, marker)
    if node_id.startswith("way_"):
        try:
            _, way_str, _, off_str = node_id.split("_", 3)
            way_id, along = int(way_str), float(off_str)
        except ValueError:
            return None
        w = snap.roads.way(way_id)
        if w is None:
            return None
        along = max(0.0, min(along, w.length))
        lat, lng = snap.roads.point_at(way_id, along)
        return NodePlace(node_id=node_id, kind="waypoint", lat=lat, lng=lng,
                         way_id=way_id, along=along,
                         street_names=(w.name,) if w.name else ())
    return None


def waypoint_id(way_id: int, along: float) -> str:
    return f"way_{way_id}_off_{int(round(along))}"


def reference_image(snap: AreaSnapshot, place: NodePlace,
                    image_id: Optional[str] = None) -> Optional[WayImage]:
    """The image a node displays. The client's declared current image wins;
    otherwise the nearest image to the node."""
    p = snap.p
    if image_id:
        meta = snap.image_by_id(image_id)
        if meta is not None:
            way_id = place.way_id
            if way_id is None and place.marker is not None and place.marker.legs:
                way_id = place.marker.legs[0].way_id
            if way_id is not None and snap.roads.way(way_id) is not None:
                perp, along = snap.roads.project_to_way(
                    way_id, meta.coordinates.latitude, meta.coordinates.longitude)
                return WayImage(along=along, perp=perp, meta=meta)
    if place.kind == "waypoint":
        # [user doctrine] expand on empty, doubling — a single tiny read can
        # flake (proven at way_8071899_off_39: first ±3 m read empty, ±6 m
        # found 95 panos incl. one at Δ0.0). Overlapping padded fetches
        # re-sample the ground; nearest wins so no drift when reads are good.
        for window in p.reference_windows_m:
            near = snap.candidates(place.way_id, place.along - window, place.along + window)
            if near:
                return min(near, key=lambda wi: (abs(wi.along - place.along), wi.meta.imageId))
        return None
    return _intersection_image(snap, place.marker, p.capture_max_m)


def _intersection_image(snap: AreaSnapshot, marker: RoadMarker,
                        radius_m: float) -> Optional[WayImage]:
    """The junction's image comes from the points aggregated INTO the junction:
    per-arm candidates within the condensing window along each leg. There is
    deliberately NO distance-to-center test — the geometric center of a
    crossing is the one place imagery structurally cannot exist (ledger #4:
    navigability is the goal, not center proximity). Panos first, then closest
    to the corner along its own arm."""
    best = None
    best_key = None
    for leg in snap.roads.junction_legs(marker):
        for wi in snap.candidates(leg.way_id, leg.along - radius_m, leg.along + radius_m):
            key = (not wi.meta.isPano, round(abs(wi.along - leg.along), 1), wi.meta.imageId)
            if best_key is None or key < best_key:
                best_key = key
                best = wi
    return best


# ---- links ----


def legs_at(snap: AreaSnapshot, place: NodePlace) -> List[Leg]:
    if place.kind == "intersection":
        return snap.roads.junction_legs(place.marker)
    w = snap.roads.way(place.way_id)
    if w is None:
        return []
    along = max(0.05, min(place.along, w.length - 0.05))
    return [Leg(place.way_id, along, d, snap.roads.bearing_at(place.way_id, along, d), w.name)
            for d in (+1, -1)]


def build_links(snap: AreaSnapshot, place: NodePlace,
                ref: Optional[WayImage]) -> List[LinkOut]:
    links: List[LinkOut] = []
    for leg in legs_at(snap, place):
        out = _step(snap, place, leg, ref)
        if out is not None and out.node_id != place.node_id:
            links.append(out)
    return links


def _step(snap: AreaSnapshot, place: NodePlace, leg: Leg,
          ref: Optional[WayImage]) -> Optional[LinkOut]:
    p = snap.p
    fwd = snap.roads.walk(leg.way_id, leg.along, leg.direction, p.block_cap_m)
    dist_dp = fwd.total_dist if fwd.end_marker is not None else None
    if place.kind == "intersection":
        block = dist_dp if dist_dp is not None else p.block_cap_m
    else:
        back = snap.roads.walk(leg.way_id, leg.along, -leg.direction, p.block_cap_m).total_dist
        block = (dist_dp if dist_dp is not None else p.block_cap_m) + back
    cap = capture_radius(p, block)
    far = (dist_dp - cap) if dist_dp is not None else fwd.total_dist

    # Travel-frame reference perpendicular: where "my lane" is on this leg's way.
    ref_tp: Optional[float] = None
    if ref is not None:
        perp, _ = snap.roads.project_to_way(leg.way_id, ref.meta.coordinates.latitude,
                                            ref.meta.coordinates.longitude)
        if abs(perp) <= p.perp_max_m + 5:
            ref_tp = perp * leg.direction

    def cands_in_pd(lo_pd: float, hi_pd: float) -> List[Tuple[float, float, int, float, WayImage]]:
        """Candidates with path-distance in (lo_pd, hi_pd] — fetches only the
        matching tight window on each underlying way."""
        out = []
        for sl in fwd.slices:
            s_lo, s_hi = sl.start_dist, sl.start_dist + sl.length
            if s_hi <= lo_pd or s_lo > hi_pd:
                continue
            a0 = sl.from_along + sl.direction * (max(lo_pd, s_lo) - s_lo)
            a1 = sl.from_along + sl.direction * (min(hi_pd, s_hi) - s_lo)
            for wi in snap.candidates(sl.way_id, min(a0, a1), max(a0, a1)):
                pd = sl.start_dist + (wi.along - sl.from_along) * sl.direction
                if lo_pd < pd <= hi_pd and (ref is None or wi.meta.imageId != ref.meta.imageId):
                    out.append((pd, wi.perp * sl.direction, sl.way_id, wi.along, wi))
        return out

    def link_for(pick) -> LinkOut:
        pd, tp, way_id, along, wi = pick
        lat, lng = snap.roads.point_at(way_id, along)
        return LinkOut(
            node_id=waypoint_id(way_id, along), lat=lat, lng=lng,
            bearing=leg.bearing,
            arrival_bearing=snap.roads.bearing_at(way_id, along, _slice_dir(fwd, way_id, along)),
            distance_m=pd, street_name=snap.roads.way_street_name(way_id) or leg.street_name,
            image=wi.meta, lane=lane_of(p, tp),
        )

    # [user] Same side anywhere in the ray beats the other side anywhere
    # ("sparse straight line beats dense zigzag"). Within a side: the step
    # slice first (minimal perpendicular movement), then expand ahead one
    # window at a time up to the condensing zone. Every window is its own
    # tight fetch; pass 2 reuses pass 1's fetches from memory.
    slice_all = cands_in_pd(p.slice_lo, min(p.slice_hi, far)) if far > p.slice_lo else []
    beyond_all: List[Tuple[float, float, int, float, WayImage]] = []
    beyond_gathered = False

    def gather_beyond():
        nonlocal beyond_gathered
        if beyond_gathered:
            return
        lo_pd = p.slice_hi
        while lo_pd < far:
            hi_pd = min(lo_pd + p.step_m, far)
            beyond_all.extend(cands_in_pd(lo_pd, hi_pd))
            lo_pd = hi_pd
        beyond_gathered = True

    if ref_tp is not None:
        pools = [lambda c: lane_of(p, c[1]) == lane_of(p, ref_tp), lambda c: True]
    else:
        pools = [lambda c: True]
    ref_seq = ref.meta.sequenceId if (ref and ref.meta and ref.meta.sequenceId) else None
    visited_ids = getattr(snap, "visited_image_ids", set())

    for keep in pools:
        in_slice = [c for c in slice_all if keep(c)]
        if in_slice:
            anchor = ref_tp if ref_tp is not None else 0.0
            prev_matches = [c for c in in_slice if c[4].meta.imageId in visited_ids]
            if prev_matches:
                return link_for(min(prev_matches, key=lambda c: (abs(c[1] - anchor), c[0],
                                                                  c[4].meta.imageId)))
            if ref_seq:
                seq_matches = [c for c in in_slice if c[4].meta.sequenceId == ref_seq]
                if seq_matches:
                    return link_for(min(seq_matches, key=lambda c: (abs(c[1] - anchor), c[0],
                                                                    c[4].meta.imageId)))
            return link_for(min(in_slice, key=lambda c: (abs(c[1] - anchor), c[0],
                                                         c[4].meta.imageId)))
        gather_beyond()
        beyond = [c for c in beyond_all if keep(c)]
        if beyond:
            prev_beyond = [c for c in beyond if c[4].meta.imageId in visited_ids]
            if prev_beyond:
                return link_for(min(prev_beyond, key=lambda c: (c[0], c[4].meta.imageId)))
            if ref_seq:
                seq_beyond = [c for c in beyond if c[4].meta.sequenceId == ref_seq]
                if seq_beyond:
                    return link_for(min(seq_beyond, key=lambda c: (c[0], c[4].meta.imageId)))
            return link_for(min(beyond, key=lambda c: (c[0], c[4].meta.imageId)))

    # [user] (c) the intersection itself — or travel this way is not possible.
    marker = fwd.end_marker
    if marker is not None and marker.is_decision_point():
        jplace = _junction_place(snap, marker)
        jref = _intersection_image(snap, jplace.marker, cap)
        if jref is not None:
            return LinkOut(
                node_id=jplace.node_id, lat=jplace.lat, lng=jplace.lng,
                bearing=leg.bearing, arrival_bearing=leg.bearing,
                distance_m=calculate_distance(place.lat, place.lng, jplace.lat, jplace.lng),
                street_name=leg.street_name, image=jref.meta,
                lane=lane_of(p, jref.perp * leg.direction),
            )
    return None


def _slice_dir(walkres, way_id: int, along: float) -> int:
    for sl in walkres.slices:
        a_min, a_max = min(sl.from_along, sl.to_along), max(sl.from_along, sl.to_along)
        if sl.way_id == way_id and a_min - 0.01 <= along <= a_max + 0.01:
            return sl.direction
    return +1


# ---- seeding ----


@dataclass
class Seed:
    place: NodePlace
    image: WayImage
    lane: Optional[str]


def pick_seed(snap: AreaSnapshot, lat: float, lng: float,
              street_hint: Optional[str] = None) -> Optional[Seed]:
    p = snap.p
    loc = snap.roads.locate(lat, lng, max_perp_m=p.locate_max_perp_m, street_hint=street_hint)
    if loc is None:
        return None
    way_id, along, _ = loc

    # [user] ±1 m window, doubling until anything is found; the first non-empty
    # window wins and nothing outside it is ever considered.
    cands: List[WayImage] = []
    for window in p.seed_windows_m:
        cands = snap.candidates(way_id, along - window, along + window)
        if cands:
            break
    if not cands:
        return None

    # [user] right sidewalk (with a continuation point before the next
    # intersection), then left, then center.
    fwd = snap.roads.walk(way_id, along, +1, p.block_cap_m)
    ahead = {lane_of(p, wi.perp) for wi in snap.candidates(
        way_id, along + 1.0, along + max(fwd.total_dist - p.capture_max_m, 2.0))}
    by_lane: Dict[str, List[WayImage]] = {"right": [], "left": [], "center": []}
    for wi in cands:
        by_lane[lane_of(p, wi.perp)].append(wi)
    order = [l for l in ("right", "left") if by_lane[l] and l in ahead]
    order.append("center")
    order += [l for l in ("right", "left") if l not in order]
    for lane in order:
        pool = by_lane[lane]
        if not pool:
            continue
        # Nearest wins outright; pano/recency only break metre-level ties.
        wi = min(pool, key=lambda c: (round(abs(c.along - along)), not c.meta.isPano,
                                      -_capture_ms(c.meta), c.meta.imageId))
        nlat, nlng = snap.roads.point_at(way_id, wi.along)
        w = snap.roads.way(way_id)
        place = NodePlace(node_id=waypoint_id(way_id, wi.along), kind="waypoint",
                          lat=nlat, lng=nlng, way_id=way_id, along=wi.along,
                          street_names=(w.name,) if w.name else ())
        return Seed(place=place, image=wi, lane=lane)
    return None


# =====================================================================
# §4 THE PROVIDER — one instantiation (OSM + Mapillary) behind one interface.
# =====================================================================


class RouteProvider:
    """Stateless request handler (ledger #6). Every request builds a throwaway
    AreaSnapshot (one roads fetch + tight per-decision imagery windows),
    answers from it, and discards it. The client caches the nodes it has
    traversed; the server remembers nothing.

    Constructor seams:
      imagery       — object with get_metadata_bbox / get_metadata / get_image
                      (MapillaryProvider in production; StubImageService when
                      booting without a token).
      location      — geocoding service (used only to turn addresses into
                      coordinates plus the street-name hint).
      params        — RouteParams; defaults to RouteParams.from_env().
      road_sources  — ordered list of RoadDataSource; a source returning None
                      passes to the next (see server/services/streetmap).
                      Defaults to bundled extracts first, Overpass fallback.
                      Inject a fixture for offline tests.
    """

    def __init__(self, imagery, location, params: Optional[RouteParams] = None,
                 road_sources: Optional[List[RoadDataSource]] = None):
        self.imagery = imagery
        self.location = location
        self.p = params or RouteParams.from_env()
        self._road_sources = road_sources or [
            LocalExtractRoadService(),
            OverpassRoadService(
                timeout_s=self.p.overpass_timeout_s,
                http_timeout_s=getattr(config, "OVERPASS_HTTP_TIMEOUT_S", 30.0),
                probe_on_init=False,
            ),
        ]
        self.visited_image_ids: Set[str] = set()

    # ---------- shared plumbing ----------

    def _snapshot_at(self, lat: float, lng: float) -> AreaSnapshot:
        dlat = self.p.snapshot_radius_m / M_PER_DEG_LAT
        dlng = self.p.snapshot_radius_m / (M_PER_DEG_LAT * max(math.cos(math.radians(lat)), 0.1))
        ways = None
        last_error = None
        for source in self._road_sources:
            try:
                ways = source.get_ways(lat - dlat, lng - dlng, lat + dlat, lng + dlng)
                if ways is not None:
                    break
            except Exception as e:
                logger.error(f"Road source {source.__class__.__name__} failed: {e}")
                last_error = e
        if ways is None and last_error is not None:
            if isinstance(last_error, APIException):
                raise last_error
            raise APIException(
                "Street map data service is temporarily unreachable. Please try again.",
                status_code=504 if "timeout" in str(last_error).lower() or "504" in str(last_error) else 503,
            )
        roads = RoadNetwork(self.p)
        roads.add_ways(ways or [])
        return AreaSnapshot(roads, [], self.imagery, params=self.p, visited_image_ids=self.visited_image_ids)

    def _geocode(self, address: str):
        coords = self.location.geocode(address)
        if not coords:
            raise APIException(f"Could not resolve location: {address}")
        return coords["lat"], coords["lng"], coords.get("street")

    # ---------- view ----------

    def get_pano_view(
        self,
        canonical_node_id: Optional[str] = None,
        image_id: Optional[str] = None,
        address: Optional[str] = None,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        heading: float = 0,
        pitch: float = 0,
        image_only: bool = False,
    ) -> ViewResponse:
        # Fast path: the client has this node cached (links and all) and only
        # needs the image re-cropped for a new heading. No area fetches.
        if image_only and image_id:
            image_data = self.imagery.get_image(image_id, heading, pitch)
            if not image_data:
                raise APIException("Failed to retrieve image data.")
            return ViewResponse(
                image=image_data["image"],
                name=image_id,
                canonicalNodeId=canonical_node_id,
                actualHeading=image_data["actualHeading"],
                panoramaMetadata=PanoramaMetadata(
                    coordinates=LatLng(latitude=lat or 0.0, longitude=lng or 0.0),
                    captureTime="",
                ),
                links=[],
                status="ok",
            )

        street_hint = None
        seed: Optional[Seed] = None
        snap: Optional[AreaSnapshot] = None
        place: Optional[NodePlace] = None

        if canonical_node_id and lat is not None and lng is not None:
            snap = self._snapshot_at(lat, lng)
            place = place_node(snap, canonical_node_id)
        if place is None and image_id:
            meta = self.imagery.get_metadata(image_id=image_id)
            if meta is None:
                raise APIException(f"Image ID {image_id} not found.")
            lat, lng = meta.coordinates.latitude, meta.coordinates.longitude
        if place is None and address:
            lat, lng, street_hint = self._geocode(address)
        if place is None:
            if lat is None or lng is None:
                raise APIException("generatePanoramaView needs coordinates (or an address) to locate the node.")
            if snap is None:
                snap = self._snapshot_at(lat, lng)
            seed = pick_seed(snap, lat, lng, street_hint=street_hint)
            if seed is None:
                raise APIException(f"No imagery available near {lat:.5f}, {lng:.5f}.")
            place = seed.place

        if seed is not None:
            ref = seed.image
        else:
            # If the client told us which image it's currently looking at, that
            # is the exact continuity context (lane, capture era) for links.
            hint = image_id if canonical_node_id else None
            ref = reference_image(snap, place, image_id=hint)
        if image_id:
            self.visited_image_ids.add(image_id)
            if snap:
                snap.visited_image_ids.add(image_id)
        if ref is not None:
            self.visited_image_ids.add(ref.meta.imageId)
            if snap:
                snap.visited_image_ids.add(ref.meta.imageId)

        if ref is None:
            links = self._links_payload(snap, place, ref)
            return ViewResponse(
                image=None,
                name=None,
                canonicalNodeId=place.node_id,
                actualHeading=heading,
                panoramaMetadata=PanoramaMetadata(
                    coordinates=LatLng(latitude=place.lat, longitude=place.lng),
                    captureTime="",
                ),
                links=links,
                status="path_only",
                message="No imagery is available at this location; you can still navigate to nearby points.",
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            image_future = executor.submit(self.imagery.get_image, ref.meta.imageId, heading, pitch)
            links = self._links_payload(snap, place, ref)
            image_data = image_future.result()

        if not image_data:
            raise APIException("Failed to retrieve image data.")

        view_lane = seed.lane if seed is not None else None
        return ViewResponse(
            image=image_data["image"],
            name=ref.meta.imageId,
            canonicalNodeId=place.node_id,
            actualHeading=image_data["actualHeading"],
            panoramaMetadata=PanoramaMetadata(
                coordinates=LatLng(latitude=place.lat, longitude=place.lng),
                captureTime=ref.meta.captureTime or "",
            ),
            links=links,
            status="ok",
            lane=view_lane,
            isPano=bool(ref.meta.isPano),
        )

    def _links_payload(self, snap: AreaSnapshot, place: NodePlace, ref) -> List[NavigationLink]:
        links: List[NavigationLink] = []
        for out in build_links(snap, place, ref):
            links.append(NavigationLink(
                canonicalNodeId=out.node_id,
                imageId=out.image.imageId if out.image else None,
                heading=out.bearing,
                coordinates=LatLng(latitude=out.lat, longitude=out.lng),
                distanceMeters=out.distance_m,
                streetName=out.street_name,
                status="ok" if out.image else "path_only",
                captureTime=out.image.captureTime if out.image else None,
                isPano=bool(out.image.isPano) if out.image else False,
                lane=out.lane,
                arrivalHeading=out.arrival_bearing,
            ))
        return links

    # ---------- debug ----------

    @log_call
    def get_local_graph(self, lat: float, lng: float, radius_m: float = 80.0) -> LocalGraphResponse:
        """Debug radar: the road skeleton around a point (intersections + block
        edges). The server holds no session, so the trail lives client-side."""
        snap = self._snapshot_at(lat, lng)
        deg_lat = radius_m / 111320.0
        deg_lng = radius_m / (111320.0 * max(math.cos(math.radians(lat)), 0.1))
        min_lat, max_lat = lat - deg_lat, lat + deg_lat
        min_lng, max_lng = lng - deg_lng, lng + deg_lng

        debug_nodes: List[DebugNode] = []
        emitted = set()
        for m in snap.roads.markers_in_bbox(min_lat, max_lat, min_lng, max_lng):
            if m.kind == "join":
                continue
            node_id = f"osm_{m.osm_node_id}"
            emitted.add(node_id)
            debug_nodes.append(DebugNode(
                canonicalNodeId=node_id,
                coordinates=LatLng(latitude=m.lat, longitude=m.lng),
                kind="intersection",
                status="unknown",
                imageId=None,
                streetNames=list(m.street_names),
            ))

        debug_edges: List[DebugEdge] = []
        seen_pairs = set()
        for m in snap.roads.markers_in_bbox(min_lat, max_lat, min_lng, max_lng):
            for leg in m.legs:
                res = snap.roads.walk(leg.way_id, leg.along, leg.direction, 300.0)
                if res.end_marker is None:
                    continue
                a_id, b_id = f"osm_{m.osm_node_id}", f"osm_{res.end_marker.osm_node_id}"
                pair = tuple(sorted((a_id, b_id)))
                if pair in seen_pairs or a_id not in emitted or b_id not in emitted:
                    continue
                seen_pairs.add(pair)
                debug_edges.append(DebugEdge(
                    fromId=a_id, toId=b_id, bearing=leg.bearing,
                    lengthMeters=res.total_dist, streetName=leg.street_name,
                ))

        return LocalGraphResponse(
            center=LatLng(latitude=lat, longitude=lng),
            radiusMeters=radius_m,
            currentNodeId=None,
            nodes=debug_nodes,
            edges=debug_edges,
        )
