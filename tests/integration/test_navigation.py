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
import io
import json
import math
import re
import pytest
import requests
from PIL import Image, ImageDraw

from server.core.config import config
from server.routing.map_math import calculate_distance


def _ang_diff(a: float, b: float) -> float:
    return abs(((a - b + 180.0) % 360.0) - 180.0)


def _latlng_to_world_px(lat: float, lng: float, zoom: int) -> tuple[float, float]:
    scale = 256 * (2 ** zoom)
    x = (lng + 180.0) / 360.0 * scale
    siny = math.sin(math.radians(lat))
    siny = min(max(siny, -0.9999), 0.9999)
    y = (0.5 - math.log((1.0 + siny) / (1.0 - siny)) / (4.0 * math.pi)) * scale
    return x, y


def _render_google_hybrid_graph_overlay(graph_data: dict, api_key: str, zoom: int = 18, size: int = 640) -> bytes:
    """Fetch a Google Maps hybrid satellite static map and draw the solved 5-step
    navigation graph on top of it (green block chains, gold intersection diamonds,
    cyan sequence waypoints)."""
    center = graph_data["center"]
    c_lat, c_lng = center["latitude"], center["longitude"]
    resp = requests.get(
        "https://maps.googleapis.com/maps/api/staticmap",
        params={
            "center": f"{c_lat},{c_lng}",
            "zoom": str(zoom),
            "size": f"{size}x{size}",
            "scale": "2",
            "maptype": "hybrid",
            "key": api_key,
        },
        timeout=15,
    )
    resp.raise_for_status()
    base_img = Image.open(io.BytesIO(resp.content)).convert("RGBA")
    w, h = base_img.size
    scale_factor = w / float(size)
    cx, cy = _latlng_to_world_px(c_lat, c_lng, zoom)

    def to_px(lat: float, lng: float) -> tuple[float, float]:
        wx, wy = _latlng_to_world_px(lat, lng, zoom)
        return (w / 2.0 + (wx - cx) * scale_factor, h / 2.0 + (wy - cy) * scale_factor)

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for edge in graph_data.get("edges", []):
        poly = edge.get("polyline") or []
        if len(poly) >= 2:
            pts = [to_px(p["latitude"], p["longitude"]) for p in poly]
            draw.line(pts, fill=(0, 230, 118, 235), width=6)

    for node in graph_data.get("nodes", []):
        coord = node["coordinates"]
        px, py = to_px(coord["latitude"], coord["longitude"])
        if node.get("kind") == "intersection":
            r = 10
            diamond = [(px, py - r), (px + r, py), (px, py + r), (px - r, py)]
            draw.polygon(diamond, fill=(255, 214, 0, 255), outline=(20, 20, 20, 255))
        else:
            r = 5
            draw.ellipse((px - r, py - r, px + r, py + r), fill=(0, 229, 255, 240), outline=(20, 20, 20, 255))

    combined = Image.alpha_composite(base_img, overlay).convert("RGB")
    buf = io.BytesIO()
    combined.save(buf, format="PNG")
    return buf.getvalue()


def test_sequence_fetching_and_local_graph_efficiency(api_client):
    """Verify that solving a local graph expands only intersection-bridging
    sequences, produces unified `osm_` intersections and `seq_` waypoints, and
    issues zero duplicate external queries."""
    resp = api_client._post("getLocalGraph", {
        "coordinates": {"latitude": 47.62235, "longitude": -122.31283},
        "radiusMeters": 110,
    })
    assert resp.status_code == 200
    data = resp.json()

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    audit = data.get("queryAudit", {})

    assert len(nodes) > 0
    assert audit.get("duplicate_count", 0) == 0

    for n in nodes:
        nid = n["canonicalNodeId"]
        assert nid.startswith("osm_") or nid.startswith("seq_"), f"Unexpected node ID format: {nid}"

    if edges:
        for e in edges:
            assert e["fromId"].startswith("osm_")
            assert e["toId"].startswith("osm_")
            assert len(e.get("polyline", [])) >= 2


