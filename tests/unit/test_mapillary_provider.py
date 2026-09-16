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
from unittest.mock import MagicMock, patch
from server.services.imagery.mapillary_image_service import MapillaryProvider
from server.core.exceptions import APIException


def test_mapillary_bbox_metadata():
    with patch("server.services.imagery.mapillary_image_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {"id": "mapillary_123", "geometry": {"coordinates": [-122.3126, 47.6223]},
                 "is_pano": True, "captured_at": 1750000000000}
            ]
        }
        mock_get.return_value = mock_resp

        provider = MapillaryProvider(client_token="test-token")
        metas = provider.get_metadata_bbox(47.62, -122.32, 47.63, -122.31)

        assert len(metas) == 1
        assert metas[0].imageId == "mapillary_123"
        assert metas[0].isPano is True
        assert metas[0].coordinates.latitude == 47.6223


def test_mapillary_bbox_timeout_raises_api_exception():
    with patch("server.services.imagery.mapillary_image_service.requests.get") as mock_get:
        mock_get.side_effect = Exception("Read timeout")

        provider = MapillaryProvider(client_token="test-token")
        with pytest.raises(APIException) as exc_info:
            provider.get_metadata_bbox(47.62, -122.32, 47.63, -122.31)
        assert exc_info.value.status_code == 503
        assert "Imagery service unavailable" in exc_info.value.message


def test_mapillary_get_single_metadata_success():
    with patch("server.services.imagery.mapillary_image_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "id": "img_456",
            "geometry": {"coordinates": [-122.33, 47.60]},
            "captured_at": 1700000000,
            "compass_angle": 180.0,
            "is_pano": True,
            "sequence": "seq_789"
        }
        mock_get.return_value = mock_resp

        provider = MapillaryProvider(client_token="test-token")
        meta = provider.get_metadata("img_456")
        assert meta is not None
        assert meta.imageId == "img_456"
        assert meta.heading == 180.0
        assert meta.sequenceId == "seq_789"
