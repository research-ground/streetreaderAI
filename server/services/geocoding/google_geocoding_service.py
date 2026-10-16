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
from typing import List, Optional
from server.core.cache import metadata_cache, query_audit
from server.core.config import config
from server.services.geocoding.base import LocationService, AutocompletePrediction
from server.core.logger import logger

class GoogleLocationService(LocationService):
    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        self.base_url = (base_url or config.GOOGLE_MAPS_BASE_URL).rstrip('/')

    def geocode(self, address: str) -> Optional[dict]:
        cache_key = f"google:fwd:{self.base_url}:{address.strip().lower()}"
        cached = metadata_cache.get(cache_key)
        if cached is not None:
            query_audit.record_cache_hit("google_geocode")
            return cached
        endpoint = f"{self.base_url}/geocode/json"
        params = {"key": self.api_key, "address": address}

        query_audit.record_external("google_geocode", address.strip().lower())
        resp = requests.get(endpoint, params=params).json()
        if resp['status'] == 'OK' and resp['results']:
            # Normalized to the same shape the OSM service returns, so the
            # providers stay interchangeable: 'street' feeds the seeding
            # algorithm's street-name hint (corner buildings snap to the
            # street the address names, not the nearest road).
            result = resp['results'][0]
            street = None
            for comp in result.get('address_components', []):
                if 'route' in comp.get('types', []):
                    street = comp.get('long_name')
                    break
            res = {
                'lat': result['geometry']['location']['lat'],
                'lng': result['geometry']['location']['lng'],
                'address': result.get('formatted_address', address),
                'street': street,
            }
            metadata_cache.put(cache_key, res)
            return res

        logger.error(f"Geocoding failed for {address}. Status: {resp.get('status')}, Error: {resp.get('error_message', 'No message')}")
        return None

    def reverse_geocode(self, lat: float, lng: float, result_type: Optional[str] = None, return_all: bool = False) -> Optional[dict | List[dict]]:
        cache_key = f"google:rev:{self.base_url}:{round(lat, 5)}:{round(lng, 5)}:{result_type or ''}:{return_all}"
        cached = metadata_cache.get(cache_key)
        if cached is not None:
            query_audit.record_cache_hit("google_rev_geocode")
            return cached
        endpoint = f"{self.base_url}/geocode/json"
        params = {
            "latlng": f"{lat},{lng}",
            "key": self.api_key
        }
        if result_type:
            params["result_type"] = result_type

        query_audit.record_external("google_rev_geocode", f"{round(lat, 5)},{round(lng, 5)}")
        resp = requests.get(endpoint, params=params).json()
        if resp['status'] == 'OK' and resp['results']:
            out = resp['results'] if return_all else resp['results'][0]
            metadata_cache.put(cache_key, out)
            return out

        logger.error(f"Reverse geocoding failed for {lat}, {lng}. Status: {resp.get('status')}, Error: {resp.get('error_message', 'No message')}")
        return None

    def autocomplete(self, query: str, session_token: Optional[str] = None) -> List[AutocompletePrediction]:
        endpoint = f"{self.base_url}/place/autocomplete/json"
        params = {
            "input": query,
            "key": self.api_key,
            "types": "address"
        }
        if session_token:
            params["sessiontoken"] = session_token

        query_audit.record_external("google_autocomplete", query.strip().lower())
        resp = requests.get(endpoint, params=params).json()
        if resp['status'] == 'OK':
            return [AutocompletePrediction(description=p['description'], place_id=p['place_id']) 
                    for p in resp['predictions']]

        logger.error(f"Autocomplete failed for {query}. Status: {resp.get('status')}, Error: {resp.get('error_message', 'No message')}")
        return []

    def nearby_search(self, lat: float, lng: float, radius: int) -> List[dict]:
        cache_key = f"google:nearby:{self.base_url}:{round(lat, 4)}:{round(lng, 4)}:{radius}"
        cached = metadata_cache.get(cache_key)
        if cached is not None:
            query_audit.record_cache_hit("google_nearby")
            return cached
        endpoint = f"{self.base_url}/place/nearbysearch/json"
        params = {
            "location": f"{lat},{lng}",
            "radius": radius,
            "key": self.api_key
        }
        query_audit.record_external("google_nearby", f"{round(lat, 4)},{round(lng, 4)}:{radius}")
        resp = requests.get(endpoint, params=params).json()
        if resp['status'] == 'OK':
            results = resp['results']
            metadata_cache.put(cache_key, results)
            return results

        logger.error(f"Nearby search failed for {lat}, {lng}. Status: {resp.get('status')}, Error: {resp.get('error_message', 'No message')}")
        return []
