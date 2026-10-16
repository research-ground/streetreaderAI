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

from unittest.mock import MagicMock, patch
import pytest

from server.core.cache import clear_all_caches, query_audit
from server.core.exceptions import APIException
from server.services.imagery.panoramax_image_service import PanoramaxProvider


SAMPLE_STAC_FEATURE = {
    "id": "px_item_001",
    "type": "Feature",
    "collection": "px_seq_abc",
    "geometry": {
        "type": "Point",
        "coordinates": [2.3499, 48.8533],
    },
    "properties": {
        "datetime": "2025-05-10T14:30:00+00:00",
        "view:azimuth": 108.5,
        "pers:interior_orientation": {
            "field_of_view": 360,
        },
    },
    "assets": {
        "sd": {
            "href": "https://panoramax.example.org/sd/px_item_001.jpg",
            "type": "image/jpeg",
        }
    },
    "links": [
        {"rel": "prev", "id": "px_item_000"},
        {"rel": "next", "id": "px_item_002"},
    ],
}


@pytest.fixture(autouse=True)
def _clean_caches():
    clear_all_caches()
    yield
    clear_all_caches()


def test_panoramax_bbox_metadata_and_stac_links():
    with patch("server.services.imagery.panoramax_image_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [SAMPLE_STAC_FEATURE]}
        mock_get.return_value = mock_resp

        provider = PanoramaxProvider(base_url="https://api.panoramax.xyz/api")
        metas = provider.get_metadata_bbox(48.85, 2.34, 48.86, 2.36)

        assert len(metas) == 1
        m = metas[0]
        assert m.imageId == "px_item_001"
        assert m.isPano is True
        assert m.sequenceId == "px_seq_abc"
        assert m.prevImageId == "px_item_000"
        assert m.nextImageId == "px_item_002"
        assert m.heading == 108.5
        assert m.coordinates.latitude == 48.8533
        assert m.coordinates.longitude == 2.3499
        assert m.thumbUrl == "https://panoramax.example.org/sd/px_item_001.jpg"
        assert m.captureTime.isdigit()

        # Verify server-side 360 filter was passed
        call_params = mock_get.call_args[1]["params"]
        assert call_params.get("filter") == "field_of_view=360"

        # Subsequent get_metadata must hit metadata_cache with 0 extra HTTP requests
        cached_meta = provider.get_metadata("px_item_001")
        assert cached_meta is not None
        assert cached_meta.imageId == "px_item_001"
        assert mock_get.call_count == 1


def test_panoramax_bbox_timeout_raises_api_exception():
    with patch("server.services.imagery.panoramax_image_service.requests.get") as mock_get:
        mock_get.side_effect = Exception("Read timeout")

        provider = PanoramaxProvider()
        with pytest.raises(APIException) as exc_info:
            provider.get_metadata_bbox(48.85, 2.34, 48.86, 2.36)
        assert exc_info.value.status_code == 503
        assert "Imagery service unavailable" in exc_info.value.message


def test_panoramax_get_image_uses_cached_metadata_without_redundant_meta_fetch():
    with patch("server.services.imagery.panoramax_image_service.requests.get") as mock_get, \
         patch("server.services.imagery.panoramax_image_service.crop_panorama") as mock_crop:
        mock_crop.return_value = b"cropped_jpeg_bytes"

        bbox_resp = MagicMock()
        bbox_resp.status_code = 200
        bbox_resp.json.return_value = {"features": [SAMPLE_STAC_FEATURE]}

        img_resp = MagicMock()
        img_resp.status_code = 200
        img_resp.content = b"raw_equirectangular_bytes"

        mock_get.side_effect = [bbox_resp, img_resp]

        provider = PanoramaxProvider()
        provider.get_metadata_bbox(48.85, 2.34, 48.86, 2.36)
        res = provider.get_image("px_item_001", heading=90.0)

        assert res is not None
        assert res["imageId"] == "px_item_001"
        assert res["actualHeading"] == 90.0
        # Only 2 HTTP GETs total: 1 bbox search + 1 image download (no redundant /search?ids= call)
        assert mock_get.call_count == 2

        # Rotating at the same image hits image_cache (0 additional HTTP calls)
        res2 = provider.get_image("px_item_001", heading=180.0)
        assert res2 is not None
        assert res2["actualHeading"] == 180.0
        assert mock_get.call_count == 2
        assert query_audit.snapshot()["duplicate_count"] == 0
