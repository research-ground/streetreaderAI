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

"""Unit tests for the road skeleton: marker classification, arc-walk, and
incremental discovery. Synthetic geometry near (0, 0); no network."""

from server.routing.route_provider import RoadNetwork

M_PER_DEG = 111139.0
BASE = 0.0005


def deg(meters: float) -> float:
    return BASE + meters / M_PER_DEG


def make_way(way_id, points, node_ids, name=""):
    return {
        "id": way_id,
        "nodes": node_ids,
        "geometry": [{"lat": lat, "lon": lng} for lat, lng in points],
        "tags": {"name": name} if name else {},
    }


def north_way(way_id, start_m, end_m, node_start, node_end, lng_m=50.0, name="North St",
              mid=None):
    pts = [(deg(start_m), deg(lng_m))]
    nodes = [node_start]
    if mid is not None:
        mid_m, mid_id = mid
        pts.append((deg(mid_m), deg(lng_m)))
        nodes.append(mid_id)
    pts.append((deg(end_m), deg(lng_m)))
    nodes.append(node_end)
    return make_way(way_id, pts, nodes, name=name)


def crossing_scene():
    w1 = north_way(1, 0, 100, 101, 102, mid=(50, 999))
    w2 = make_way(2, [(deg(50), deg(0)), (deg(50), deg(50)), (deg(50), deg(100))],
                  [201, 999, 202], name="East St")
    return w1, w2


class TestMarkers:
    def test_crossing_is_intersection_with_four_legs(self):
        r = RoadNetwork()
        r.add_ways(list(crossing_scene()))
        m = r.marker(999)
        assert m is not None and m.kind == "intersection"
        assert len(m.legs) == 4
        assert set(m.street_names) == {"North St", "East St"}

    def test_same_name_endpoint_is_join(self):
        r = RoadNetwork()
        r.add_ways([
            north_way(1, 0, 75, 101, 150),
            north_way(2, 75, 150, 150, 102),
        ])
        assert r.marker(150).kind == "join"

    def test_name_change_endpoint_is_intersection(self):
        r = RoadNetwork()
        r.add_ways([
            north_way(1, 0, 75, 101, 150, name="North St"),
            north_way(2, 75, 150, 150, 102, name="Harrison St"),
        ])
        assert r.marker(150).kind == "intersection"

    def test_lone_endpoint_is_dead_end(self):
        r = RoadNetwork()
        r.add_ways([north_way(1, 0, 100, 101, 102)])
        assert r.marker(101).kind == "dead_end"
        assert r.marker(102).kind == "dead_end"

    def test_cross_street_discovered_later_upgrades_node(self):
        r = RoadNetwork()
        w1, w2 = crossing_scene()
        r.add_ways([w1])
        assert r.marker(999) is None  # interior, unshared so far
        r.add_ways([w2])
        m = r.marker(999)
        assert m is not None and m.kind == "intersection" and len(m.legs) == 4


class TestWalk:
    def test_walk_stops_at_intersection(self):
        r = RoadNetwork()
        r.add_ways(list(crossing_scene()))
        res = r.walk(1, 20.0, +1, max_dist=200.0)
        assert res.end_marker is not None and res.end_marker.osm_node_id == 999
        assert abs(res.total_dist - 30.0) < 1.0

    def test_walk_crosses_same_street_join(self):
        r = RoadNetwork()
        r.add_ways([
            north_way(1, 0, 75, 101, 150),
            north_way(2, 75, 150, 150, 102),
        ])
        res = r.walk(1, 20.0, +1, max_dist=500.0)
        # Continues through the join onto way 2 and stops at the far dead end.
        assert res.end_marker is not None and res.end_marker.osm_node_id == 102
        assert abs(res.total_dist - 130.0) < 1.0
        assert {sl.way_id for sl in res.slices} == {1, 2}

    def test_walk_respects_distance_budget(self):
        r = RoadNetwork()
        r.add_ways([north_way(1, 0, 200, 101, 102)])
        res = r.walk(1, 20.0, +1, max_dist=50.0)
        assert res.end_marker is None
        assert abs(res.total_dist - 50.0) < 0.01
        assert abs(res.slices[-1].to_along - 70.0) < 0.1

    def test_locate_snaps_with_signed_perp(self):
        r = RoadNetwork()
        r.add_ways([north_way(1, 0, 100, 101, 102)])
        # 5 m east of a northbound way = negative (right-of-travel) perp.
        hit = r.locate(deg(50), deg(55), max_perp_m=20.0)
        assert hit is not None
        way_id, along, perp = hit
        assert way_id == 1
        assert abs(along - 50.0) < 1.0
        assert perp < 0 and abs(abs(perp) - 5.0) < 1.0
