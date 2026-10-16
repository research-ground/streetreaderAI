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

"""Unit tests for the 5-step navigation engine (Intersections + Direct Sequence Slices):
1. OSM intersection clustering and block adjacency across degree-2 joins.
2. Sequence grouping and chronological sorting (`captureTime`), filtering out flats.
3. Contiguous sequence slicing between adjacent intersections (`<= 30m` endpoint radius,
   `sinuosity <= 1.35`, `max_step <= 30m`, no L-turn corner shortcuts).
4. Intermediate frame sampling (`~step_m`) along a single winning sequence per block.
5. Unified intersection nodes (`osm_<cid>`) and bidirectional block chains.
"""

from unittest.mock import MagicMock

from server.core.cache import clear_all_caches, query_audit
from server.core.models import LatLng, LocationMetadata
from server.routing.route_provider import (
    AreaSnapshot,
    RoadNetwork,
    RouteParams,
    RouteProvider,
    build_links,
    pick_seed,
    place_node,
    reference_image,
)
from server.services.streetmap.base import RoadDataSource

M_PER_DEG = 111139.0
BASE = 0.0005
BASE_TS = 1_750_000_000_000


def deg(meters: float) -> float:
    return BASE + meters / M_PER_DEG


def make_way(way_id, points, node_ids, name=""):
    return {
        "id": way_id,
        "nodes": node_ids,
        "geometry": [{"lat": lat, "lon": lng} for lat, lng in points],
        "tags": {"name": name} if name else {},
    }


def two_intersection_block(length_m=100.0, name="North St"):
    """Two intersections osm_101 at (0, 50) and osm_102 at (length_m, 50)
    with cross streets so both endpoints are true OSM intersections."""
    w_main = make_way(
        1,
        [(deg(0), deg(50)), (deg(length_m), deg(50))],
        [101, 102],
        name=name,
    )
    w_cross_south = make_way(
        2,
        [(deg(0), deg(0)), (deg(0), deg(50)), (deg(0), deg(100))],
        [201, 101, 202],
        name="First Ave",
    )
    w_cross_north = make_way(
        3,
        [(deg(length_m), deg(0)), (deg(length_m), deg(50)), (deg(length_m), deg(100))],
        [301, 102, 302],
        name="Second Ave",
    )
    return [w_main, w_cross_south, w_cross_north]


def seq_frame(image_id, lat_m, lng_m, step_idx=0, seq="seq_1", pano=True, heading=0.0):
    return LocationMetadata(
        imageId=image_id,
        coordinates=LatLng(latitude=deg(lat_m), longitude=deg(lng_m)),
        captureTime=str(BASE_TS + step_idx * 1000),
        heading=heading,
        isPano=pano,
        sequenceId=seq,
    )


def snapshot(ways, images, params=None):
    p = params or RouteParams(step_m=18.0)
    roads = RoadNetwork(p)
    roads.add_ways(ways)
    snap = AreaSnapshot(roads, list(images), params=p)
    snap.solve()
    return snap


