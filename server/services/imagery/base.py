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

"""Standard interface for street-level imagery providers (Mapillary, Panoramax, etc.)."""

from abc import ABC, abstractmethod
from typing import List, Optional

from server.core.models import LocationMetadata


class ImageryProvider(ABC):
    provider_name: str = "unknown"

    @abstractmethod
    def get_metadata(self, image_id: str) -> Optional[LocationMetadata]:
        """Retrieve metadata for a single image by ID."""
        pass

    @abstractmethod
    def get_metadata_bbox(
        self, min_lat: float, min_lng: float, max_lat: float, max_lng: float
    ) -> List[LocationMetadata]:
        """Retrieve metadata for candidate images within the bounding box."""
        pass

    @abstractmethod
    def get_image(
        self, image_id: str, heading: float = 0, pitch: float = 0
    ) -> Optional[dict]:
        """Retrieve and crop the panorama image for the requested heading/pitch."""
        pass

    def get_sequence(self, sequence_id: str) -> List[LocationMetadata]:
        """Retrieve all candidate image metadata belonging to a sequence."""
        return []
