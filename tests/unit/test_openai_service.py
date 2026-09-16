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
from server.services.ai.openai_ai_service import OpenAIService
from server.core.models import ChatResponse


def test_openai_generate_description():
    with patch("server.services.ai.openai_ai_service.OpenAI") as mock_openai:
        mock_client = MagicMock()
        mock_openai.return_value = mock_client
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "A beautiful scene."
        mock_client.chat.completions.create.return_value = mock_response

        service = OpenAIService(api_key="test-key", model_id="gpt-5.6-terra")
        description = service.generate_description("base64data")
        assert description == "A beautiful scene."
        mock_client.chat.completions.create.assert_called_once()
        kwargs = mock_client.chat.completions.create.call_args[1]
        assert kwargs["model"] == "gpt-5.6-terra"
        assert kwargs["messages"][0]["content"][1]["image_url"]["url"] == "data:image/jpeg;base64,base64data"


def test_openai_generate_description_error_raises():
    with patch("server.services.ai.openai_ai_service.OpenAI") as mock_openai:
        mock_client = MagicMock()
        mock_openai.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("Rate limit exceeded")

        service = OpenAIService(api_key="test-key", model_id="gpt-5.6-terra")
        with pytest.raises(Exception, match="Rate limit exceeded"):
            service.generate_description("base64data")


def test_openai_ask_question():
    with patch("server.services.ai.openai_ai_service.OpenAI") as mock_openai:
        mock_client = MagicMock()
        mock_openai.return_value = mock_client
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.parsed = ChatResponse(
            answer="A building", navigationalAction="NONE",
        )
        mock_client.beta.chat.completions.parse.return_value = mock_response

        service = OpenAIService(api_key="test-key", model_id="gpt-5.6-terra")
        result = service.ask_question("base64data", "What is this?", detect_actions=False)
        assert result.answer == "A building"
        assert result.navigationalAction == "NONE"
        mock_client.beta.chat.completions.parse.assert_called_once()
        kwargs = mock_client.beta.chat.completions.parse.call_args[1]
        assert kwargs["response_format"] == ChatResponse