class TestFiveStepBlockSolver:
    def test_direct_sequence_slice_connects_intersections_with_sampled_waypoints(self):
        # Sequence walks from osm_101 (0m, 50m) to osm_102 (100m, 50m) every 5m on the east sidewalk (+4m)
        frames = [
            seq_frame(f"f_{i}", a, 54.0, step_idx=i, seq="seq_east")
            for i, a in enumerate(range(0, 101, 5))
        ]
        snap = snapshot(two_intersection_block(100.0), frames)

        assert (101, 102) in snap.chosen_passes
        n_start = place_node(snap, "osm_101")
        n_end = place_node(snap, "osm_102")
        assert n_start is not None and n_end is not None

        # Walk from osm_101 to osm_102 along the solved chain
        visited = [n_start.node_id]
        cur = n_start
        for _ in range(10):
            links = build_links(snap, cur)
            north_links = [l for l in links if l.bearing < 45 or l.bearing > 315]
            assert len(north_links) == 1
            nxt_link = north_links[0]
            assert nxt_link.image is not None
            cur = place_node(snap, nxt_link.node_id)
            visited.append(cur.node_id)
            if cur.node_id == "osm_102":
                break

        assert visited[0] == "osm_101"
        assert visited[-1] == "osm_102"
        assert 5 <= len(visited) <= 7
        # Intermediate nodes are sequence frame nodes
        for mid_id in visited[1:-1]:
            assert mid_id.startswith("seq_")

        # Walking backward from osm_102 to osm_101 traverses the exact same nodes in reverse
        back_visited = [n_end.node_id]
        cur = n_end
        for _ in range(10):
            links = build_links(snap, cur)
            south_links = [l for l in links if 135 < l.bearing < 225]
            assert len(south_links) == 1
            cur = place_node(snap, south_links[0].node_id)
            back_visited.append(cur.node_id)
            if cur.node_id == "osm_101":
                break
        assert back_visited == list(reversed(visited))

    def test_single_sequence_per_block_eliminates_cross_street_zigzag(self):
        # Two dense sequences on opposite sidewalks: seq_west (-5m) and seq_east (+4m, closer to corners)
        seq_west = [
            seq_frame(f"w_{i}", a, 45.0, step_idx=i, seq="seq_west")
            for i, a in enumerate(range(5, 96, 5))
        ]
        seq_east = [
            seq_frame(f"e_{i}", a, 53.0, step_idx=i, seq="seq_east")
            for i, a in enumerate(range(0, 101, 5))
        ]
        snap = snapshot(two_intersection_block(100.0), seq_west + seq_east)
        chosen = snap.chosen_passes[(101, 102)]
        assert chosen["seq_id"] == "seq_east"
        # Every sampled frame on the block comes from seq_east (zero cross-street jumps)
        assert all(f.sequenceId == "seq_east" for f in chosen["sampled"])

    def test_partial_sequence_not_reaching_second_intersection_is_rejected(self):
        # Sequence starts at osm_101 (0m) but ends mid-block at 40m (60m short of osm_102 at 100m,
        # outside the 30m intersection capture radius — matches the Burke Museum / S Brooklyn Ave WAI rule)
        partial_frames = [
            seq_frame(f"p_{i}", a, 53.0, step_idx=i, seq="seq_partial")
            for i, a in enumerate(range(0, 45, 5))
        ]
        snap = snapshot(two_intersection_block(100.0), partial_frames)
        assert (101, 102) not in snap.chosen_passes
        assert build_links(snap, place_node(snap, "osm_101")) == []

    def test_l_turn_sequence_through_middle_intersection_does_not_create_diagonal_shortcut(self):
        # Grid with osm_101 (0, 50), center intersection osm_999 (50, 50), and east intersection osm_202 (50, 100)
        w_ns = make_way(1, [(deg(0), deg(50)), (deg(50), deg(50)), (deg(100), deg(50))], [101, 999, 102], name="University Way")
        w_ew = make_way(2, [(deg(50), deg(0)), (deg(50), deg(50)), (deg(50), deg(100))], [201, 999, 202], name="NE 45th St")
        w_s = make_way(3, [(deg(0), deg(0)), (deg(0), deg(50)), (deg(0), deg(100))], [301, 101, 302], name="NE 43rd St")
        w_e = make_way(4, [(deg(0), deg(100)), (deg(50), deg(100)), (deg(100), deg(100))], [302, 202, 402], name="15th Ave NE")

        # Single sequence walks North from osm_101 to osm_999, then turns East to osm_202
        l_turn_frames = [
            seq_frame(f"n_{i}", a, 52.0, step_idx=i, seq="seq_turn")
            for i, a in enumerate(range(0, 51, 5))
        ] + [
            seq_frame(f"e_{i}", 48.0, x, step_idx=20 + i, seq="seq_turn")
            for i, x in enumerate(range(55, 101, 5))
        ]
        snap = snapshot([w_ns, w_ew, w_s, w_e], l_turn_frames)

        # Should solve the two orthogonal legs (101-999) and (202-999), never a diagonal (101-202)
        assert (101, 999) in snap.chosen_passes
        assert (202, 999) in snap.chosen_passes
        assert (101, 202) not in snap.chosen_passes

        # And osm_999 is unified to a single intersection node connecting both legs
        inter_999 = place_node(snap, "osm_999")
        links_999 = build_links(snap, inter_999)
        assert len(links_999) == 2

    def test_split_roadway_intersections_merge_into_one_junction(self):
        # Two parallel carriageways crossing North St 8m apart merge into one junction cluster
        w1 = make_way(1, [(deg(0), deg(50)), (deg(50), deg(50)), (deg(58), deg(50)), (deg(120), deg(50))], [101, 999, 998, 102], name="North St")
        e1 = make_way(2, [(deg(50), deg(0)), (deg(50), deg(50)), (deg(50), deg(100))], [201, 999, 202], name="East St")
        e2 = make_way(3, [(deg(58), deg(0)), (deg(58), deg(50)), (deg(58), deg(100))], [301, 998, 302], name="East St")
        s_cross = make_way(4, [(deg(0), deg(0)), (deg(0), deg(50)), (deg(0), deg(100))], [401, 101, 402], name="South St")

        frames = [seq_frame(f"n_{i}", a, 53.0, step_idx=i, seq="seq_n") for i, a in enumerate(range(0, 60, 5))]
        snap = snapshot([w1, e1, e2, s_cross], frames)
        j1 = place_node(snap, "osm_999")
        j2 = place_node(snap, "osm_998")
        assert j1.node_id == j2.node_id == "osm_998"

    def test_flats_are_ignored_when_panos_only(self):
        flats = [seq_frame(f"flat_{i}", a, 52.0, step_idx=i, seq="seq_flat", pano=False) for i, a in enumerate(range(0, 101, 10))]
        snap = snapshot(two_intersection_block(100.0), flats)
        assert snap.chosen_passes == {}
        assert pick_seed(snap, deg(50), deg(50)) is None


