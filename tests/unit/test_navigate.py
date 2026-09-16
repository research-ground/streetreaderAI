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

"""Unit tests for stateless navigation: snapshot construction, seeding with
street-name matching and sidewalk preference, block-scoped link building, lane
continuity. Snapshots are built directly from synthetic data — no network."""

from server.core.models import LatLng, LocationMetadata
from server.routing.route_provider import (
    AreaSnapshot,
    NodePlace,
    RoadNetwork,
    RouteParams,
    build_links,
    pick_seed,
    place_node,
    reference_image,
)

STEP_M = RouteParams().step_m

M_PER_DEG = 111139.0
BASE = 0.0005

NEW_TS = 1_750_000_000_000  # ~2025
OLD_TS = 1_420_000_000_000  # ~2015


def deg(meters: float) -> float:
    return BASE + meters / M_PER_DEG


def make_way(way_id, points, node_ids, name=""):
    return {
        "id": way_id,
        "nodes": node_ids,
        "geometry": [{"lat": lat, "lon": lng} for lat, lng in points],
        "tags": {"name": name} if name else {},
    }


def north_way(way_id=1, start=0, end=200, n_start=101, n_end=102, lng_m=50.0,
              name="North St", mid=None):
    pts = [(deg(start), deg(lng_m))]
    nodes = [n_start]
    if mid is not None:
        pts.append((deg(mid[0]), deg(lng_m)))
        nodes.append(mid[1])
    pts.append((deg(end), deg(lng_m)))
    nodes.append(n_end)
    return make_way(way_id, pts, nodes, name=name)


def img_north(image_id, along_m, east_m, t_ms=NEW_TS, pano=True, road_lng_m=50.0, seq=None):
    """East of a northbound way = right of travel (negative way-frame perp)."""
    return LocationMetadata(
        imageId=image_id,
        coordinates=LatLng(latitude=deg(along_m), longitude=deg(road_lng_m + east_m)),
        captureTime=str(t_ms), heading=0.0, isPano=pano, sequenceId=seq,
    )


def img_at(image_id, lat_m, lng_m, t_ms=NEW_TS, pano=True):
    return LocationMetadata(
        imageId=image_id,
        coordinates=LatLng(latitude=deg(lat_m), longitude=deg(lng_m)),
        captureTime=str(t_ms), heading=0.0, isPano=pano, sequenceId=None,
    )


def snapshot(ways, images, visited_image_ids=None):
    roads = RoadNetwork()
    roads.add_ways(ways)
    return AreaSnapshot(roads, list(images), visited_image_ids=visited_image_ids)


def crossing_scene():
    w1 = north_way(1, 0, 100, 101, 102, mid=(50, 999))
    w2 = make_way(2, [(deg(50), deg(0)), (deg(50), deg(50)), (deg(50), deg(100))],
                  [201, 999, 202], name="East St")
    return [w1, w2]


def northbound_link(snap, place, ref):
    for link in build_links(snap, place, ref):
        if abs(((link.bearing - 0 + 180) % 360) - 180) <= 45:
            return link
    return None


def place_at(snap, way_id, along):
    return place_node(snap, f"way_{way_id}_off_{int(round(along))}")


