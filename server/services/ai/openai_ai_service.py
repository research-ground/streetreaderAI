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

from server.services.ai.base import AIServiceBase
from openai import OpenAI
from server.services.ai.prompts import DESCRIPTION_PROMPT, QUESTION_PROMPT, SIMPLE_QUESTION_PROMPT
from server.core.models import ChatResponse
from server.core.logger import logger

class OpenAIService(AIServiceBase):
    def __init__(self, api_key: str, model_id: str):
        self.client = OpenAI(api_key=api_key)
        self.model_id = model_id

    def generate_description(self, image_base64: str) -> str:
        """Generates a description of the panorama image."""
        try:
            response = self.client.chat.completions.create(
                model=self.model_id,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": DESCRIPTION_PROMPT},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_base64}"
                                },
                            },
                        ],
                    }
                ],
                max_tokens=300,
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"OpenAI error: {str(e)}")
            raise

    def ask_question(self, image_base64: str, question: str, detect_actions: bool = False) -> ChatResponse:
        """Answers a question and optionally detects potential navigational actions."""
        if detect_actions:
            prompt = QUESTION_PROMPT.format(question=question)
        else:
            prompt = SIMPLE_QUESTION_PROMPT.format(question=question)

        try:
            system_prompt = "You are a helpful assistant."
            response = self.client.beta.chat.completions.parse(
                model=self.model_id,
                response_format=ChatResponse,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_base64}"
                                },
                            },
                        ],
                    }
                ],
                max_tokens=300,
            )
            
            result = response.choices[0].message.parsed
            if not detect_actions:
                result.navigationalAction = "NONE"
            return result
            
        except Exception as e:
            logger.error(f"OpenAI error: {str(e)}")
            raise
