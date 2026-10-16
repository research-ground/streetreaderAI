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

import os
from server.core.config import AppConfig

def test_config_default_fields():
    # Instantiate a clean config model falling back to default values
    config = AppConfig()
    
    # Assert type checks and logic boundaries
    assert isinstance(config.GOOGLE_MAPS_API_KEY, str)
    
    assert config.IMAGERY_PROVIDER in ["mapillary", "panoramax"]
    assert config.LOCATION_SERVICE in ["google", "osm"]
    assert config.GEMINI_MODEL_ID == "gemini-3.8-flash"
    assert config.OPENAI_MODEL_ID == "gpt-5.6-terra"
    
    assert config.STARTING_ADDRESS == "601 N 34th St, Seattle, WA"
    assert config.DEFAULT_FOV > 0
    assert config.DEFAULT_NEARBY_RADIUS_M > 0
    assert config.OVERPASS_TIMEOUT_S == 30.0
    assert config.OVERPASS_HTTP_TIMEOUT_S == 30.0
    assert config.NOMINATIM_TIMEOUT_S > 0
    assert config.OVERPASS_NEARBY_TIMEOUT_S > 0
    assert config.MAPILLARY_METADATA_TIMEOUT_S > 0
    assert config.MAPILLARY_IMAGE_DOWNLOAD_TIMEOUT_S > 0
    assert config.PANORAMAX_METADATA_TIMEOUT_S > 0
    assert config.PANORAMAX_IMAGE_DOWNLOAD_TIMEOUT_S > 0
    assert config.ROUTE_LOCATE_MAX_PERP_M > 0
    assert config.ROUTE_SNAPSHOT_RADIUS_M > 0
    assert config.NOMINATIM_BASE_URL.startswith("http")
    assert len(config.OVERPASS_ENDPOINTS) > 0
    assert config.GOOGLE_MAPS_BASE_URL.startswith("http")
    assert config.MAPILLARY_BASE_URL.startswith("http")
    assert config.PANORAMAX_BASE_URL.startswith("http")

def test_config_custom_instantiation():
    # Test custom configuration arguments injection
    config = AppConfig(
        GOOGLE_MAPS_API_KEY="custom-maps-key",
        DEFAULT_FOV=90,
        STARTING_ADDRESS="1600 Pennsylvania Avenue, Washington, DC",
    )
    
    assert config.GOOGLE_MAPS_API_KEY == "custom-maps-key"
    assert config.DEFAULT_FOV == 90
    assert config.STARTING_ADDRESS == "1600 Pennsylvania Avenue, Washington, DC"

def test_config_missing_required_field_fails(monkeypatch):
    # Verify system fails when a required configuration value is missing from environment/config
    import pytest
    monkeypatch.delenv("GEMINI_MODEL_ID", raising=False)
    with pytest.raises(ValueError, match="Missing required configuration value for 'GEMINI_MODEL_ID'"):
        AppConfig()