class TestLinks:
    def test_step_lands_about_one_step_ahead_same_lane(self):
        images = [img_north(f"e{a}", a, 3.0) for a in range(0, 200, 3)]
        snap = snapshot([north_way()], images)
        place = place_at(snap, 1, 100)
        ref = reference_image(snap, place)
        assert ref is not None
        link = northbound_link(snap, place, ref)
        assert link is not None
        assert 0.8 * STEP_M <= link.distance_m <= 1.2 * STEP_M
        assert link.lane == "right"
        assert link.image is not None and link.image.imageId != ref.meta.imageId
        assert link.arrival_bearing is not None

    def test_links_offer_both_directions(self):
        images = [img_north(f"e{a}", a, 3.0) for a in range(0, 200, 3)]
        snap = snapshot([north_way()], images)
        place = place_at(snap, 1, 100)
        links = build_links(snap, place, reference_image(snap, place))
        bearings = sorted(round(l.bearing) % 360 for l in links)
        assert len(links) == 2 and bearings[0] == 0 and bearings[1] == 180

    def test_sparse_same_side_beats_dense_other_side(self):
        right = [img_north(f"r{a}", a, 3.0) for a in (100, 130, 160)]
        left = [img_north(f"l{a}", a, -4.0) for a in range(95, 175, 5)]
        snap = snapshot([north_way()], right + left)
        place = place_at(snap, 1, 100)
        # The client says which image it is viewing — exact continuity context.
        ref = reference_image(snap, place, image_id="r100")
        assert ref.meta.imageId == "r100"
        link = northbound_link(snap, place, ref)
        assert link is not None
        assert link.image.imageId == "r130", f"zigzagged to {link.image.imageId}"

    def test_direction_without_imagery_is_blocked(self):
        images = [img_north(f"e{a}", a, 3.0) for a in range(0, 91, 5)]
        snap = snapshot([north_way()], images)
        place = place_at(snap, 1, 90)
        ref = reference_image(snap, place)
        link = northbound_link(snap, place, ref)
        assert link is None, "no imagery ahead to the dead end — direction must be closed"
        south = [l for l in build_links(snap, place, ref) if round(l.bearing) == 180]
        assert south, "southbound should still work"

    def test_junction_condenses_no_nearby_waypoints(self):
        # Capture zone is min(3×step, block/2): no waypoints inside it, the
        # step goes to the junction itself — a longer stride into the corner
        # is the accepted price for corners without fiddly satellites.
        images = [img_north(f"e{a}", a, 3.0) for a in range(0, 101, 5)]
        snap = snapshot(crossing_scene(), images)
        # Block 0–50 → capture 25 m: from 20 m the corner is the next stop.
        place = place_at(snap, 1, 20)
        link = northbound_link(snap, place, reference_image(snap, place))
        assert link is not None
        assert link.node_id == "osm_999", "inside the condensing zone, land on the corner"
        assert link.image is not None
        # On a long block the rhythm holds: from 100 m on a 200 m way,
        # candidates ~10 m ahead still win.
        long_snap = snapshot([north_way()], [img_north(f"e{a}", a, 3.0) for a in range(0, 200, 5)])
        place2 = place_at(long_snap, 1, 100)
        link2 = northbound_link(long_snap, place2, reference_image(long_snap, place2))
        assert link2 is not None and link2.node_id.startswith("way_")
        assert 0.8 * STEP_M <= link2.distance_m <= 1.2 * STEP_M

    def test_step_prefers_same_sequence_in_window(self):
        # When candidates are in the window, one sharing the current sequenceId wins
        ref_img = img_north("ref", 100, 3.0, seq="seq_continuous")
        cand_other = img_north("other_drive", 118, 3.0, seq="seq_other")
        cand_same = img_north("same_drive", 120, 3.0, seq="seq_continuous")
        snap = snapshot([north_way()], [ref_img, cand_other, cand_same])
        place = place_at(snap, 1, 100)
        link = northbound_link(snap, place, reference_image(snap, place, image_id="ref"))
        assert link is not None
        assert link.image.imageId == "same_drive", "candidate in same sequence must win"

    def test_step_prefers_previous_node_image_in_window(self):
        # When an image in the window was from a previous node, it must be picked
        ref_img = img_north("current_node", 100, 3.0)
        cand_prev = img_north("prev_node_img", 122, 3.0)
        cand_other = img_north("other_img", 118, 3.0)
        snap = snapshot([north_way()], [ref_img, cand_prev, cand_other], visited_image_ids={"prev_node_img"})
        place = place_at(snap, 1, 100)
        link = northbound_link(snap, place, reference_image(snap, place, image_id="current_node"))
        assert link is not None
        assert link.image.imageId == "prev_node_img", "image from previous node must win"

    def test_split_roadway_intersections_merge_within_30m(self):
        # [user] intersections within 30 m (3x step) are one junction.
        # Evidence location: 1600 7th Ave, Seattle. Two eastbound carriageways
        # cross North St 8 m apart; both OSM nodes must present as one corner.
        w1 = make_way(1, [(deg(0), deg(50)), (deg(50), deg(50)), (deg(58), deg(50)),
                          (deg(120), deg(50))], [101, 999, 998, 102], name="North St")
        e1 = make_way(2, [(deg(50), deg(0)), (deg(50), deg(50)), (deg(50), deg(100))],
                      [201, 999, 202], name="East St")
        e2 = make_way(3, [(deg(58), deg(0)), (deg(58), deg(50)), (deg(58), deg(100))],
                      [301, 998, 302], name="East St")
        images = [img_north(f"n{a}", a, 3.0) for a in range(0, 120, 5)]
        images += [img_at(f"e1_{a}", 47.0, a) for a in range(10, 100, 5)]
        snap = snapshot([w1, e1, e2], images)
        j1 = place_node(snap, "osm_999")
        j2 = place_node(snap, "osm_998")
        assert j1.node_id == j2.node_id == "osm_998", "both nodes must be one junction"
        # Stepping toward the corner lands on the merged junction, not a member.
        place = place_at(snap, 1, 25)
        link = northbound_link(snap, place, reference_image(snap, place))
        assert link is not None and link.node_id == "osm_998"
        # No links between the junction's own member nodes.
        links = build_links(snap, j1, reference_image(snap, j1))
        assert all(l.node_id != "osm_999" for l in links)

    def test_turn_at_intersection_keeps_lane_class(self):
        # Corner image on the right (east) side of North St; East St has images
        # on both sidewalks one step out. Turning east must pick the south
        # (right) one.
        corner = img_at("corner", 47.0, 53.0)
        south = img_at("south70", 47.0, 50.0 + STEP_M)
        north = img_at("north70", 53.0, 50.0 + STEP_M)
        snap = snapshot(crossing_scene(), [corner, south, north])
        place = place_node(snap, "osm_999")
        assert place is not None
        ref = reference_image(snap, place)
        assert ref.meta.imageId == "corner"
        east = [l for l in build_links(snap, place, ref) if round(l.bearing) == 90]
        assert east and east[0].image.imageId == "south70"

    def test_link_carries_capture_time_and_pano(self):
        images = [img_north(f"e{a}", a, 3.0, t_ms=NEW_TS, pano=True) for a in range(0, 200, 5)]
        snap = snapshot([north_way()], images)
        place = place_at(snap, 1, 100)
        link = northbound_link(snap, place, reference_image(snap, place))
        assert link.image.captureTime == str(NEW_TS)
        assert link.image.isPano is True


