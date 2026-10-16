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

import io
import pytest
from PIL import Image
import base64
from unittest.mock import MagicMock, patch
from server.services.ai.gemini_ai_service import GeminiService
from server.core.models import ChatResponse, DescribeResponse


def _make_dummy_image_b64() -> str:
    img = Image.new("RGB", (10, 10), color="blue")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def test_gemini_missing_api_key_raises():
    service = GeminiService(api_key="", model_id="gemini-3.8-flash")
    with pytest.raises(ValueError, match="GEMINI_API_KEY is not configured"):
        _ = service.client


def test_gemini_generate_description():
    with patch("server.services.ai.gemini_ai_service.genai.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        mock_resp = MagicMock()
        mock_resp.parsed = DescribeResponse(description="A sunny urban intersection.")
        mock_client.models.generate_content.return_value = mock_resp

        service = GeminiService(api_key="test-api-key", model_id="gemini-3.8-flash")
        result = service.generate_description(_make_dummy_image_b64())

        assert result == "A sunny urban intersection."
        mock_client.models.generate_content.assert_called_once()
        args, kwargs = mock_client.models.generate_content.call_args
        assert kwargs["model"] == "gemini-3.8-flash"
        assert kwargs["config"].response_schema == DescribeResponse


def test_gemini_ask_question_detect_actions_true():
    with patch("server.services.ai.gemini_ai_service.genai.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        mock_resp = MagicMock()
        mock_resp.parsed = ChatResponse(
            answer="Walking straight toward Pine Street.",
            navigationalAction="MOVE_FORWARD",
        )
        mock_client.models.generate_content.return_value = mock_resp

        service = GeminiService(api_key="test-api-key", model_id="gemini-3.8-flash")
        result = service.ask_question(
            _make_dummy_image_b64(),
            question="Can I walk forward?",
            detect_actions=True,
        )

        assert result.answer == "Walking straight toward Pine Street."
        assert result.navigationalAction == "MOVE_FORWARD"


def test_gemini_ask_question_detect_actions_false_overrides_to_none():
    with patch("server.services.ai.gemini_ai_service.genai.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        mock_resp = MagicMock()
        mock_resp.parsed = ChatResponse(
            answer="There is a tall red brick building.",
            navigationalAction="TURN_LEFT",
        )
        mock_client.models.generate_content.return_value = mock_resp

        service = GeminiService(api_key="test-api-key", model_id="gemini-3.8-flash")
        result = service.ask_question(
            _make_dummy_image_b64(),
            question="What is that building?",
            detect_actions=False,
        )

        assert result.answer == "There is a tall red brick building."
        assert result.navigationalAction == "NONE"


def test_gemini_api_key_override():
    with patch("server.services.ai.gemini_ai_service.genai.Client") as mock_client_cls:
        default_client = MagicMock()
        override_client = MagicMock()
        mock_client_cls.side_effect = [default_client, override_client]

        mock_resp = MagicMock()
        mock_resp.parsed = DescribeResponse(description="Overridden key description.")
        override_client.models.generate_content.return_value = mock_resp

        service = GeminiService(api_key="default-key", model_id="gemini-3.8-flash")
        result = service.generate_description(_make_dummy_image_b64(), api_key="custom-url-key")

        assert result == "Overridden key description."
        mock_client_cls.assert_any_call(api_key="custom-url-key")
        override_client.models.generate_content.assert_called_once()
        default_client.models.generate_content.assert_not_called()
