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
import base64
from google import genai
from google.genai import types
from server.services.ai.prompts import DESCRIPTION_PROMPT, QUESTION_PROMPT, SIMPLE_QUESTION_PROMPT
from server.core.models import ChatResponse, DescribeResponse
from server.core.logger import logger

from server.services.ai.base import AIServiceBase

class GeminiService(AIServiceBase):
    def __init__(self, api_key: str, model_id: str):
        self.api_key = api_key
        self.model_id = model_id
        self._client = genai.Client(api_key=api_key) if api_key else None

    @property
    def client(self):
        if self._client is None:
            if not self.api_key:
                raise ValueError("GEMINI_API_KEY is not configured")
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def generate_description(self, image_base64: str) -> str:
        """Generates a description of the panorama image."""
        img = self._prepare_image(image_base64)
        
        response = self.client.models.generate_content(
            model=self.model_id,
            contents=[DESCRIPTION_PROMPT, img],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=DescribeResponse,
            )
        )
        return response.parsed.description

    def ask_question(self, image_base64: str, question: str, detect_actions: bool = False):
        """Answers a question and optionally detects potential navigational actions."""
        img = self._prepare_image(image_base64)
        
        if detect_actions:
            prompt = QUESTION_PROMPT.format(question=question)
        else:
            prompt = SIMPLE_QUESTION_PROMPT.format(question=question)
        
        response = self.client.models.generate_content(
            model=self.model_id,
            contents=[prompt, img],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ChatResponse,
            )
        )
        
        result = response.parsed
        if not detect_actions:
            result.navigationalAction = "NONE"
        return result