class TestPlacement:
    def test_place_node_parses_ids(self):
        snap = snapshot(crossing_scene(), [])
        wp = place_node(snap, "way_1_off_30")
        assert wp is not None and wp.kind == "waypoint" and abs(wp.along - 30) < 0.5
        inter = place_node(snap, "osm_999")
        assert inter is not None and inter.kind == "intersection"
        assert place_node(snap, "way_77_off_10") is None  # unknown way

    def test_reference_expands_on_empty_window(self):
        # Node minted at 30; nearest pano sits 5 m off (outside the first ±3 m
        # window). The doubling expansion must find it rather than declaring
        # the landing imageless.
        snap = snapshot([north_way()], [img_north("e35", 35, 3.0)])
        ref = reference_image(snap, place_at(snap, 1, 30))
        assert ref is not None and ref.meta.imageId == "e35"

    def test_reference_image_is_the_minting_image(self):
        images = [img_north(f"e{a}", a, 3.0) for a in (20, 30, 40)]
        snap = snapshot([north_way()], images)
        place = place_at(snap, 1, 30)
        ref = reference_image(snap, place)
        assert ref.meta.imageId == "e30"


class TestSeeding:
    def test_seed_prefers_right_sidewalk(self):
        right = [img_north(f"r{a}", a, 3.0) for a in range(90, 160, 10)]
        left = [img_north(f"l{a}", a, -4.0) for a in range(90, 160, 10)]
        center = [img_north(f"c{a}", a, 0.5) for a in range(90, 160, 10)]
        snap = snapshot([north_way()], right + left + center)
        seed = pick_seed(snap, deg(100), deg(50))
        assert seed is not None
        assert seed.lane == "right"
        assert seed.image.meta.imageId.startswith("r")

    def test_seed_falls_back_to_left_then_center(self):
        left = [img_north(f"l{a}", a, -4.0) for a in range(90, 160, 10)]
        snap = snapshot([north_way()], [img_north("r100", 100, 3.0)] + left)
        seed = pick_seed(snap, deg(100), deg(50))
        assert seed.lane == "left"
        center_only = snapshot([north_way()], [img_north(f"c{a}", a, 0.5) for a in range(90, 160, 10)])
        seed2 = pick_seed(center_only, deg(100), deg(50))
        assert seed2 is not None and seed2.lane == "center"

    def test_seed_lands_at_nearest_image_even_near_a_corner(self):
        # No corner-snapping at the seed (removed as an unspecified invention):
        # the anchor is the nearest image to the address, period.
        images = [img_north(f"e{a}", a, 3.0) for a in range(30, 75, 5)]
        snap = snapshot(crossing_scene(), images)
        seed = pick_seed(snap, deg(45), deg(50))
        assert seed is not None
        assert seed.place.node_id == "way_1_off_45"

    def test_street_hint_beats_nearest_road(self):
        # Building point 8 m from "Alley Rd" but the address says North St (20 m away).
        w1 = north_way(1, 0, 200, 101, 102, lng_m=50.0, name="North St")
        w2 = north_way(2, 0, 200, 201, 202, lng_m=22.0, name="Alley Rd")
        images = [img_north(f"n{a}", a, 3.0, road_lng_m=50.0) for a in range(80, 140, 10)]
        images += [img_north(f"a{a}", a, 3.0, road_lng_m=22.0) for a in range(80, 140, 10)]
        snap = snapshot([w1, w2], images)
        seed_hint = pick_seed(snap, deg(100), deg(30), street_hint="North St")
        assert seed_hint is not None
        assert seed_hint.image.meta.imageId.startswith("n"), "hint must override distance"
        seed_plain = pick_seed(snap, deg(100), deg(30))
        assert seed_plain.image.meta.imageId.startswith("a"), "no hint → nearest road"

    def test_flats_are_never_navigation_views(self):
        # [user] Only panos. A flat at the perfect spot must be invisible to
        # seeding and stepping; the pano further out wins instead.
        flat = img_north("flat_perfect", 100, 3.0, pano=False)
        pano = img_north("pano_farther", 118, 3.0, pano=True)
        snap = snapshot([north_way()], [flat, pano])
        seed = pick_seed(snap, deg(100), deg(50))
        assert seed is not None
        assert seed.image.meta.imageId == "pano_farther"

    def test_seed_returns_none_when_area_empty(self):
        snap = snapshot([north_way()], [])
        assert pick_seed(snap, deg(100), deg(50)) is None

    def test_seed_stays_at_the_front_door(self):
        # A newer, fancier pano 28 m down the block must NOT drag the anchor
        # away from the address; proximity wins, quality breaks ties nearby.
        near = img_north("near", 103, 3.0, t_ms=OLD_TS, pano=True)
        far_new = img_north("far_new", 128, 3.0, t_ms=NEW_TS, pano=True)
        snap = snapshot([north_way()], [near, far_new])
        seed = pick_seed(snap, deg(100), deg(50))
        assert seed is not None
        assert seed.image.meta.imageId == "near", "anchor drifted from the target address"
        assert abs(seed.place.along - 100) <= 10