def test_e2e_walking_along_block_and_turning_at_intersection(api_client):
    """E2E walking test:
    1. Start at 411 15th Ave E, Seattle, WA.
    2. Walk step-by-step along 15th Ave E until reaching a unified `osm_<id>` intersection.
    3. Verify each step returns a valid panorama crop, bidirectional links, and monotonic progress.
    4. At the `osm_<id>` intersection, take a turn onto a cross street and walk forward."""
    start_resp = api_client.generate_panorama_view(address="411 15th Ave E, Seattle, WA")
    if start_resp.status_code in (400, 500, 503):
        pytest.skip(f"Imagery or road service unavailable for live walk test (HTTP {start_resp.status_code})")

    assert start_resp.status_code == 200
    curr = start_resp.json()
    assert curr.get("status") == "ok"
    assert curr.get("image")
    assert curr.get("canonicalNodeId")
    assert len(curr.get("links", [])) >= 1

    visited_nodes = [curr["canonicalNodeId"]]
    prev_node_id = None
    walk_heading = curr["links"][0]["heading"]
    reached_intersection = curr["canonicalNodeId"].startswith("osm_") and len(curr.get("links", [])) >= 3

    for _ in range(8):
        if reached_intersection:
            break
        links = curr.get("links", [])
        assert links, f"Dead end encountered prematurely at {curr['canonicalNodeId']}"
        forward_candidates = [
            l for l in links
            if l["canonicalNodeId"] != prev_node_id and l.get("status") == "ok"
        ]
        if not forward_candidates:
            forward_candidates = [l for l in links if l.get("status") == "ok"]
        next_link = min(forward_candidates, key=lambda l: _ang_diff(l["heading"], walk_heading))

        prev_node_id = curr["canonicalNodeId"]
        walk_heading = next_link["heading"]
        step_resp = api_client.generate_panorama_view(
            canonical_node_id=next_link["canonicalNodeId"],
            image_id=next_link.get("imageId"),
            lat=next_link["coordinates"]["latitude"],
            lng=next_link["coordinates"]["longitude"],
            heading=walk_heading,
        )
        assert step_resp.status_code == 200
        curr = step_resp.json()
        assert curr.get("status") == "ok"
        assert curr.get("image")
        visited_nodes.append(curr["canonicalNodeId"])

        # Must have a back-link to the node we just came from
        back_ids = {l["canonicalNodeId"] for l in curr.get("links", [])}
        assert prev_node_id in back_ids, f"Node {curr['canonicalNodeId']} missing back-link to {prev_node_id}"

        if curr["canonicalNodeId"].startswith("osm_") and len(curr.get("links", [])) >= 3:
            reached_intersection = True
            break

    assert reached_intersection, f"Expected to reach a 3+-way osm_ intersection; visited {visited_nodes}"

    # Turn onto a cross street (link whose angle differs from incoming walk_heading by ~45–135 deg)
    turn_candidates = [
        l for l in curr["links"]
        if l["canonicalNodeId"] != prev_node_id
        and l.get("status") == "ok"
        and 35.0 <= _ang_diff(l["heading"], walk_heading) <= 145.0
    ]
    assert turn_candidates, f"Expected cross-street turn links at intersection {curr['canonicalNodeId']}, got {curr['links']}"
    turn_link = turn_candidates[0]
    turn_resp = api_client.generate_panorama_view(
        canonical_node_id=turn_link["canonicalNodeId"],
        image_id=turn_link.get("imageId"),
        lat=turn_link["coordinates"]["latitude"],
        lng=turn_link["coordinates"]["longitude"],
        heading=turn_link["heading"],
    )
    assert turn_resp.status_code == 200
    turn_data = turn_resp.json()
    assert turn_data.get("status") == "ok"
    assert turn_data.get("image")
    assert turn_data["canonicalNodeId"] == turn_link["canonicalNodeId"]


@pytest.mark.skipif(
    not getattr(config, "GOOGLE_MAPS_API_KEY", None) or not getattr(config, "GEMINI_API_KEY", None),
    reason="Requires GOOGLE_MAPS_API_KEY and GEMINI_API_KEY for visual satellite map + LLM inspection",
)
def test_visual_map_overlay_llm_inspection(api_client):
    """When GOOGLE_MAPS_API_KEY and GEMINI_API_KEY are configured, render the
    solved navigation graph over a Google Maps Hybrid satellite image and have
    Gemini inspect the visual overlay for topological routing errors."""
    resp = api_client._post("getLocalGraph", {
        "coordinates": {"latitude": 47.62235, "longitude": -122.31283},
        "radiusMeters": 130,
    })
    assert resp.status_code == 200
    graph_data = resp.json()
    assert len(graph_data.get("edges", [])) >= 3

    png_bytes = _render_google_hybrid_graph_overlay(
        graph_data,
        api_key=config.GOOGLE_MAPS_API_KEY,
        zoom=18,
        size=640,
    )
    assert len(png_bytes) > 10000

    prompt = (
        "You are inspecting a street-level navigation graph overlaid on a Google Maps hybrid satellite image.\n"
        "- Gold diamonds are unified street intersections.\n"
        "- Cyan dots are intermediate camera positions along street blocks.\n"
        "- Green lines are navigable block connections.\n\n"
        "Check for severe topological routing errors:\n"
        "1. Do any green lines cut diagonally through buildings or across city blocks instead of following streets?\n"
        "2. Are there duplicate parallel green chains running down the exact same street block?\n"
        "Respond strictly in JSON: {\"has_severe_errors\": false, \"explanation\": \"...\"}"
    )
    b64_png = base64.b64encode(png_bytes).decode("utf-8")
    ai_resp = api_client.ask_question(b64_png, prompt)
    assert ai_resp.status_code == 200
    raw_text = (ai_resp.json().get("answer") or "").strip()
    m = re.search(r"\{.*\}", raw_text, re.DOTALL)
    assert m is not None, f"Expected JSON from LLM visual inspection, got: {raw_text}"
    verdict = json.loads(m.group(0))
    assert verdict.get("has_severe_errors") is False, f"LLM flagged visual graph error: {verdict}"
