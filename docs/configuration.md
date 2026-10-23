# Configuring Data & AI Providers (`streetreaderai.conf`)

StreetReaderAI uses a single human-readable INI configuration file—`streetreaderai.conf`—to select active backend services, supply API keys, and define provider plugins declaratively using URL templates and JSON dot-path field mappings.

* **`streetreaderai.conf.example`** (tracked in git): Default configuration template pre-configured for **Panoramax** (imagery), **OpenStreetMap** (geocoding & POIs), and **Google Gemini** (`gemini-3.8-flash`).
* **`streetreaderai.conf`** (git-ignored): Your local configuration file containing your personal API keys. Running `make setup` automatically copies `streetreaderai.conf.example` to `streetreaderai.conf` if it does not already exist.
* **Fallback in Google AI Studio**: When `streetreaderai.conf` is not present (such as when importing the public GitHub repository into Google AI Studio), StreetReaderAI automatically loads `streetreaderai.conf.example` and reads the host-injected `GEMINI_API_KEY`.

---

## 1. Selecting Active Providers (`[system]`) & API Keys (`[keys]`)

At the top of `streetreaderai.conf`, the `[system]` section selects which provider plugin is active for each service category, and `[keys]` stores any required API keys:

```ini
[system]
imagery_provider = panoramax
location_provider = osm
ai_provider = gemini
starting_address = 601 N 34th St, Seattle, WA
max_poi_items = 3

[keys]
gemini_api_key = YOUR_GEMINI_API_KEY
openai_api_key =
mapillary_token =
google_maps_api_key =
```

### Startup Key Validation
When StreetReaderAI launches, `ConfigService.validateRequiredKeys()` checks whether the active providers selected under `[system]` have `requires_key` set in their plugin definitions. If a required key is missing from `[keys]` (and not injected by the host environment), StreetReaderAI immediately displays a **Configuration Error** dialog naming the missing key and the section that requires it. You can also define arbitrary custom key names under `[keys]` (e.g., `my_custom_key = ...`) and reference them via `requires_key = my_custom_key` in any custom provider plugin section.

