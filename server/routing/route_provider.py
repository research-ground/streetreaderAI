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

"""RouteProvider — 5-Step Navigation Engine (Intersections + Direct Sequence Slices).

1. Identify OSM intersections (merging multi-node junctions and roundabouts)
   and walk between them to determine street block adjacency `(cid_a, cid_b)`.
2. Discover and expand 360° camera sequences near intersections, sorting each
   sequence's frames chronologically by `captureTime`.
3. Slice each sequence into contiguous passes `frames[idx_a : idx_b + 1]` that
   visit two adjacent intersections within `capture_max_m` (`30m`), with no
   intermediate intersection visit (`< 18m`), `sinuosity <= 1.35`, and `max_step <= 30m`.
4. Pick the single best sequence slice per street block and sample intermediate
   frames every `~step_m` (`18m`).
5. Unify each intersection to one canonical node (`osm_<cid>`) and connect each
   block as a bidirectional chain `[osm_<cid_a>, seq_<f1>, ..., osm_<cid_b>]`.
"""

import concurrent.futures
import math
import os
from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass, field, fields
from typing import Dict, List, Optional, Set, Tuple

from server.core.cache import graph_cache, query_audit, road_cache, window_cache
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
    RenderViewResponse,
    ViewResponse,
)
from server.routing.map_math import calculate_distance
from server.services.streetmap.base import RoadDataSource
from server.services.streetmap.local_extract_road_service import LocalExtractRoadService
from server.services.streetmap.overpass_road_service import (
    OsmMapApiRoadService,
    OverpassRoadService,
)

M_PER_DEG_LAT = 111139.0

_STREET_ABBREVS = {
    "n": "north", "s": "south", "e": "east", "w": "west",
    "ne": "northeast", "nw": "northwest", "se": "southeast", "sw": "southwest",
    "st": "street", "ave": "avenue", "av": "avenue", "blvd": "boulevard",
    "rd": "road", "dr": "drive", "pl": "place", "ln": "lane",
    "ct": "court", "pkwy": "parkway", "hwy": "highway", "ter": "terrace", "cir": "circle",
}


def _compass_bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dx = (lng2 - lng1) * math.cos(math.radians((lat1 + lat2) * 0.5))
    dy = lat2 - lat1
    return 0.0 if abs(dx) < 1e-12 and abs(dy) < 1e-12 else math.degrees(math.atan2(dx, dy)) % 360.0


def _ang_diff(a: float, b: float) -> float:
    return abs(((a - b + 180.0) % 360.0) - 180.0)


def _norm_street(name: Optional[str]) -> str:
    raw = (name or "").strip().casefold()
    if not raw:
        return ""
    tokens = [t.strip(".,") for t in raw.split() if t.strip(".,")]
    if len(tokens) > 1 and tokens[0].isdigit():
        tokens = tokens[1:]
    return " ".join(_STREET_ABBREVS.get(t, t) for t in tokens)


@dataclass(frozen=True)
class RouteParams:
    step_m: float = 18.0
    capture_max_m: float = 30.0
    junction_merge_m: float = 30.0
    max_sinuosity: float = 1.35
    max_frame_step_m: float = 30.0
    panos_only: bool = True
    snapshot_radius_m: float = field(default_factory=lambda: getattr(config, "ROUTE_SNAPSHOT_RADIUS_M", 350.0))
    overpass_timeout_s: float = field(default_factory=lambda: getattr(config, "OVERPASS_TIMEOUT_S", 30.0))

    @classmethod
    def from_env(cls) -> "RouteParams":
        overrides = {}
        for f in fields(cls):
            raw = os.environ.get(f"ROUTE_{f.name.upper()}")
            if raw is not None:
                overrides[f.name] = (
                    raw.strip().lower() in ("1", "true", "yes")
                    if isinstance(f.default, bool)
                    else float(raw)
                )
        return cls(**overrides)


# =====================================================================
# §1 ROAD GEOMETRY — Intersections & Block Adjacency (Step 1)
# =====================================================================


@dataclass(frozen=True)
class Leg:
    way_id: int
    along: float
    direction: int
    bearing: float
    street_name: str


@dataclass
class RoadMarker:
    osm_node_id: int
    lat: float
    lng: float
    kind: str  # "intersection" | "join" | "dead_end"
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


@dataclass
class WalkResult:
    slices: List[PathSlice]
    end_marker: Optional[RoadMarker]
    total_dist: float


@dataclass
class _Way:
    way_id: int
    pts: List[Tuple[float, float]]
    offsets: List[float]
    length: float
    name: str
    node_alongs: List[Tuple[float, int]]


def _next_marker(markers: List[Tuple[float, int]], along: float, direction: int) -> Optional[Tuple[float, int]]:
    if direction > 0:
        i = bisect_right(markers, (along + 0.1, 1 << 62))
        return markers[i] if i < len(markers) else None
    i = bisect_left(markers, (along - 0.1, -1)) - 1
    return markers[i] if i >= 0 else None


