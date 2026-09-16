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
from typing import List, Optional
from pydantic import BaseModel

class AutocompletePrediction(BaseModel):
    description: str
    place_id: str

class LocationService(ABC):
    @abstractmethod
    def geocode(self, address: str) -> Optional[dict]:
        """Converts an address to {lat, lng}."""
        pass

    @abstractmethod
    def reverse_geocode(self, lat: float, lng: float, result_type: Optional[str] = None) -> Optional[dict]:
        """Converts coords to address data."""
        pass

    @abstractmethod
    def autocomplete(self, query: str, session_token: Optional[str] = None) -> List[AutocompletePrediction]:
        """Provides address suggestions."""
        pass

    @abstractmethod
    def nearby_search(self, lat: float, lng: float, radius: int) -> List[dict]:
        """Finds nearby POIs."""
        pass