| Service Category | Built-In Providers | Required Key in `[keys]` | Notes |
| :--- | :--- | :--- | :--- |
| **Street Imagery** (`imagery_provider`) | `panoramax` (default) | *None* | Free, open federated 360° street-level imagery (STAC API). |
| | `mapillary` | `mapillary_token` | Free Client Token from the [Mapillary Developer Portal](https://www.mapillary.com/dashboard/developers). |
| **Location & POIs** (`location_provider`) | `osm` (default) | *None* | Uses Nominatim for geocoding/autocomplete and extracts POIs directly from the cached OpenStreetMap road tile. |
| | `google` | `google_maps_api_key` | Uses Google Geocoding API and Places API (New) v1. |
| **Multimodal AI** (`ai_provider`) | `gemini` (default) | `gemini_api_key` | Uses `gemini-3.8-flash` (auto-detected in Google AI Studio). |
| | `openai` | `openai_api_key` | Uses `gpt-5.6-terra` via OpenAI Chat Completions API. |

---

## 2. Declarative Imagery Plugins (`[imagery.<name>]`)

Each `[imagery.<name>]` section tells [`ImageryProviderService`](../src/app/services/imagery_provider_service.ts) how to discover street-level imagery, how to step along street blocks, and how to render viewports.

### Explicit Retrieval & Image Format Modes

Every imagery plugin declares two explicit mode fields:

1. **`retrieval_type = sequence | image`**
   * **`sequence`** (used by `panoramax` and `mapillary`):
     * Queries `bbox_url` around intersections to discover camera sequence IDs, then expands full multi-image camera trajectories via `sequence_url`.
   * **`image`** (used by point-queried imagery APIs):
     * Queries `point_url` at OSM intersections and samples intermediate points along candidate street blocks at `18 m` intervals so [`RouteProviderService`](../src/app/services/route_provider_service.ts) runs its exact same 5-step sequence solver without modification.
2. **`image_format = 360 | single`**
   * **`360`** (used by `panoramax` and `mapillary`):
     * Downloads a full 360° equirectangular panorama from the URL extracted via `thumb_url_field` and projects rectilinear viewports (`heading`, `pitch`) in-browser using HTML5 `<canvas>` ([`PanoramaCropService`](../src/app/services/panorama_crop_service.ts)). Rotating in place re-projects the cached panorama in memory with zero network calls.
   * **`single`** (used by directional viewport APIs):
     * Fetches a pre-cropped directional image directly from `image_url` using `{imageId}`, `{heading}`, and `{pitch}` placeholders.

### Supported `[imagery.<name>]` Fields

| Field | Description |
| :--- | :--- |
| `retrieval_type` | `sequence` (bbox + sequence trajectory) or `image` (point metadata queries). |
| `image_format` | `360` (equirectangular sphere cropped in-browser) or `single` (directional viewport URL). |
| `requires_key` | Optional key name in `[keys]` substituted into `{apiKey}` (e.g., `mapillary_token`). |
| `bbox_url` | URL template for bounding-box search (`{minLat}`, `{minLng}`, `{maxLat}`, `{maxLng}`, `{bbox}`, `{apiKey}`). |
| `sequence_url` | URL template for expanding a sequence (`{sequenceId}`, `{apiKey}`). |
| `point_url` | URL template for single-point lookup when `retrieval_type = image` (`{lat}`, `{lng}`, `{radius}`, `{apiKey}`). |
| `metadata_url` | URL template for single-image metadata lookup (`{imageId}`, `{apiKey}`). |
| `image_url` | URL template for directional image rendering when `image_format = single` (`{imageId}`, `{heading}`, `{pitch}`, `{fov}`, `{width}`, `{height}`, `{apiKey}`). |
| `items_path` | Dot-path to the array of items in the JSON response (e.g., `features` or `data`; leave empty if the response root is a single object or array). |
| `id_field` | Dot-path(s) to the unique image ID (e.g., `id`). |
| `lat_field`, `lng_field` | Dot-path(s) to latitude and longitude (supports array indices such as `geometry.coordinates.1` and `geometry.coordinates.0`). |
| `heading_field` | Comma-separated fallback dot-paths to camera compass heading in degrees (e.g., `computed_compass_angle, compass_angle`). |
| `capture_time_field` | Comma-separated fallback dot-paths to capture timestamp or ISO date string. |
| `sequence_field` | Dot-path to the parent sequence/collection identifier. |
| `is_pano_field`, `fov_field`, `dimensions_field` | Dot-paths used to verify 360° panoramic coverage. |
| `thumb_url_field` | Comma-separated fallback dot-paths to the 360° equirectangular image URL when `image_format = 360`. |

---

## 3. Declarative Location & Geocoding Plugins (`[location.<name>]`)

Each `[location.<name>]` section configures [`LocationProviderService`](../src/app/services/location_provider_service.ts):

| Field | Description |
| :--- | :--- |
| `requires_key` | Optional key name in `[keys]` substituted into `{apiKey}` (e.g., `google_maps_api_key`). |
| `geocode_url` | URL template for forward address geocoding (`{address}`, `{apiKey}`). |
| `reverse_geocode_url` | URL template for reverse geocoding (`{lat}`, `{lng}`, `{apiKey}`). |
| `autocomplete_url` | URL template for address autocomplete (`{query}`, `{apiKey}`), or a Google Places v1 `:autocomplete` endpoint. |
| `nearby_url` | Optional endpoint for nearby POI search. When omitted (as in `[location.osm]`), StreetReaderAI extracts named POIs directly from the already-cached OpenStreetMap v0.6 road tile with zero extra network requests. |
| `items_path` | Dot-path to the array of results in the JSON response (e.g., `results`, or empty when the response root is an array). |
| `status_field`, `status_ok_value` | Optional status field validation (e.g., `status = OK`). |
| `lat_field`, `lng_field` | Dot-paths to result coordinates (e.g., `lat` / `lon` or `geometry.location.lat` / `geometry.location.lng`). |
| `address_field` | Dot-path to the formatted display address (e.g., `display_name` or `formatted_address`). |
| `street_field` | Optional comma-separated dot-paths to the street/road name used as a seed hint during landing (`address.road, address.pedestrian`). |
| `place_id_field` | Dot-path to the unique place ID (`place_id`). |

---

## 4. Declarative AI Vision Plugins (`[ai.<name>]`)

Each `[ai.<name>]` section configures [`AiProviderService`](../src/app/services/ai_provider_service.ts):

| Field | Description |
| :--- | :--- |
| `requires_key` | Key name in `[keys]` (e.g., `gemini_api_key` or `openai_api_key`). |
| `wire_format` | Request/response schema format: `gemini` (Google Generative Language API) or `openai` (OpenAI-compatible Chat Completions API). |
| `model_id` | Model identifier substituted into `{model}` or sent in the request body (`gemini-3.8-flash` or `gpt-5.6-terra`). |
| `endpoint_url` | Full API endpoint URL template (supports `{model}` and `{apiKey}` placeholders). |
