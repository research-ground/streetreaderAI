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

import requests
import os

class StreetReaderAPIClient:
    """
    A client for the StreetReaderAI API.
    Handles payload construction and HTTP requests for all endpoints.
    """
    def __init__(self, api_url: str):
        self.api_url = api_url.rstrip('/')
        self.headers = {
            "Content-Type": "application/json"
        }

    def _post(self, method: str, payload: dict) -> requests.Response:
        """Helper to send the POST request to the specific method."""
        from server.core.logger import logger
        # Methods are appended with a colon, e.g., /v1/streetreader:resolveLocation
        url = f"{self.api_url}:{method}"
        
        # Sanitize headers for logging
        log_headers = self.headers.copy()
            
        # Sanitize payload for logging (don't log full images)
        log_payload = payload.copy()
        if 'image' in log_payload:
            log_payload['image'] = f"<{len(log_payload['image'])} bytes>"
            
        logger.debug(f"API REQUEST: POST {url}")
        logger.debug(f"API HEADERS: {log_headers}")
        logger.debug(f"API PAYLOAD: {log_payload}")
        
        try:
            resp = requests.post(url, headers=self.headers, json=payload)
            logger.debug(f"API RESPONSE: {resp.status_code}")
            if resp.status_code >= 400:
                logger.error(f"API ERROR: {resp.status_code} - {resp.text}")
            else:
                logger.debug(f"API RESPONSE BODY: {resp.text}")
            return resp
        except Exception as e:
            logger.error(f"API EXCEPTION: {str(e)}")
            raise

    def resolve_address(self, lat: float, lng: float) -> requests.Response:
        """Retrieves the formatted street address for a given set of coordinates."""
        payload = {
            "coordinates": {
                "latitude": lat,
                "longitude": lng
            }
        }
        return self._post("resolveAddress", payload)

    def search_nearby_places(self, lat: float, lng: float) -> requests.Response:
        """Finds nearby Points of Interest (POIs) relative to a specific location."""
        payload = {
            "location": {
                "latitude": lat,
                "longitude": lng
            }
        }
        return self._post("searchNearbyPlaces", payload)

    def generate_panorama_view(self, image_id: str = None, lat: float = None, lng: float = None,
                               address: str = None, heading: float = 0.0, pitch: float = 0.0) -> requests.Response:
        """The primary navigation call: locate by image id, coordinates, or address."""
        payload = {"heading": heading, "pitch": pitch}
        if image_id:
            payload["name"] = image_id
        if lat is not None and lng is not None:
            payload["coordinates"] = {"latitude": lat, "longitude": lng}
        if address:
            payload["address"] = address
        return self._post("generatePanoramaView", payload)

    def describe_image(self, image_bytes: str) -> requests.Response:
        """Generates an AI-powered visual description of the provided image."""
        payload = {
            "image": image_bytes
        }
        return self._post("describeImage", payload)

    def ask_question(self, image_bytes: str, question: str, detect_navigational_intent: bool = False) -> requests.Response:
        """Answers specific questions about the provided image."""
        payload = {
            "image": image_bytes,
            "question": question,
            "detect_navigational_intent": detect_navigational_intent
        }
        return self._post("askQuestion", payload)

    def autocomplete_place(self, query: str, session_token: str = "default-session") -> requests.Response:
        """Provides an address suggestions proxy for place lookups."""
        payload = {
            "query": query,
            "session_token": session_token
        }
        return self._post("autocompletePlace", payload)
