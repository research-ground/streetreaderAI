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
from server.core.exceptions import APIException

class OpenStreetMapLocationService(LocationService):
    def __init__(
        self,
        user_agent: str = "StreetReaderAI/1.0",
        nominatim_base_url: Optional[str] = None,
        overpass_endpoint: Optional[str] = None,
    ):
        self.user_agent = user_agent
        self.headers = {"User-Agent": self.user_agent}
        self.nominatim_base_url = (nominatim_base_url or config.NOMINATIM_BASE_URL).rstrip('/')
        self.overpass_endpoint = overpass_endpoint or (
            config.OVERPASS_ENDPOINTS[0] if config.OVERPASS_ENDPOINTS else "https://overpass-api.de/api/interpreter"
        )

    def _check_rate_limit(self, resp: requests.Response):
        if resp.status_code == 429:
            raise APIException("OpenStreetMap rate limit exceeded. Please wait a few moments before trying again.", 429)
        resp.raise_for_status()

    def geocode(self, address: str) -> Optional[dict]:
        cache_key = f"nominatim:fwd:{self.nominatim_base_url}:{address.strip().lower()}"
        cached = metadata_cache.get(cache_key)
        if cached is not None:
            query_audit.record_cache_hit("nominatim")
            return cached
        endpoint = f"{self.nominatim_base_url}/search"
        params = {
            "q": address,
            "format": "json",
            "limit": 1,
            "addressdetails": 1,  # gives us the road name, so snapping can match by street
        }
        try:
            query_audit.record_external("nominatim_fwd", address.strip().lower())
            resp = requests.get(endpoint, params=params, headers=self.headers, timeout=config.NOMINATIM_TIMEOUT_S)
            self._check_rate_limit(resp)
            data = resp.json()
            if data and len(data) > 0:
                details = data[0].get('address') or {}
                res = {
                    'lat': float(data[0]['lat']),
                    'lng': float(data[0]['lon']),
                    'address': data[0].get('display_name', address),
                    'street': details.get('road') or details.get('pedestrian'),
                }
                metadata_cache.put(cache_key, res)
                return res
        except APIException:
            raise
        except Exception as e:
            logger.error(f"OSM Geocoding failed for {address}: {e}")
        return None

    def reverse_geocode(self, lat: float, lng: float, result_type: Optional[str] = None, return_all: bool = False) -> Optional[dict | List[dict]]:
        cache_key = f"nominatim:rev:{self.nominatim_base_url}:{round(lat, 5)}:{round(lng, 5)}"
        cached = metadata_cache.get(cache_key)
        if cached is not None:
            query_audit.record_cache_hit("nominatim")
            return [cached] if return_all else cached
        endpoint = f"{self.nominatim_base_url}/reverse"
        params = {
            "lat": lat,
            "lon": lng,
            "format": "json"
        }
        try:
            query_audit.record_external("nominatim_rev", f"{round(lat, 5)},{round(lng, 5)}")
            resp = requests.get(endpoint, params=params, headers=self.headers, timeout=config.NOMINATIM_TIMEOUT_S)
            self._check_rate_limit(resp)
            data = resp.json()
            if 'display_name' in data:
                res_dict = {'formatted_address': data['display_name']}
                metadata_cache.put(cache_key, res_dict)
                if return_all:
                    return [res_dict]
                return res_dict
        except APIException:
            raise
        except Exception as e:
            logger.error(f"OSM Reverse Geocoding failed for {lat}, {lng}: {e}")
        return None

    def autocomplete(self, query: str, session_token: Optional[str] = None) -> List[AutocompletePrediction]:
        # Nominatim doesn't have a true autocomplete, so we use search
        endpoint = f"{self.nominatim_base_url}/search"
        params = {
            "q": query,
            "format": "json",
            "limit": 5
        }
        try:
            resp = requests.get(endpoint, params=params, headers=self.headers, timeout=config.NOMINATIM_TIMEOUT_S)
            self._check_rate_limit(resp)
            data = resp.json()
            if data:
                return [AutocompletePrediction(description=p['display_name'], place_id=str(p['place_id'])) 
                        for p in data]
        except APIException:
            raise
        except Exception as e:
            logger.error(f"OSM Autocomplete failed for {query}: {e}")
        return []

    def nearby_search(self, lat: float, lng: float, radius: int) -> List[dict]:
        # Use Overpass API for nearby POIs
        endpoint = self.overpass_endpoint
        query = f"""
        [out:json][timeout:{int(config.OVERPASS_NEARBY_TIMEOUT_S)}];
        node(around:{radius},{lat},{lng})["name"];
        out 20;
        """
        try:
            resp = requests.post(endpoint, data={"data": query}, headers=self.headers, timeout=config.OVERPASS_NEARBY_TIMEOUT_S).json()
            results = []
            if 'elements' in resp:
                for element in resp['elements']:
                    if 'lat' in element and 'lon' in element:
                        results.append({
                            'geometry': {
                                'location': {
                                    'lat': float(element['lat']),
                                    'lng': float(element['lon'])
                                }
                            },
                            'name': element.get('tags', {}).get('name', 'Unknown Place'),
                            'vicinity': element.get('tags', {}).get('amenity', '') or element.get('tags', {}).get('shop', '')
                        })
                return results
        except Exception as e:
            logger.error(f"OSM Nearby search failed for {lat}, {lng}: {e}")
            
        # Fallback if Overpass API is down or returns empty (common on free tier)
        return [{
            'geometry': {
                'location': {'lat': lat + 0.0001, 'lng': lng + 0.0001}
            },
            'name': 'Local Business (Fallback)',
            'vicinity': 'Nearby Area'
        }]