class RoadNetwork:
    """Parses OSM ways, merges multi-node junctions into unified intersection
    clusters, and walks along streets across degree-2 joins."""

    def __init__(self, params: Optional[RouteParams] = None):
        self.p = params or RouteParams()
        self._ways: Dict[int, _Way] = {}
        self._node_ways: Dict[int, Dict[int, List[float]]] = defaultdict(dict)
        self._node_coords: Dict[int, Tuple[float, float]] = {}
        self._markers: Dict[int, RoadMarker] = {}
        self._way_markers: Dict[int, List[Tuple[float, int]]] = {}
        self._cluster_rep: Dict[int, int] = {}
        self._cluster_members: Dict[int, List[int]] = defaultdict(list)

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
            w = _Way(way_id, pts, offsets, offsets[-1], name, sorted(zip(offsets, osm_nodes)))
            self._ways[way_id] = w
            for along, nid in w.node_alongs:
                self._node_ways[nid].setdefault(way_id, []).append(along)
            for i, nid in enumerate(osm_nodes):
                self._node_coords[nid] = pts[i]
            touched_nodes.update(osm_nodes)
            added += 1

        for nid in touched_nodes:
            self._rebuild_marker(nid)
        for way_id, w in self._ways.items():
            self._way_markers[way_id] = sorted((along, nid) for along, nid in w.node_alongs if nid in self._markers)
        self._rebuild_clusters()
        return added

    def _should_merge_markers(self, a: RoadMarker, b: RoadMarker) -> bool:
        d = calculate_distance(a.lat, a.lng, b.lat, b.lng)
        if d > self.p.junction_merge_m:
            return False
        if d <= 6.0:
            return True
        shared_ways = set(self._node_ways.get(a.osm_node_id, ())) & set(self._node_ways.get(b.osm_node_id, ()))
        if d <= 20.0:
            for wid in shared_ways:
                w = self._ways.get(wid)
                if w and w.length <= 65.0 and (not w.name or w.pts[0] == w.pts[-1]):
                    return True
        sa = {s for s in a.street_names if s}
        sb = {s for s in b.street_names if s}
        if len(sa) >= 2 and sa == sb:
            for sname in sa:
                wa = {l.way_id for l in a.legs if l.street_name == sname}
                wb = {l.way_id for l in b.legs if l.street_name == sname}
                if len(wa) >= 1 and len(wb) >= 1 and not (wa & wb):
                    return True
        return False

    def _rebuild_clusters(self) -> None:
        decision = [m for m in self._markers.values() if m.kind == "intersection"]
        parent = {m.osm_node_id: m.osm_node_id for m in decision}
        members_by_root: Dict[int, List[RoadMarker]] = {m.osm_node_id: [m] for m in decision}

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        pairs = sorted(
            (
                (calculate_distance(a.lat, a.lng, b.lat, b.lng), a, b)
                for i, a in enumerate(decision)
                for b in decision[i + 1 :]
                if self._should_merge_markers(a, b)
            ),
            key=lambda item: (item[0], item[1].osm_node_id, item[2].osm_node_id),
        )
        for _, a, b in pairs:
            ra, rb = find(a.osm_node_id), find(b.osm_node_id)
            if ra == rb:
                continue
            combined = members_by_root[ra] + members_by_root[rb]
            if max(calculate_distance(x.lat, x.lng, y.lat, y.lng) for x in combined for y in combined) <= self.p.junction_merge_m:
                lo, hi = min(ra, rb), max(ra, rb)
                parent[hi] = lo
                members_by_root[lo] = combined
                del members_by_root[hi]

        self._cluster_rep = {nid: find(nid) for nid in parent}
        self._cluster_members = defaultdict(list)
        for nid, rep in self._cluster_rep.items():
            self._cluster_members[rep].append(nid)

    def junction_of(self, marker: RoadMarker) -> RoadMarker:
        return self._markers.get(self._cluster_rep.get(marker.osm_node_id, marker.osm_node_id), marker)

    def junction_legs(self, marker: RoadMarker) -> List[Leg]:
        rep_id = self._cluster_rep.get(marker.osm_node_id, marker.osm_node_id)
        members = set(self._cluster_members.get(rep_id, [marker.osm_node_id]))
        raw_legs = [leg for mid in members if mid in self._markers for leg in self._markers[mid].legs]
        if len(members) <= 1:
            return raw_legs
        external_legs: List[Leg] = []
        for leg in raw_legs:
            markers = self._way_markers.get(leg.way_id, [])
            w_leg = self._ways.get(leg.way_id)
            if (
                w_leg and w_leg.length <= 65.0 and len(w_leg.pts) >= 3 and w_leg.pts[0] == w_leg.pts[-1]
                and markers and all(m_nid in members or (self._markers.get(m_nid) and self._markers[m_nid].kind == "join") for _, m_nid in markers)
            ):
                continue
            nxt = _next_marker(markers, leg.along, leg.direction)
            if nxt is not None and nxt[1] in members and abs(nxt[0] - leg.along) <= self.p.junction_merge_m * 1.5:
                continue
            fwd_check = self.walk(leg.way_id, leg.along, leg.direction, 60.0)
            if fwd_check.end_marker is not None and fwd_check.end_marker.osm_node_id in members:
                continue
            external_legs.append(leg)
        return external_legs or raw_legs

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
        elif len(legs) == 2 and (
            len({l.street_name for l in legs}) == 1
            or (
                _ang_diff(legs[0].bearing, (legs[1].bearing + 180.0) % 360.0) <= 25.0
                and (
                    not legs[0].street_name
                    or not legs[1].street_name
                    or any(k in (l.street_name or "").casefold() for l in legs for k in ("bridge", "tunnel", "viaduct", "overpass"))
                )
            )
        ):
            kind = "join"
        else:
            kind = "intersection"
        lat, lng = self._node_coords[osm_node_id]
        seen: set = set()
        uniq = tuple(n for n in names if not (n in seen or seen.add(n)))
        self._markers[osm_node_id] = RoadMarker(osm_node_id, lat, lng, kind, legs, uniq)
        return True

    def marker(self, osm_node_id: int) -> Optional[RoadMarker]:
        return self._markers.get(osm_node_id)

    def bearing_at(self, way_id: int, along: float, direction: int) -> float:
        w = self._ways[way_id]
        sample = max(0.01, min(along + (0.05 if direction >= 0 else -0.05), w.length - 0.01))
        i = max(0, min(bisect_right(w.offsets, sample) - 1, len(w.pts) - 2))
        p1, p2 = (w.pts[i], w.pts[i + 1]) if direction >= 0 else (w.pts[i + 1], w.pts[i])
        return _compass_bearing(p1[0], p1[1], p2[0], p2[1])

    def walk(self, way_id: int, along: float, direction: int, max_dist: float, max_hops: int = 20) -> WalkResult:
        slices: List[PathSlice] = []
        dist = 0.0
        cur_way, cur_along, cur_dir = way_id, along, direction
        for _ in range(max_hops):
            w = self._ways.get(cur_way)
            if w is None:
                break
            nxt = _next_marker(self._way_markers.get(cur_way, []), cur_along, cur_dir)
            target = nxt[0] if nxt is not None else (w.length if cur_dir > 0 else 0.0)
            seg_len = abs(target - cur_along)
            if dist + seg_len >= max_dist:
                slices.append(PathSlice(cur_way, cur_along, cur_along + cur_dir * (max_dist - dist), cur_dir, dist))
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
            arrived_by = next((l for l in marker.legs if l.way_id == cur_way and abs(l.along - target) < 0.6 and l.direction == -cur_dir), None)
            onward = next((l for l in marker.legs if l is not arrived_by), None)
            if onward is None or arrived_by is None:
                return WalkResult(slices, marker, dist)
            cur_way, cur_along, cur_dir = onward.way_id, onward.along, onward.direction
        return WalkResult(slices, None, dist)


