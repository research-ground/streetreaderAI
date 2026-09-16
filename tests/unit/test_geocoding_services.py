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
from server.services.geocoding.osm_geocoding_service import OpenStreetMapLocationService
from server.services.geocoding.google_geocoding_service import GoogleLocationService
from server.core.exceptions import APIException


# --- OSM Geocoding Tests ---

def test_osm_geocode_success():
    service = OpenStreetMapLocationService(
        nominatim_base_url="https://nominatim.example.com",
        overpass_endpoint="https://overpass.example.com"
    )
    with patch("server.services.geocoding.osm_geocoding_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = [
            {
                "lat": "47.6062",
                "lon": "-122.3321",
                "display_name": "Seattle, WA, USA",
                "address": {"road": "Pine St"}
            }
        ]
        mock_get.return_value = mock_resp

        res = service.geocode("Seattle, WA")
        assert res is not None
        assert res["lat"] == 47.6062
        assert res["lng"] == -122.3321
        assert res["street"] == "Pine St"
        assert res["address"] == "Seattle, WA, USA"


def test_osm_geocode_rate_limited():
    service = OpenStreetMapLocationService(
        nominatim_base_url="https://nominatim.example.com"
    )
    with patch("server.services.geocoding.osm_geocoding_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_get.return_value = mock_resp

        with pytest.raises(APIException) as exc_info:
            service.geocode("Some Place")
        assert exc_info.value.status_code == 429
        assert "rate limit exceeded" in exc_info.value.message


def test_osm_reverse_geocode_success():
    service = OpenStreetMapLocationService(
        nominatim_base_url="https://nominatim.example.com"
    )
    with patch("server.services.geocoding.osm_geocoding_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"display_name": "123 Main St, Seattle, WA"}
        mock_get.return_value = mock_resp

        res = service.reverse_geocode(47.6062, -122.3321)
        assert res is not None
        assert res["formatted_address"] == "123 Main St, Seattle, WA"


def test_osm_nearby_search_with_elements():
    service = OpenStreetMapLocationService(
        overpass_endpoint="https://overpass.example.com"
    )
    with patch("server.services.geocoding.osm_geocoding_service.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "elements": [
                {
                    "lat": 47.6065,
                    "lon": "-122.3325",
                    "tags": {"name": "Coffee Shop", "amenity": "cafe"}
                }
            ]
        }
        mock_post.return_value = mock_resp

        results = service.nearby_search(47.6062, -122.3321, radius=50)
        assert len(results) == 1
        assert results[0]["name"] == "Coffee Shop"
        assert results[0]["geometry"]["location"]["lat"] == 47.6065
        assert results[0]["vicinity"] == "cafe"


def test_osm_nearby_search_fallback_on_error():
    service = OpenStreetMapLocationService(
        overpass_endpoint="https://overpass.example.com"
    )
    with patch("server.services.geocoding.osm_geocoding_service.requests.post") as mock_post:
        mock_post.side_effect = Exception("Overpass timeout")

        results = service.nearby_search(47.6062, -122.3321, radius=50)
        assert len(results) == 1
        assert "Fallback" in results[0]["name"]


# --- Google Location Service Tests ---

def test_google_geocode_success():
    service = GoogleLocationService(api_key="test-key", base_url="https://maps.example.com")
    with patch("server.services.geocoding.google_geocoding_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "OK",
            "results": [
                {
                    "geometry": {"location": {"lat": 40.7484, "lng": -73.9857}},
                    "formatted_address": "350 5th Ave, New York, NY",
                    "address_components": [
                        {"long_name": "5th Ave", "types": ["route"]}
                    ]
                }
            ]
        }
        mock_get.return_value = mock_resp

        res = service.geocode("Empire State Building")
        assert res is not None
        assert res["lat"] == 40.7484
        assert res["lng"] == -73.9857
        assert res["street"] == "5th Ave"
        assert res["address"] == "350 5th Ave, New York, NY"


def test_google_geocode_failure_status():
    service = GoogleLocationService(api_key="test-key", base_url="https://maps.example.com")
    with patch("server.services.geocoding.google_geocoding_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "ZERO_RESULTS",
            "results": []
        }
        mock_get.return_value = mock_resp

        res = service.geocode("Nowhere Land")
        assert res is None


def test_google_reverse_geocode_success():
    service = GoogleLocationService(api_key="test-key", base_url="https://maps.example.com")
    with patch("server.services.geocoding.google_geocoding_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "OK",
            "results": [{"formatted_address": "350 5th Ave, New York, NY"}]
        }
        mock_get.return_value = mock_resp

        res = service.reverse_geocode(40.7484, -73.9857)
        assert res == {"formatted_address": "350 5th Ave, New York, NY"}


def test_google_nearby_search_success():
    service = GoogleLocationService(api_key="test-key", base_url="https://maps.example.com")
    with patch("server.services.geocoding.google_geocoding_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "OK",
            "results": [
                {"name": "Local Cafe", "vicinity": "5th Ave"}
            ]
        }
        mock_get.return_value = mock_resp

        results = service.nearby_search(40.7484, -73.9857, radius=50)
        assert len(results) == 1
        assert results[0]["name"] == "Local Cafe"
