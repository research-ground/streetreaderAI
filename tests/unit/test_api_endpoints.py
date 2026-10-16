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
from unittest.mock import patch, MagicMock
from server.index import app
from server.core.models import ViewResponse, ChatResponse


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_api_help_endpoint(client):
    res = client.get("/api/help")
    assert res.status_code == 200
    assert "StreetReaderAI API Reference" in res.get_data(as_text=True)


def test_resolve_address_missing_coordinates(client):
    res = client.post("/v1/streetreader:resolveAddress", json={})
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert "Missing coordinates" in json_data["message"]


def test_resolve_address_success(client):
    with patch("server.index.location_service.reverse_geocode") as mock_rev:
        mock_rev.return_value = {"formatted_address": "742 Evergreen Terrace"}
        res = client.post("/v1/streetreader:resolveAddress", json={
            "coordinates": {"latitude": 44.0, "longitude": -123.0}
        })
        assert res.status_code == 200
        json_data = res.get_json()
        assert json_data["address"] == "742 Evergreen Terrace"


def test_search_nearby_places_missing_location(client):
    res = client.post("/v1/streetreader:searchNearbyPlaces", json={})
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert "Missing location" in json_data["message"]


def test_search_nearby_places_success(client):
    with patch("server.index.location_service.nearby_search") as mock_nearby:
        mock_nearby.return_value = [
            {
                "name": "Kwik-E-Mart",
                "vicinity": "Springfield",
                "geometry": {"location": {"lat": 44.001, "lng": -123.001}},
                "types": ["convenience_store"]
            }
        ]
        res = client.post("/v1/streetreader:searchNearbyPlaces", json={
            "location": {"latitude": 44.0, "longitude": -123.0},
            "heading": 0
        })
        assert res.status_code == 200
        json_data = res.get_json()
        assert len(json_data["places"]) == 1
        assert json_data["places"][0]["name"] == "Kwik-E-Mart"
        assert "relativePosition" in json_data["places"][0]


def test_describe_image_missing_image(client):
    res = client.post("/v1/streetreader:describeImage", json={})
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert "Missing image data" in json_data["message"]


def test_describe_image_success(client):
    with patch("server.index.ai_service.generate_description") as mock_desc:
        mock_desc.return_value = "A panoramic view of an open plaza."
        res = client.post("/v1/streetreader:describeImage", json={"image": "base64str"})
        assert res.status_code == 200
        json_data = res.get_json()
        assert json_data["description"] == "A panoramic view of an open plaza."


def test_describe_image_with_gemini_key_override(client):
    with patch("server.index.ai_service.generate_description") as mock_desc:
        mock_desc.return_value = "Custom key description."
        res = client.post(
            "/v1/streetreader:describeImage?gemini_key=url-override-key",
            json={"image": "base64str_custom_key"},
        )
        assert res.status_code == 200
        mock_desc.assert_called_once_with("base64str_custom_key", api_key="url-override-key")


def test_ask_question_missing_fields(client):
    res = client.post("/v1/streetreader:askQuestion", json={"image": "base64str"})
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert "Missing image or question" in json_data["message"]


def test_ask_question_success(client):
    with patch("server.index.ai_service.ask_question") as mock_ask:
        mock_ask.return_value = ChatResponse(
            answer="Turn left at the next light.",
            navigationalAction="TURN_LEFT"
        )
        res = client.post("/v1/streetreader:askQuestion", json={
            "image": "base64str",
            "question": "Which way should I turn?",
            "detect_navigational_intent": True
        })
        assert res.status_code == 200
        json_data = res.get_json()
        assert json_data["answer"] == "Turn left at the next light."
        assert json_data["navigationalAction"] == "TURN_LEFT"


def test_generate_panorama_view_missing_all_ident(client):
    res = client.post("/v1/streetreader:generatePanoramaView", json={})
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert "Missing canonicalNodeId" in json_data["message"]


def test_autocomplete_place(client):
    with patch("server.index.location_service.autocomplete") as mock_ac:
        mock_pred = MagicMock()
        mock_pred.description = "10 Downing St, London"
        mock_pred.place_id = "place_10"
        mock_ac.return_value = [mock_pred]

        res = client.post("/v1/streetreader:autocompletePlace", json={"query": "10 Downing"})
        assert res.status_code == 200
        json_data = res.get_json()
        assert len(json_data["suggestions"]) == 1
        assert json_data["suggestions"][0]["description"] == "10 Downing St, London"
        assert json_data["suggestions"][0]["placeId"] == "place_10"


def test_config_endpoints(client):
    res = client.get("/v1/streetreader:config")
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data.get("startingAddress") == "601 N 34th St, Seattle, WA"

    res_api = client.get("/api/config")
    assert res_api.status_code == 200
    assert res_api.get_json().get("startingAddress") == "601 N 34th St, Seattle, WA"


def test_cache_stats_endpoint(client):
    res = client.get("/v1/streetreader:cacheStats")
    assert res.status_code == 200
    data = res.get_json()
    assert "caches" in data
    assert "queryAudit" in data
    assert "duplicate_count" in data["queryAudit"]