# =====================================================================
# §2 5-STEP SEQUENCE GRAPH SOLVER (Steps 2–5)
# =====================================================================


@dataclass
class NodePlace:
    node_id: str
    kind: str  # "intersection" | "waypoint"
    lat: float
    lng: float
    image: Optional[LocationMetadata] = None
    street_names: Tuple[str, ...] = ()
    osm_node_id: Optional[int] = None


@dataclass(frozen=True)
class OutLink:
    node_id: str
    bearing: float
    distance_m: float
    lat: float
    lng: float
    street_name: str
    image: Optional[LocationMetadata]
    arrival_bearing: Optional[float] = None


@dataclass(frozen=True)
class Seed:
    place: NodePlace
    image: LocationMetadata


class AreaSnapshot:
    """Solves the local navigation graph around a position using the 5-step
    Intersections + Direct Sequence Slices algorithm."""

    def __init__(
        self,
        roads: RoadNetwork,
        images: List[LocationMetadata],
        provider=None,
        params: Optional[RouteParams] = None,
        visited_image_ids: Optional[Set[str]] = None,
        broken_image_ids: Optional[Set[str]] = None,
        active_sequences: Optional[List[str]] = None,
    ):
        self.p = params or getattr(roads, "p", None) or RouteParams()
        self.roads = roads
        self.images: List[LocationMetadata] = []
        self._image_ids: Set[str] = set()
        self.provider = provider
        self.visited_image_ids: Set[str] = set(visited_image_ids or [])
        self.broken_image_ids: Set[str] = set(broken_image_ids or [])
        self.active_sequences: List[str] = active_sequences if active_sequences is not None else []
        self._expanded_sequences: Set[str] = set()
        self._fetched_junctions: Set[int] = set()
        self._discovered_cids: Set[int] = set()

        self._solved: bool = False
        self.clusters: Dict[int, dict] = {}
        self.adjacent_pairs: Dict[Tuple[int, int], str] = {}
        self.chosen_passes: Dict[Tuple[int, int], dict] = {}
        self.canonical_inter_frame: Dict[int, LocationMetadata] = {}
        self.nodes: Dict[str, NodePlace] = {}
        self.adj: Dict[str, List[OutLink]] = defaultdict(list)

        if images:
            self._ingest_metas(images)

    def _provider_name(self) -> str:
        return getattr(self.provider, "provider_name", None) or self.provider.__class__.__name__ if self.provider else "none"

    def _ingest_metas(self, metas: List[LocationMetadata]) -> None:
        for m in metas:
            if m.imageId and m.imageId not in self._image_ids and m.imageId not in self.broken_image_ids:
                if (not self.p.panos_only or m.isPano) and m.coordinates is not None:
                    self.images.append(m)
                    self._image_ids.add(m.imageId)
                    self._solved = False

    def expand_sequence(self, seq_id: Optional[str], cache_only: bool = False) -> int:
        if not seq_id or self.provider is None or str(seq_id) in self._expanded_sequences:
            return 0
        seq_str = str(seq_id)
        seq_key = (self._provider_name(), "seq", seq_str)
        cached_raw = window_cache.get(seq_key)
        if cached_raw is not None:
            query_audit.record_cache_hit("sequence")
            metas = [LocationMetadata(**d) if isinstance(d, dict) else d for d in cached_raw]
        elif not cache_only and hasattr(self.provider, "get_sequence"):
            res = self.provider.get_sequence(seq_str)
            if not isinstance(res, list):
                self._expanded_sequences.add(seq_str)
                return 0
            metas = res
            if window_cache.get(seq_key) is None:
                window_cache.put(seq_key, [m.model_dump() if hasattr(m, "model_dump") else m for m in metas])
        else:
            return 0
        self._expanded_sequences.add(seq_str)
        if metas:
            self._ingest_metas(metas)
        return len(metas)

    def ensure_junction(self, cid: int, c_lat: float, c_lng: float, cache_only: bool = False) -> List[LocationMetadata]:
        if self.provider is None:
            return []
        j_key = (self._provider_name(), "junction_v3", cid)
        cached = window_cache.get(j_key)
        if cached is not None:
            query_audit.record_cache_hit("window")
            metas = [LocationMetadata(**d) if isinstance(d, dict) else d for d in cached]
            self._ingest_metas(metas)
            self._fetched_junctions.add(cid)
            return metas
        if cache_only or cid in self._fetched_junctions:
            return []
        self._fetched_junctions.add(cid)
        d_lat = self.p.capture_max_m / M_PER_DEG_LAT
        d_lng = self.p.capture_max_m / (M_PER_DEG_LAT * max(math.cos(math.radians(c_lat)), 0.1))
        metas = self.provider.get_metadata_bbox(c_lat - d_lat, c_lng - d_lng, c_lat + d_lat, c_lng + d_lng) or []
        window_cache.put(j_key, [m.model_dump() if hasattr(m, "model_dump") else m for m in metas])
        self._ingest_metas(metas)
        return metas

    def _build_clusters_and_adjacency(self) -> None:
        self.clusters.clear()
        self.adjacent_pairs.clear()
        inter_markers = [m for m in self.roads._markers.values() if m.kind == "intersection"]
        use_kinds = {"intersection"} if len(inter_markers) >= 2 else {"intersection", "dead_end"}

        for m in self.roads._markers.values():
            if m.kind not in use_kinds:
                continue
            rep = self.roads.junction_of(m) if m.kind == "intersection" else m
            if rep.osm_node_id not in self.clusters:
                member_ids = self.roads._cluster_members.get(rep.osm_node_id, [rep.osm_node_id])
                members = [self.roads._markers[mid] for mid in member_ids if mid in self.roads._markers]
                legs = self.roads.junction_legs(rep) if m.kind == "intersection" else list(rep.legs)
                self.clusters[rep.osm_node_id] = {
                    "id": f"osm_{rep.osm_node_id}",
                    "rep_id": rep.osm_node_id,
                    "lat": sum(x.lat for x in members) / len(members),
                    "lng": sum(x.lng for x in members) / len(members),
                    "streets": sorted({l.street_name for l in legs if l.street_name}),
                    "legs": legs,
                }

        for cid, c in self.clusters.items():
            for leg in c["legs"]:
                w_res = self.roads.walk(leg.way_id, leg.along, leg.direction, 600.0)
                if w_res.end_marker is not None:
                    em = w_res.end_marker
                    rep_cid = self.roads.junction_of(em).osm_node_id if em.kind == "intersection" else em.osm_node_id
                    if rep_cid != cid and rep_cid in self.clusters:
                        pair_key = (min(cid, rep_cid), max(cid, rep_cid))
                        if pair_key not in self.adjacent_pairs or (not self.adjacent_pairs[pair_key] and leg.street_name):
                            self.adjacent_pairs[pair_key] = leg.street_name or ""

    def discover_and_expand(self, center_lat: float, center_lng: float, radius_m: float = 45.0) -> None:
        if not self.clusters:
            self._build_clusters_and_adjacency()
        if self.provider is None:
            return

        near_cids = {
            cid for cid, c in self.clusters.items()
            if calculate_distance(center_lat, center_lng, c["lat"], c["lng"]) <= radius_m
        }
        if not near_cids and self.clusters:
            near_cids.update(
                sorted(self.clusters, key=lambda k: calculate_distance(center_lat, center_lng, self.clusters[k]["lat"], self.clusters[k]["lng"]))[:2]
            )
        if near_cids.issubset(self._discovered_cids):
            return
        self._discovered_cids.update(near_cids)

        neighbor_cids = set(near_cids)
        for cid_a, cid_b in self.adjacent_pairs:
            if cid_a in near_cids or cid_b in near_cids:
                neighbor_cids.update((cid_a, cid_b))

        for cid in neighbor_cids:
            self.ensure_junction(cid, self.clusters[cid]["lat"], self.clusters[cid]["lng"], cache_only=True)

        missing = [cid for cid in neighbor_cids if cid not in self._fetched_junctions]
        if len(missing) == 1:
            c = self.clusters[missing[0]]
            self.ensure_junction(missing[0], c["lat"], c["lng"], cache_only=False)
        elif len(missing) > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(missing))) as ex:
                for f in [ex.submit(self.ensure_junction, cid, self.clusters[cid]["lat"], self.clusters[cid]["lng"], False) for cid in missing]:
                    try:
                        f.result()
                    except Exception as e:
                        logger.debug(f"Junction bbox fetch failed: {e}")

        for sid in list({m.sequenceId for m in self.images if m.sequenceId}):
            self.expand_sequence(sid, cache_only=True)

        if not hasattr(self.provider, "get_sequence"):
            return

        seq_dist_at: Dict[int, Dict[str, float]] = defaultdict(dict)
        for m in self.images:
            if not m.sequenceId or m.coordinates is None or (self.p.panos_only and not m.isPano):
                continue
            sid = str(m.sequenceId)
            mlat, mlng = m.coordinates.latitude, m.coordinates.longitude
            for cid in neighbor_cids:
                d = calculate_distance(mlat, mlng, self.clusters[cid]["lat"], self.clusters[cid]["lng"])
                if d <= self.p.capture_max_m and d < seq_dist_at[cid].get(sid, float("inf")):
                    seq_dist_at[cid][sid] = d

        to_expand: List[str] = []
        for cid_a, cid_b in self.adjacent_pairs:
            if cid_a not in near_cids and cid_b not in near_cids:
                continue
            shared = set(seq_dist_at[cid_a]) & set(seq_dist_at[cid_b])
            ranked = sorted(shared, key=lambda s: seq_dist_at[cid_a][s] + seq_dist_at[cid_b][s] - (10.0 if s in self.active_sequences else 0.0))
            for sid in ranked[:2]:
                if sid not in self._expanded_sequences and sid not in to_expand:
                    to_expand.append(sid)

        if not to_expand and not any(
            (set(seq_dist_at[a]) & set(seq_dist_at[b])) & self._expanded_sequences
            for a, b in self.adjacent_pairs if a in near_cids or b in near_cids
        ):
            fallback = {
                sid: min(seq_dist_at[cid][sid] for cid in near_cids if sid in seq_dist_at[cid])
                for cid in near_cids for sid in seq_dist_at[cid] if sid not in self._expanded_sequences
            }
            to_expand.extend(sid for sid, _ in sorted(fallback.items(), key=lambda kv: kv[1])[:2])

        if len(to_expand) == 1:
            self.expand_sequence(to_expand[0], cache_only=False)
        elif len(to_expand) > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(to_expand))) as ex:
                for f in [ex.submit(self.expand_sequence, sid, False) for sid in to_expand]:
                    try:
                        f.result()
                    except Exception as e:
                        logger.debug(f"Sequence expansion failed: {e}")

    def solve(self, center_lat: Optional[float] = None, center_lng: Optional[float] = None, radius_m: float = 45.0) -> None:
        if not self.clusters:
            self._build_clusters_and_adjacency()
        if center_lat is not None and center_lng is not None and self.provider is not None:
            self.discover_and_expand(center_lat, center_lng, radius_m=radius_m)
        if self._solved:
            return

        self.chosen_passes.clear()
        self.canonical_inter_frame.clear()
        self.nodes.clear()
        self.adj.clear()

        sequences: Dict[str, List[LocationMetadata]] = defaultdict(list)
        none_seq_frames: List[LocationMetadata] = []
        for m in self.images:
            if m.imageId not in self.broken_image_ids and m.coordinates is not None and (not self.p.panos_only or m.isPano):
                (sequences[str(m.sequenceId)] if m.sequenceId else none_seq_frames).append(m)

        for sid in list(sequences):
            frames = list({f.imageId: f for f in sequences[sid]}.values())
            if len(frames) < 2:
                del sequences[sid]
            else:
                frames.sort(key=lambda x: (str(x.captureTime or ""), x.imageId))
                sequences[sid] = frames

        if len(none_seq_frames) >= 2:
            sequences["__synthetic__"] = sorted(
                {f.imageId: f for f in none_seq_frames}.values(),
                key=lambda x: (round(x.coordinates.latitude, 6), round(x.coordinates.longitude, 6), str(x.captureTime or ""), x.imageId),
            )

        inter_radius_m = self.p.capture_max_m
        passes_by_pair: Dict[Tuple[int, int], List[dict]] = defaultdict(list)

        for sid, frames in sequences.items():
            visits_by_cid: Dict[int, List[List[Tuple[int, float]]]] = defaultdict(list)
            for idx, f in enumerate(frames):
                lat, lng = f.coordinates.latitude, f.coordinates.longitude
                for cid, c in self.clusters.items():
                    d = calculate_distance(lat, lng, c["lat"], c["lng"])
                    if d <= inter_radius_m:
                        if visits_by_cid[cid] and idx - visits_by_cid[cid][-1][-1][0] <= 8:
                            visits_by_cid[cid][-1].append((idx, d))
                        else:
                            visits_by_cid[cid].append([(idx, d)])

            visits = sorted(
                [(cid, *min(g, key=lambda x: x[1])) for cid, groups in visits_by_cid.items() for g in groups],
                key=lambda x: x[1],
            )
            for v_i in range(len(visits)):
                for v_j in range(v_i + 1, min(len(visits), v_i + 4)):
                    cid_a, idx_a, d_a = visits[v_i]
                    cid_b, idx_b, d_b = visits[v_j]
                    pair_key = (min(cid_a, cid_b), max(cid_a, cid_b))
                    if cid_a == cid_b or idx_b <= idx_a or pair_key not in self.adjacent_pairs:
                        continue
                    if any(cid_m not in (cid_a, cid_b) and idx_a + 3 < idx_m < idx_b - 3 and d_m < 18.0 for cid_m, idx_m, d_m in visits[v_i + 1 : v_j]):
                        continue
                    sub_frames = frames[idx_a : idx_b + 1]
                    steps = [
                        calculate_distance(f1.coordinates.latitude, f1.coordinates.longitude, f2.coordinates.latitude, f2.coordinates.longitude)
                        for f1, f2 in zip(sub_frames[:-1], sub_frames[1:])
                    ]
                    path_len = sum(steps)
                    max_step = max(steps, default=0.0)
                    straight_d = calculate_distance(self.clusters[cid_a]["lat"], self.clusters[cid_a]["lng"], self.clusters[cid_b]["lat"], self.clusters[cid_b]["lng"])
                    sinuosity = path_len / max(straight_d, 1.0)
                    if sinuosity > self.p.max_sinuosity or max_step > max(self.p.max_frame_step_m, self.p.step_m * 1.6):
                        continue
                    score = abs(sinuosity - 1.0) * 50.0 + (d_a + d_b) + max_step - (5.0 if sid in self.active_sequences else 0.0)
                    passes_by_pair[pair_key].append({
                        "seq_id": sid, "cid_a": cid_a, "cid_b": cid_b, "frames": sub_frames,
                        "path_len": path_len, "score": score,
                    })

        intersection_endpoint_frames: Dict[int, List[LocationMetadata]] = defaultdict(list)
        for pair_key, cand_list in sorted(passes_by_pair.items()):
            best = min(cand_list, key=lambda x: x["score"])
            frames = best["frames"]
            cum_d = [0.0]
            for f1, f2 in zip(frames[:-1], frames[1:]):
                cum_d.append(cum_d[-1] + calculate_distance(f1.coordinates.latitude, f1.coordinates.longitude, f2.coordinates.latitude, f2.coordinates.longitude))
            total_d = cum_d[-1]
            n_steps = max(1, round(total_d / max(self.p.step_m, 5.0)))
            sampled = [frames[0]]
            if len(frames) > 2:
                for k in range(1, n_steps):
                    best_i = min(range(1, len(frames) - 1), key=lambda i: abs(cum_d[i] - total_d * (k / n_steps)))
                    if sampled[-1].imageId != frames[best_i].imageId:
                        sampled.append(frames[best_i])
            if sampled[-1].imageId != frames[-1].imageId:
                sampled.append(frames[-1])
            best["sampled"] = sampled
            self.chosen_passes[pair_key] = best
            intersection_endpoint_frames[best["cid_a"]].append(sampled[0])
            intersection_endpoint_frames[best["cid_b"]].append(sampled[-1])

        for cid, end_frames in intersection_endpoint_frames.items():
            c = self.clusters[cid]
            self.canonical_inter_frame[cid] = min(
                end_frames,
                key=lambda f: (
                    sum(calculate_distance(f.coordinates.latitude, f.coordinates.longitude, ef.coordinates.latitude, ef.coordinates.longitude) for ef in end_frames) / len(end_frames)
                    + 0.5 * calculate_distance(f.coordinates.latitude, f.coordinates.longitude, c["lat"], c["lng"])
                ),
            )

        for cid, c in self.clusters.items():
            f_inter = self.canonical_inter_frame.get(cid)
            if f_inter is None:
                near_imgs = [m for m in self.images if calculate_distance(c["lat"], c["lng"], m.coordinates.latitude, m.coordinates.longitude) <= inter_radius_m]
                if near_imgs:
                    f_inter = min(near_imgs, key=lambda m: calculate_distance(c["lat"], c["lng"], m.coordinates.latitude, m.coordinates.longitude))
                    self.canonical_inter_frame[cid] = f_inter
            node_id = f"osm_{cid}"
            self.nodes[node_id] = NodePlace(
                node_id=node_id, kind="intersection",
                lat=f_inter.coordinates.latitude if f_inter else c["lat"],
                lng=f_inter.coordinates.longitude if f_inter else c["lng"],
                image=f_inter, street_names=tuple(c["streets"]), osm_node_id=cid,
            )

        for pair_key, info in self.chosen_passes.items():
            street_name = self.adjacent_pairs.get(pair_key, "")
            node_a, node_b = self.nodes[f"osm_{info['cid_a']}"], self.nodes[f"osm_{info['cid_b']}"]
            mid_nodes: List[NodePlace] = []
            for f_mid in info["sampled"][1:-1]:
                if (node_a.image and f_mid.imageId == node_a.image.imageId) or (node_b.image and f_mid.imageId == node_b.image.imageId):
                    continue
                if calculate_distance(node_a.lat, node_a.lng, f_mid.coordinates.latitude, f_mid.coordinates.longitude) < 5.0:
                    continue
                if calculate_distance(node_b.lat, node_b.lng, f_mid.coordinates.latitude, f_mid.coordinates.longitude) < 5.0:
                    continue
                wp_id = f"seq_{f_mid.imageId}"
                wp_node = NodePlace(wp_id, "waypoint", f_mid.coordinates.latitude, f_mid.coordinates.longitude, f_mid, (street_name,) if street_name else ())
                self.nodes[wp_id] = wp_node
                mid_nodes.append(wp_node)

            chain = [node_a] + mid_nodes + [node_b]
            info["chain"] = chain
            for u, v in zip(chain[:-1], chain[1:]):
                d_uv = round(calculate_distance(u.lat, u.lng, v.lat, v.lng), 1)
                brg_uv = round(_compass_bearing(u.lat, u.lng, v.lat, v.lng), 1)
                brg_vu = round(_compass_bearing(v.lat, v.lng, u.lat, u.lng), 1)
                self.adj[u.node_id].append(OutLink(v.node_id, brg_uv, d_uv, v.lat, v.lng, street_name, v.image, brg_uv))
                self.adj[v.node_id].append(OutLink(u.node_id, brg_vu, d_uv, u.lat, u.lng, street_name, u.image, brg_vu))

        self._solved = True


