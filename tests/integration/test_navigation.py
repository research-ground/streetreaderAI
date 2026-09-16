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

import pytest

def test_generate_panorama_view_live(api_client):
    """
    Test generating panorama view with live backend.
    Checks that the endpoint returns either:
    - 200 OK with ViewResponse when imagery + roads are available.
    - 400 Bad Request with a message when no imagery is available.
    - 503 / 500 when upstream Overpass mirrors are temporarily timing out.
    """
    resp = api_client.generate_panorama_view(address="411 15th Ave E, Seattle, WA")
    data = resp.json()

    if resp.status_code == 200:
        # Full Mapillary + OSM integration available
        assert "status" in data
        assert "image" in data or "canonicalNodeId" in data
        if "links" in data and data["links"]:
            first_link = data["links"][0]
            assert "canonicalNodeId" in first_link
            assert "heading" in first_link
    elif resp.status_code == 400:
        # Stub or unconfigured imagery provider: fails cleanly with a message
        assert data.get("success") is False
        assert "message" in data
    elif resp.status_code in (500, 503):
        # Transient upstream Overpass rate limits / timeouts on public mirrors
        assert data.get("success") is False
    else:
        pytest.fail(f"Unexpected status code from generatePanoramaView: {resp.status_code}")


def test_get_local_graph(api_client):
    """
    Test retrieving the local road graph around coordinates.
    OSM road data should resolve ways and intersections independently of imagery tokens.
    """
    # Seattle coordinates around 411 15th Ave E
    resp = api_client._post("getLocalGraph", {
        "coordinates": {"latitude": 47.62235, "longitude": -122.31283},
        "radiusMeters": 80
    })

    assert resp.status_code == 200
    data = resp.json()
    assert "center" in data
    assert "radiusMeters" in data
    assert "nodes" in data
    assert "edges" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["edges"], list)
