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

from abc import ABC, abstractmethod
from server.core.models import ChatResponse
import PIL.Image
import io
import base64
from server.core.logger import logger

class AIServiceBase(ABC):
    def _prepare_image(self, image_base64: str) -> PIL.Image.Image:
        """Converts base64 string to PIL Image."""
        try:
            img_data = base64.b64decode(image_base64)
            return PIL.Image.open(io.BytesIO(img_data))
        except Exception as e:
            logger.error(f"Image decode failed: {str(e)}")
            raise

    @abstractmethod
    def generate_description(self, image_base64: str) -> str:
        """Generates a description of the panorama image."""
        pass

    @abstractmethod
    def ask_question(self, image_base64: str, question: str, detect_actions: bool = False) -> ChatResponse:
        """Answers a question and optionally detects potential navigational actions."""
        pass