# =====================================================================
# §3 GRAPH QUERIES & ROUTE PROVIDER FACADE
# =====================================================================


def place_node(snap: AreaSnapshot, node_id: str) -> Optional[NodePlace]:
    if not snap._solved:
        snap.solve()
    if node_id in snap.nodes:
        return snap.nodes[node_id]
    if node_id.startswith("osm_"):
        try:
            mk = snap.roads.marker(int(node_id[4:]))
        except ValueError:
            return None
        if mk is not None:
            rep = snap.roads.junction_of(mk)
            rep_key = f"osm_{rep.osm_node_id}"
            return snap.nodes.get(rep_key) or NodePlace(
                rep_key, "intersection", rep.lat, rep.lng,
                snap.canonical_inter_frame.get(rep.osm_node_id), rep.street_names, rep.osm_node_id,
            )
    if node_id.startswith("seq_"):
        img_id = node_id[4:]
        for m in snap.images:
            if m.imageId == img_id:
                return NodePlace(node_id, "waypoint", m.coordinates.latitude, m.coordinates.longitude, m)
    return None


def reference_image(snap: AreaSnapshot, place: NodePlace, image_id: Optional[str] = None) -> Optional[LocationMetadata]:
    if not snap._solved:
        snap.solve(place.lat, place.lng)
    if place.image is not None and place.image.imageId not in snap.broken_image_ids:
        return place.image
    if image_id and image_id not in snap.broken_image_ids:
        for m in snap.images:
            if m.imageId == image_id:
                return m
    return snap.nodes[place.node_id].image if place.node_id in snap.nodes else None


