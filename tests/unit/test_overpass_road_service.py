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
import requests
from server.services.streetmap.overpass_road_service import (
    OverpassRoadService,
    select_fastest_endpoint,
    probe_endpoint,
)


def test_probe_endpoint_success():
    with patch("server.services.streetmap.overpass_road_service.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"version": 0.6, "elements": []}
        mock_post.return_value = mock_resp

        ep, latency = probe_endpoint("https://overpass.example.com", timeout_s=2.0)
        assert ep == "https://overpass.example.com"
        assert latency is not None
        assert latency >= 0.0


def test_probe_endpoint_failure():
    with patch("server.services.streetmap.overpass_road_service.requests.post") as mock_post:
        mock_post.side_effect = requests.Timeout("Connection timed out")

        ep, latency = probe_endpoint("https://overpass.example.com", timeout_s=2.0)
        assert ep == "https://overpass.example.com"
        assert latency is None


def test_select_fastest_endpoint_first_responder_wins():
    import time

    def fake_probe(ep, timeout_s=6.0):
        if ep == "https://fast.example.com":
            time.sleep(0.01)
            return ep, 0.01
        elif ep == "https://slow.example.com":
            time.sleep(0.2)
            return ep, 0.2
        return ep, None

    with patch("server.services.streetmap.overpass_road_service.probe_endpoint", side_effect=fake_probe):
        endpoints = [
            "https://slow.example.com",
            "https://fast.example.com",
            "https://dead.example.com",
        ]
        sorted_eps = select_fastest_endpoint(endpoints)
        assert sorted_eps[0] == "https://fast.example.com"
        assert len(sorted_eps) == 3


def test_select_fastest_endpoint_all_fail_preserves_order():
    def fake_probe(ep, timeout_s=3.0):
        return ep, None

    with patch("server.services.streetmap.overpass_road_service.probe_endpoint", side_effect=fake_probe):
        endpoints = ["https://a.example.com", "https://b.example.com"]
        result = select_fastest_endpoint(endpoints)
        assert result == ["https://a.example.com", "https://b.example.com"]


def test_overpass_road_service_success():
    service = OverpassRoadService(endpoints=["https://overpass.example.com"], probe_on_init=False)
    with patch("server.services.streetmap.overpass_road_service.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "elements": [
                {
                    "type": "way",
                    "id": 12345,
                    "nodes": [1, 2],
                    "tags": {"highway": "residential", "name": "Main St"},
                    "geometry": [{"lat": 47.6, "lon": -122.3}, {"lat": 47.601, "lon": -122.3}]
                }
            ]
        }
        mock_post.return_value = mock_resp

        ways = service.get_ways(47.6, -122.31, 47.61, -122.30)
        assert len(ways) == 1
        assert ways[0]["id"] == 12345
        assert ways[0]["tags"]["name"] == "Main St"
        mock_post.assert_called_once()
        assert "way(47.6,-122.31,47.61,-122.3)" in mock_post.call_args[1]["data"]["data"]


def test_overpass_road_service_non_timeout_failure_raises_without_swapping():
    service = OverpassRoadService(
        endpoints=["https://primary.example.com", "https://mirror.example.com"],
        probe_on_init=False,
    )
    with patch("server.services.streetmap.overpass_road_service.requests.post") as mock_post:
        err_resp = MagicMock()
        err_resp.raise_for_status.side_effect = Exception("500 Internal Server Error")
        mock_post.return_value = err_resp

        with pytest.raises(Exception, match="500 Internal Server Error"):
            service.get_ways(47.6, -122.31, 47.61, -122.30)

        # Did not cycle through mirrors; failed fast and kept active_endpoint
        assert mock_post.call_count == 1
        assert service.active_endpoint == "https://primary.example.com"


def test_overpass_road_service_swaps_on_timeout():
    service = OverpassRoadService(
        endpoints=["https://primary.example.com", "https://mirror.example.com"],
        probe_on_init=False,
    )
    with patch("server.services.streetmap.overpass_road_service.requests.post") as mock_post:
        timeout_err = requests.Timeout("Read timed out")
        ok_resp = MagicMock()
        ok_resp.status_code = 200
        ok_resp.json.return_value = {"elements": [{"type": "way", "id": 888}]}

        mock_post.side_effect = [timeout_err, ok_resp]

        ways = service.get_ways(47.6, -122.31, 47.61, -122.30)
        assert len(ways) == 1
        assert ways[0]["id"] == 888
        assert service.active_endpoint == "https://mirror.example.com"


def test_overpass_road_service_probe_on_launch():
    with patch("server.services.streetmap.overpass_road_service.select_fastest_endpoint") as mock_select:
        mock_select.return_value = ["https://fast.example.com", "https://slow.example.com"]
        service = OverpassRoadService(
            endpoints=["https://slow.example.com", "https://fast.example.com"],
            probe_on_init=True,
        )
        assert service.active_endpoint == "https://fast.example.com"
        assert service.endpoints == ["https://fast.example.com", "https://slow.example.com"]
        mock_select.assert_called_once()


def test_overpass_road_service_all_endpoints_fail_raises():
    service = OverpassRoadService(endpoints=["https://primary.example.com"], probe_on_init=False)
    with patch("server.services.streetmap.overpass_road_service.requests.post") as mock_post:
        mock_post.side_effect = Exception("Connection Refused")

        with pytest.raises(Exception, match="Connection Refused"):
            service.get_ways(47.6, -122.31, 47.61, -122.30)


def test_overpass_road_service_tries_all_endpoints_on_successive_failures():
    service = OverpassRoadService(
        endpoints=["https://ep1.example.com", "https://ep2.example.com", "https://ep3.example.com"],
        probe_on_init=False,
    )
    with patch("server.services.streetmap.overpass_road_service.requests.post") as mock_post:
        timeout_err = requests.Timeout("Timeout on ep1")
        error_504 = requests.HTTPError("504 Gateway Timeout")
        error_504.response = MagicMock(status_code=504)
        ok_resp = MagicMock()
        ok_resp.status_code = 200
        ok_resp.json.return_value = {"elements": [{"type": "way", "id": 999}]}

        mock_post.side_effect = [timeout_err, error_504, ok_resp]

        ways = service.get_ways(47.6, -122.31, 47.61, -122.30)
        assert len(ways) == 1
        assert ways[0]["id"] == 999
        assert service.active_endpoint == "https://ep3.example.com"
        assert mock_post.call_count == 3