class TestSeedingAndRouteProvider:
    def test_seed_honors_street_hint(self):
        ways = two_intersection_block(100.0, name="North St")
        frames_north = [seq_frame(f"n_{i}", a, 53.0, step_idx=i, seq="seq_n") for i, a in enumerate(range(0, 101, 10))]
        snap = snapshot(ways, frames_north)
        seed = pick_seed(snap, deg(40), deg(50), street_hint="North St")
        assert seed is not None
        assert "North St" in seed.place.street_names

    def test_route_provider_solves_and_caches_block_chain(self):
        clear_all_caches()

        class FakeRoadSource(RoadDataSource):
            def __init__(self):
                self.calls = 0

            def get_ways(self, min_lat, min_lng, max_lat, max_lng):
                self.calls += 1
                return two_intersection_block(100.0, name="North St")

        seq_frames = [
            seq_frame(f"p_{i}", a, 53.0, step_idx=i, seq="seq_main")
            for i, a in enumerate(range(0, 101, 10))
        ]
        road_src = FakeRoadSource()
        imagery = MagicMock()
        imagery.provider_name = "mapillary"
        imagery.get_metadata_bbox.return_value = [seq_frames[0], seq_frames[-1]]
        imagery.get_sequence.return_value = seq_frames
        imagery.get_image.side_effect = lambda img_id, h=0, p=0: {
            "image": "base64_crop",
            "imageId": img_id,
            "actualHeading": h,
        }
        loc = MagicMock()
        loc.geocode.return_value = {"lat": deg(30), "lng": deg(50), "street": "North St"}

        rp = RouteProvider(imagery=imagery, location=loc, road_sources=[road_src])

        # 1. Initial address load solves the block and caches all nodes in graph_cache
        view1 = rp.get_pano_view(address="30 North St", heading=0.0)
        assert view1.status == "ok"
        assert view1.links
        seq_calls_after_seed = imagery.get_sequence.call_count
        assert seq_calls_after_seed == 1

        # 2. Stepping to the next waypoint along the block hits graph_cache (0 new sequence calls)
        next_link = min(view1.links, key=lambda l: abs(l.heading - 0.0))
        view2 = rp.get_pano_view(
            canonical_node_id=next_link.canonicalNodeId,
            image_id=next_link.imageId,
            lat=next_link.coordinates.latitude,
            lng=next_link.coordinates.longitude,
            heading=next_link.arrivalHeading or 0.0,
        )
        assert view2.status == "ok"
        assert imagery.get_sequence.call_count == seq_calls_after_seed
        assert query_audit.snapshot()["duplicate_count"] == 0