def pick_seed(snap: AreaSnapshot, lat: float, lng: float, street_hint: Optional[str] = None) -> Optional[Seed]:
    snap.solve(lat, lng)
    candidates = [n for n in snap.nodes.values() if n.image is not None and snap.adj.get(n.node_id)] or [
        n for n in snap.nodes.values() if n.image is not None
    ]
    if not candidates and snap.provider is not None:
        d_lat = 35.0 / M_PER_DEG_LAT
        d_lng = 35.0 / (M_PER_DEG_LAT * max(math.cos(math.radians(lat)), 0.1))
        probe = snap.provider.get_metadata_bbox(lat - d_lat, lng - d_lng, lat + d_lat, lng + d_lng) or []
        snap._ingest_metas(probe)
        for m in probe:
            if m.sequenceId:
                snap.expand_sequence(m.sequenceId, cache_only=False)
        snap.solve(lat, lng)
        candidates = [n for n in snap.nodes.values() if n.image is not None and snap.adj.get(n.node_id)] or [
            n for n in snap.nodes.values() if n.image is not None
        ]
    if not candidates:
        return None
    hint_norm = _norm_street(street_hint) if street_hint else ""
    if hint_norm:
        named = [
            n for n in candidates
            if any(_norm_street(s) == hint_norm for s in n.street_names)
            and calculate_distance(lat, lng, n.lat, n.lng) <= 100.0
        ]
        if named:
            candidates = named
    best = min(candidates, key=lambda n: calculate_distance(lat, lng, n.lat, n.lng))
    return Seed(place=best, image=best.image)


