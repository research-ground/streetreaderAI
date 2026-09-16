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
import os
import base64
import pytest
from PIL import Image

def _has_ai_key() -> bool:
    ai_provider = (os.environ.get("AI_MODEL_PROVIDER") or "gemini").lower()
    if ai_provider == "gemini":
        key = os.environ.get("GEMINI_API_KEY", "").strip()
    else:
        key = os.environ.get("OPENAI_API_KEY", "").strip()
    return bool(key and not any(p in key.upper() for p in ["YOUR_", "_HERE", "PLACEHOLDER"]))

pytestmark = pytest.mark.skipif(
    not _has_ai_key(),
    reason="AI API key is not configured for the active AI_MODEL_PROVIDER in server/streetreaderai.conf"
)

def _generate_synthetic_image_b64() -> str:
    """Generates a small valid JPEG panorama mock in base64 if live imagery is unavailable."""
    img = Image.new("RGB", (400, 200), color=(100, 150, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")

@pytest.fixture(scope="module")
def sample_image_base64(api_client):
    """Base64 view image at the project's evidence-rich seed (411 15th Ave E).
    Falls back to a synthetic JPEG image if imagery is disabled or unavailable."""
    resp = api_client.generate_panorama_view(address="411 15th Ave E, Seattle, WA")
    if resp.status_code == 200 and resp.json().get("image"):
        return resp.json().get("image")
    # Fallback so AI tests can verify the AI service independently of imagery tokens
    return _generate_synthetic_image_b64()

def test_describe_image(api_client, sample_image_base64):
    """
    Test generating an AI description of a street view image.
    """
    resp = api_client.describe_image(image_bytes=sample_image_base64)

    assert resp.status_code == 200
    data = resp.json()
    assert "description" in data
    assert len(data["description"]) > 10

def test_ask_question_navigation_intent(api_client, sample_image_base64):
    """
    Test asking a question with clear navigational intent.
    """
    resp = api_client.ask_question(
        image_bytes=sample_image_base64,
        question="Go forward to the next intersection",
        detect_navigational_intent=True
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data.get("navigationalAction") != "NONE"

def test_ask_question_general(api_client, sample_image_base64):
    """
    Test asking a general question about the scene.
    """
    resp = api_client.ask_question(
        image_bytes=sample_image_base64,
        question="What is visible in this scene?",
        detect_navigational_intent=True
    )

    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert data.get("navigationalAction") == "NONE"
