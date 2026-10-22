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


def test_search_nearby_places(api_client):
    """
    Test searching for nearby POIs.
    """
    resp = api_client.search_nearby_places(lat=40.7484405, lng=-73.9856644)

    assert resp.status_code == 200
    data = resp.json()

    results = data.get("places")
    if results is None:
        pytest.fail(f"Could not find 'places' in response. Keys found: {list(data.keys())}")

    assert len(results) > 0
    first_poi = results[0]
    assert "name" in first_poi
    assert "relativePosition" in first_poi
    assert "side" in first_poi["relativePosition"]


def test_autocomplete_places(api_client):
    """
    Test address autocomplete suggestions for a query string.
    """
    resp = api_client.autocomplete_place(query="Pike Place Market")

    assert resp.status_code == 200
    data = resp.json()
    assert "suggestions" in data
    suggestions = data["suggestions"]
    assert isinstance(suggestions, list)
    if len(suggestions) > 0:
        first = suggestions[0]
        assert "description" in first
        assert "placeId" in first