def build_links(snap: AreaSnapshot, place: NodePlace, ref: Optional[LocationMetadata] = None) -> List[OutLink]:
    if not snap._solved or place.node_id not in snap.adj:
        snap.solve(place.lat, place.lng)
    return list(snap.adj.get(place.node_id, []))


class RouteProvider:
    """Stateless facade wired into Flask routes (`/v1/streetreader:generatePanoramaView`
    and `/v1/streetreader:getLocalGraph`)."""

    def __init__(self, imagery, location=None, params: Optional[RouteParams] = None, road_sources: Optional[List[RoadDataSource]] = None):
        self.imagery = imagery
        self.location = location
        self.p = params or RouteParams.from_env()
        self.road_sources: List[RoadDataSource] = (
            road_sources if road_sources is not None else [
                LocalExtractRoadService(),
                OsmMapApiRoadService(),
                OverpassRoadService(timeout_s=self.p.overpass_timeout_s),
            ]
        )
        self.broken_image_ids: Set[str] = set()
        self.visited_image_ids: Set[str] = set()
        self.active_sequences: List[str] = []
        self._tile_snapshots: Dict[Tuple[float, float], AreaSnapshot] = {}

    def _is_cache_enabled(self) -> bool:
        return bool(getattr(config, "SERVER_CACHE_ENABLED", True))

    def _node_cache_key(self, canonical_node_id: str, image_id: Optional[str] = None) -> Tuple[str, str, str]:
        prov = getattr(self.imagery, "provider_name", None) or self.imagery.__class__.__name__
        return (prov, str(canonical_node_id), str(image_id or ""))

    def _fetch_ways(self, lat: float, lng: float, radius_m: float) -> List[dict]:
        tile_deg = 0.004
        t_lat, t_lng = round(round(lat / tile_deg) * tile_deg, 5), round(round(lng / tile_deg) * tile_deg, 5)
        cache_radius = max(radius_m, 250.0)
        d_lat = cache_radius / M_PER_DEG_LAT
        d_lng = cache_radius / (M_PER_DEG_LAT * max(math.cos(math.radians(t_lat)), 0.1))
        r_key = (round(t_lat - d_lat, 5), round(t_lng - d_lng, 5), round(t_lat + d_lat, 5), round(t_lng + d_lng, 5))
        if self._is_cache_enabled():
            cached = road_cache.get(r_key)
            if cached is not None:
                query_audit.record_cache_hit("road")
                return cached
        ways: List[dict] = []
        for src in self.road_sources:
            try:
                ways = src.get_ways(*r_key) or []
                if ways:
                    break
            except Exception as e:
                logger.warning(f"Road source {src.__class__.__name__} failed: {e}")
        if ways and self._is_cache_enabled():
            road_cache.put(r_key, ways)
        return ways

    def _snapshot_at(self, lat: float, lng: float) -> AreaSnapshot:
        tile_deg = 0.004
        t_key = (round(round(lat / tile_deg) * tile_deg, 5), round(round(lng / tile_deg) * tile_deg, 5))
        if not self._is_cache_enabled() or len(road_cache) == 0:
            self._tile_snapshots.clear()
        if self._is_cache_enabled() and t_key in self._tile_snapshots:
            return self._tile_snapshots[t_key]
        rn = RoadNetwork(self.p)
        rn.add_ways(self._fetch_ways(lat, lng, self.p.snapshot_radius_m))
        snap = AreaSnapshot(
            roads=rn, images=[], provider=self.imagery, params=self.p,
            visited_image_ids=self.visited_image_ids, broken_image_ids=self.broken_image_ids,
            active_sequences=self.active_sequences,
        )
        if self._is_cache_enabled():
            if len(self._tile_snapshots) >= 16:
                self._tile_snapshots.pop(next(iter(self._tile_snapshots)))
            self._tile_snapshots[t_key] = snap
        return snap

    def _geocode(self, address: str) -> Tuple[float, float, Optional[str], Optional[str]]:
        if self.location is None:
            raise APIException("No geocoding service configured.")
        geo = self.location.geocode(address)
        if not geo or "lat" not in geo or "lng" not in geo:
            raise APIException(f"Could not locate address: {address}")
        formatted = geo.get("address") or address
        return float(geo["lat"]), float(geo["lng"]), geo.get("street") or address.split(",")[0].strip(), formatted

    @staticmethod
    def _street_label_from_names(street_names: Iterable[str]) -> Optional[str]:
        streets: List[str] = []
        for s in street_names:
            st = (s or "").strip()
            if st and st != "Unnamed Street" and st not in streets:
                streets.append(st)
        if len(streets) >= 2:
            return f"{streets[0]} & {streets[1]}"
        if len(streets) == 1:
            return streets[0]
        return None

    def _resolve_node_address(
        self,
        place: NodePlace,
        links: List[NavigationLink],
        geocoded_address: Optional[str] = None,
    ) -> Optional[str]:
        if geocoded_address:
            return geocoded_address
        label = self._street_label_from_names(
            list(place.street_names) + [l.streetName for l in links]
        )
        if label:
            return label
        if self.location is not None:
            try:
                rev = self.location.reverse_geocode(place.lat, place.lng)
                if isinstance(rev, dict) and rev.get("formatted_address"):
                    return rev["formatted_address"]
            except Exception as e:
                logger.warning(f"Reverse geocoding fallback failed at ({place.lat}, {place.lng}): {e}")
        return None

    @staticmethod
    def _to_nav_link(out: OutLink) -> NavigationLink:
        return NavigationLink(
            canonicalNodeId=out.node_id,
            imageId=out.image.imageId if out.image else None,
            heading=out.bearing,
            coordinates=LatLng(latitude=out.lat, longitude=out.lng),
            distanceMeters=out.distance_m,
            streetName=out.street_name,
            status="ok" if out.image else "path_only",
            captureTime=out.image.captureTime if out.image else None,
            isPano=bool(out.image.isPano) if out.image else False,
            arrivalHeading=out.arrival_bearing,
        )

    def _cache_solved_graph(self, snap: AreaSnapshot) -> None:
        if not self._is_cache_enabled():
            return
        for node_id, node in snap.nodes.items():
            out_links = snap.adj.get(node_id, [])
            if node.image is None or not out_links:
                continue
            nav_links = [self._to_nav_link(out) for out in out_links]
            address = self._street_label_from_names(
                list(node.street_names) + [l.streetName for l in nav_links]
            )
            payload = {
                "imageId": node.image.imageId,
                "canonicalNodeId": node.node_id,
                "coordinates": {"latitude": node.lat, "longitude": node.lng},
                "captureTime": node.image.captureTime or "",
                "address": address,
                "links": [l.model_dump() for l in nav_links],
                "status": "ok",
                "isPano": bool(node.image.isPano),
            }
            graph_cache.put(self._node_cache_key(node_id, None), payload)
            graph_cache.put(self._node_cache_key(node_id, node.image.imageId), payload)

    def render_view(
        self,
        image_id: str,
        heading: float = 0,
        pitch: float = 0,
    ) -> RenderViewResponse:
        if not image_id:
            raise APIException("Missing imageId.")
        image_data = self.imagery.get_image(image_id, heading, pitch)
        if not image_data:
            self.broken_image_ids.add(image_id)
            raise APIException("Failed to retrieve image data.")
        return RenderViewResponse(
            imageId=image_id,
            image=image_data["image"],
            actualHeading=image_data["actualHeading"],
        )

    def get_pano_view(
        self,
        canonical_node_id: Optional[str] = None,
        image_id: Optional[str] = None,
        address: Optional[str] = None,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        heading: float = 0,
        pitch: float = 0,
    ) -> ViewResponse:
        if canonical_node_id and not canonical_node_id.startswith("osm_") and self._is_cache_enabled():
            cached_node = graph_cache.get(self._node_cache_key(canonical_node_id, image_id)) or graph_cache.get(self._node_cache_key(canonical_node_id, None))
            cached_img_id = cached_node.get("imageId") if cached_node is not None else None
            if cached_node is not None and cached_img_id and "coordinates" in cached_node and cached_img_id not in self.broken_image_ids:
                query_audit.record_cache_hit("graph")
                image_data = self.imagery.get_image(cached_img_id, heading, pitch)
                if image_data:
                    return ViewResponse(
                        image=image_data["image"],
                        imageId=cached_img_id,
                        canonicalNodeId=cached_node["canonicalNodeId"],
                        actualHeading=image_data["actualHeading"],
                        coordinates=LatLng(**cached_node["coordinates"]),
                        captureTime=cached_node.get("captureTime", ""),
                        address=cached_node.get("address"),
                        links=[NavigationLink(**l) for l in cached_node.get("links", [])],
                        status=cached_node.get("status", "ok"),
                        isPano=bool(cached_node.get("isPano", True)),
                    )
                self.broken_image_ids.add(cached_img_id)

        street_hint = None
        geocoded_address: Optional[str] = None
        seed: Optional[Seed] = None
        snap: Optional[AreaSnapshot] = None
        place: Optional[NodePlace] = None

        if not canonical_node_id and not image_id:
            self.active_sequences.clear()
            self.visited_image_ids.clear()

        if canonical_node_id and lat is not None and lng is not None:
            snap = self._snapshot_at(lat, lng)
            snap.solve(lat, lng)
            place = place_node(snap, canonical_node_id)

        if place is None and image_id:
            meta = self.imagery.get_metadata(image_id=image_id)
            if meta is None:
                raise APIException(f"Image ID {image_id} not found.")
            lat, lng = meta.coordinates.latitude, meta.coordinates.longitude
            snap = self._snapshot_at(lat, lng)
            snap._ingest_metas([meta])
            if meta.sequenceId:
                snap.expand_sequence(meta.sequenceId, cache_only=False)
            snap.solve(lat, lng)
            place = place_node(snap, f"seq_{image_id}")

        if place is None and address:
            if lat is None or lng is None:
                lat, lng, street_hint, geocoded_address = self._geocode(address)
            else:
                street_hint = address.split(",")[0].strip()
                geocoded_address = address

        if place is None:
            if lat is None or lng is None:
                raise APIException("generatePanoramaView needs coordinates (or an address) to locate the node.")
            snap = snap or self._snapshot_at(lat, lng)
            seed = pick_seed(snap, lat, lng, street_hint=street_hint)
            if seed is None:
                raise APIException(f"No imagery available near {lat:.5f}, {lng:.5f}.")
            place = seed.place

        ref = seed.image if seed is not None else reference_image(snap, place, image_id=image_id)
        if ref is not None and ref.sequenceId and ref.sequenceId not in self.active_sequences:
            self.active_sequences.append(ref.sequenceId)

        links = [self._to_nav_link(out) for out in build_links(snap, place, ref)]
        resolved_address = self._resolve_node_address(place, links, geocoded_address=geocoded_address)

        if seed is not None and links and ref is not None:
            cam_h = float(ref.heading or 0.0)
            if min(_ang_diff(heading, l.heading) for l in links) > 45.0 or (heading == 0.0 and cam_h != 0.0 and _ang_diff(0.0, cam_h) > 120.0):
                heading = round(min(links, key=lambda l: _ang_diff(l.heading, cam_h)).heading, 1)

        if ref is None:
            return ViewResponse(
                image=None,
                imageId=None,
                canonicalNodeId=place.node_id,
                actualHeading=heading,
                coordinates=LatLng(latitude=place.lat, longitude=place.lng),
                captureTime="",
                address=resolved_address,
                links=links,
                status="path_only",
                message="No imagery is available at this location; you can still navigate to nearby points.",
            )

        image_data = self.imagery.get_image(ref.imageId, heading, pitch)
        if not image_data:
            self.broken_image_ids.add(ref.imageId)
            raise APIException("Failed to retrieve image data.")

        self.visited_image_ids.add(ref.imageId)
        if snap is not None:
            self._cache_solved_graph(snap)

        return ViewResponse(
            image=image_data["image"],
            imageId=ref.imageId,
            canonicalNodeId=place.node_id,
            actualHeading=image_data["actualHeading"],
            coordinates=LatLng(latitude=place.lat, longitude=place.lng),
            captureTime=ref.captureTime or "",
            address=resolved_address,
            links=links,
            status="ok",
            isPano=bool(ref.isPano),
        )

    @log_call
    def get_local_graph(self, lat: float, lng: float, radius_m: float = 80.0) -> LocalGraphResponse:
        snap = self._snapshot_at(lat, lng)
        snap.solve(lat, lng, radius_m=radius_m)

        deg_lat = radius_m / 111320.0
        deg_lng = radius_m / (111320.0 * max(math.cos(math.radians(lat)), 0.1))
        min_lat, max_lat = lat - deg_lat, lat + deg_lat
        min_lng, max_lng = lng - deg_lng, lng + deg_lng

        current_node_id: Optional[str] = None
        if snap.nodes:
            nearest = min(snap.nodes.values(), key=lambda n: calculate_distance(lat, lng, n.lat, n.lng))
            if calculate_distance(lat, lng, nearest.lat, nearest.lng) <= 50.0:
                current_node_id = nearest.node_id

        debug_nodes: List[DebugNode] = []
        in_box_node_ids: Set[str] = set()
        for node_id, node in snap.nodes.items():
            if min_lat <= node.lat <= max_lat and min_lng <= node.lng <= max_lng:
                in_box_node_ids.add(node_id)
                debug_nodes.append(
                    DebugNode(
                        canonicalNodeId=node.node_id,
                        coordinates=LatLng(latitude=node.lat, longitude=node.lng),
                        kind=node.kind,
                        status="ok" if node.image is not None else "path_only",
                        imageId=node.image.imageId if node.image else None,
                        streetNames=list(node.street_names),
                        sequenceId=node.image.sequenceId if node.image else None,
                    )
                )

        debug_edges: List[DebugEdge] = []
        for pair_key, info in snap.chosen_passes.items():
            chain: List[NodePlace] = info.get("chain") or []
            if len(chain) >= 2 and any(n.node_id in in_box_node_ids for n in chain):
                u, v = chain[0], chain[-1]
                debug_edges.append(
                    DebugEdge(
                        fromId=u.node_id, toId=v.node_id,
                        bearing=_compass_bearing(u.lat, u.lng, v.lat, v.lng),
                        lengthMeters=info["path_len"],
                        streetName=snap.adjacent_pairs.get(pair_key, ""),
                        polyline=[LatLng(latitude=n.lat, longitude=n.lng) for n in chain],
                    )
                )

        return LocalGraphResponse(
            center=LatLng(latitude=lat, longitude=lng),
            radiusMeters=radius_m,
            currentNodeId=current_node_id,
            nodes=debug_nodes,
            edges=debug_edges,
            queryAudit=query_audit.snapshot(),
        )
