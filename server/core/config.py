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
from typing import List
from dotenv import load_dotenv
from pydantic import BaseModel, Field

_initial_env = {k: v for k, v in os.environ.items() if v.strip()}

example_conf_path = os.path.join(os.path.dirname(__file__), '..', 'streetreaderai.conf.example')
if os.path.exists(example_conf_path):
    load_dotenv(dotenv_path=example_conf_path, override=False)

conf_path = os.path.join(os.path.dirname(__file__), '..', 'streetreaderai.conf')
if os.path.exists(conf_path):
    load_dotenv(dotenv_path=conf_path, override=True)

for _k, _v in _initial_env.items():
    os.environ[_k] = _v


def _require_env(key: str) -> str:
    """Retrieve a required configuration value from environment/streetreaderai.conf.

    Fails if the value is not defined in the designated config file (server/streetreaderai.conf).
    """
    val = os.environ.get(key)
    if val is None or val.strip() == "":
        raise ValueError(
            f"Missing required configuration value for '{key}'. "
            f"Please define it in the designated configuration file (server/streetreaderai.conf). "
            f"See server/streetreaderai.conf.example for available settings."
        )
    return val.strip()


def _require_int_env(key: str) -> int:
    val_str = _require_env(key)
    try:
        return int(val_str)
    except ValueError:
        raise ValueError(
            f"Invalid integer value '{val_str}' for configuration '{key}' in server/streetreaderai.conf."
        )


def _get_float_env(key: str, default: float) -> float:
    val = os.environ.get(key)
    if val is None or val.strip() == "":
        return default
    try:
        return float(val.strip())
    except ValueError:
        return default


def _get_env(key: str, default: str) -> str:
    val = os.environ.get(key)
    if val is None or val.strip() == "":
        return default
    return val.strip()


def _get_bool_env(key: str, default: bool) -> bool:
    val = os.environ.get(key)
    if val is None or val.strip() == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


class AppConfig(BaseModel):
    # Starting Address
    STARTING_ADDRESS: str = Field(default_factory=lambda: _get_env("STARTING_ADDRESS", "601 N 34th St, Seattle, WA"))
    PANORAMAX_STARTING_ADDRESS: str = Field(default_factory=lambda: _get_env("PANORAMAX_STARTING_ADDRESS", "20 Rue de Rivoli, Paris, France"))

    # API Keys
    GOOGLE_MAPS_API_KEY: str = Field(default_factory=lambda: os.environ.get("GOOGLE_MAPS_API_KEY", ""))

    # AI Model Selection: gemini, openai
    AI_MODEL_PROVIDER: str = Field(default_factory=lambda: _require_env("AI_MODEL_PROVIDER").lower())

    # Partner Keys
    MAPILLARY_CLIENT_TOKEN: str = Field(default_factory=lambda: os.environ.get("MAPILLARY_CLIENT_TOKEN", ""))

    # Feature Flags & Selection
    IMAGERY_PROVIDER: str = Field(default_factory=lambda: _require_env("IMAGERY_PROVIDER").lower())
    LOCATION_SERVICE: str = Field(default_factory=lambda: _require_env("LOCATION_SERVICE").lower())

    # Logging: ERROR, VERBOSE
    LOG_LEVEL: str = Field(default_factory=lambda: _require_env("LOG_LEVEL").upper())

    # App Settings
    GEMINI_API_KEY: str = Field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    OPENAI_API_KEY: str = Field(default_factory=lambda: os.environ.get("OPENAI_API_KEY", ""))
    GEMINI_MODEL_ID: str = Field(default_factory=lambda: _require_env("GEMINI_MODEL_ID"))
    OPENAI_MODEL_ID: str = Field(default_factory=lambda: _require_env("OPENAI_MODEL_ID"))
    DEFAULT_FOV: int = Field(default_factory=lambda: _require_int_env("DEFAULT_FOV"))
    DEFAULT_NEARBY_RADIUS_M: int = Field(default_factory=lambda: _require_int_env("DEFAULT_NEARBY_RADIUS_M"))
    SERVER_CACHE_ENABLED: bool = Field(default_factory=lambda: _get_bool_env("SERVER_CACHE_ENABLED", True))
    SERVER_CACHE_MAX_MB: float = Field(default_factory=lambda: _get_float_env("SERVER_CACHE_MAX_MB", 1024.0))
    SERVER_CACHE_DB_PATH: str = Field(default_factory=lambda: _get_env("SERVER_CACHE_DB_PATH", ""))

    # Service Timeouts (seconds)
    OVERPASS_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("OVERPASS_TIMEOUT_S", 30.0))
    OVERPASS_HTTP_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("OVERPASS_HTTP_TIMEOUT_S", 30.0))
    NOMINATIM_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("NOMINATIM_TIMEOUT_S", 12.0))
    OVERPASS_NEARBY_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("OVERPASS_NEARBY_TIMEOUT_S", 15.0))
    MAPILLARY_METADATA_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("MAPILLARY_METADATA_TIMEOUT_S", 15.0))
    MAPILLARY_IMAGE_DOWNLOAD_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("MAPILLARY_IMAGE_DOWNLOAD_TIMEOUT_S", 20.0))
    PANORAMAX_METADATA_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("PANORAMAX_METADATA_TIMEOUT_S", 15.0))
    PANORAMAX_IMAGE_DOWNLOAD_TIMEOUT_S: float = Field(default_factory=lambda: _get_float_env("PANORAMAX_IMAGE_DOWNLOAD_TIMEOUT_S", 20.0))

    # Routing & Navigation Settings
    ROUTE_LOCATE_MAX_PERP_M: float = Field(default_factory=lambda: _get_float_env("ROUTE_LOCATE_MAX_PERP_M", 60.0))
    ROUTE_SNAPSHOT_RADIUS_M: float = Field(default_factory=lambda: _get_float_env("ROUTE_SNAPSHOT_RADIUS_M", 350.0))
    DEMO_MODE: bool = Field(default_factory=lambda: _get_bool_env("DEMO_MODE", False))

    # Service Endpoints & Base URLs
    NOMINATIM_BASE_URL: str = Field(default_factory=lambda: _require_env("NOMINATIM_BASE_URL").rstrip('/'))
    OVERPASS_ENDPOINTS: List[str] = Field(
        default_factory=lambda: [url.strip() for url in _require_env("OVERPASS_ENDPOINTS").split(",") if url.strip()]
    )
    GOOGLE_MAPS_BASE_URL: str = Field(default_factory=lambda: _require_env("GOOGLE_MAPS_BASE_URL").rstrip('/'))
    MAPILLARY_BASE_URL: str = Field(default_factory=lambda: _require_env("MAPILLARY_BASE_URL").rstrip('/'))
    PANORAMAX_BASE_URL: str = Field(default_factory=lambda: _get_env("PANORAMAX_BASE_URL", "https://api.panoramax.xyz/api").rstrip('/'))


config = AppConfig()
