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
from server.core.cache import clear_all_caches, metadata_cache, window_cache
from server.core.exceptions import APIException


@pytest.fixture(autouse=True)
def _clean_caches():
    clear_all_caches()
    yield
    clear_all_caches()


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
        # Bulk bbox query must omit thumb_2048_url and do 0 per-frame metadata_cache writes
        fields_param = mock_get.call_args[1]["params"]["fields"]
        assert "thumb_2048_url" not in fields_param
        assert len(metadata_cache) == 0


def test_mapillary_get_sequence_single_db_write_and_no_thumbnails():
    with patch("server.services.imagery.mapillary_image_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {
                    "id": f"frame_{i}",
                    "geometry": {"coordinates": [-122.3126, 47.6200 + i * 0.0001]},
                    "is_pano": True,
                    "captured_at": 1750000000000 + i * 1000,
                    "sequence": "seq_bulk_1",
                }
                for i in range(50)
            ]
        }
        mock_get.return_value = mock_resp

        provider = MapillaryProvider(client_token="test-token")
        frames = provider.get_sequence("seq_bulk_1")

        assert len(frames) == 50
        assert [f.imageId for f in frames[:3]] == ["frame_0", "frame_1", "frame_2"]
        fields_param = mock_get.call_args[1]["params"]["fields"]
        assert "thumb_2048_url" not in fields_param
        # Entire sequence is stored as 1 row in window_cache and 0 rows in metadata_cache
        assert len(metadata_cache) == 0
        assert window_cache.get(("mapillary", "seq", "seq_bulk_1")) is not None


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
