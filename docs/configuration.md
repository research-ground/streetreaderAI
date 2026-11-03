# Configuring Data & AI Providers (`models.conf` & `streetreaderai.conf`)

StreetReaderAI uses two human-readable INI configuration files—**`models.conf`** and **`streetreaderai.conf`**—read on the Node.js server ([`src/server.ts`](../src/server.ts)):

1. **`models.conf` (templated from [`models.conf.example`](../models.conf.example))**: Selects active providers (`[providers]`), model versions (`[models]`), and secret API keys (`[keys]`).
2. **`streetreaderai.conf` (templated from [`streetreaderai.conf.example`](../streetreaderai.conf.example))**: Defines non-key system defaults (`[system]`) and declarative provider plugin definitions (`[imagery.*]`, `[location.*]`, `[ai.*]`) using URL templates and JSON dot-path field mappings.

### Why Configuration Is Split & Served via `/api/config` and `/api/proxy`
Originally, StreetReaderAI executed 100% in the browser. However, Google AI Studio requires all Gemini API calls to execute on the server (`MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`), and keeping API keys on the server prevents secrets from ever entering browser bundles or network logs.
* At startup, [`src/server.ts`](../src/server.ts) reads `streetreaderai.conf.example`, `streetreaderai.conf`, `models.conf.example`, and `models.conf` (plus any environment variables like `GEMINI_API_KEY` injected by AI Studio).
* When the browser requests `GET /api/config`, the server returns the merged configuration with every non-empty key under `[keys]` replaced by an opaque placeholder (`__SERVER_KEY:<key_name>__`).
* Whenever a client service needs to call an API that requires a key (such as Gemini, OpenAI, Mapillary, or Google Maps), [`ConfigService.proxiedFetch()`](../src/app/services/config_service.ts) routes the request to `POST /api/proxy`, where `src/server.ts` validates the target hostname against configured provider domains, swaps `__SERVER_KEY:...__` for the real secret in server memory, and executes Gemini calls via the official `@google/genai` SDK.

---

## 1. Selecting Active Providers (`[providers]`), Models (`[models]`), & API Keys (`[keys]`) in `models.conf`

Running `make setup` automatically copies `models.conf.example` to `models.conf` (git-ignored so your personal keys are never committed):

```ini
[providers]
ai_provider = gemini
imagery_provider = panoramax
location_provider = osm

[models]
gemini_model = gemini-3.8-flash
openai_model = gpt-5.6-terra

[keys]
gemini_api_key = YOUR_GEMINI_API_KEY
openai_api_key =
mapillary_token =
google_maps_api_key =
```

Meanwhile, general application defaults live under `[system]` in `streetreaderai.conf`:

```ini
[system]
starting_address = 601 N 34th St, Seattle, WA
max_poi_items = 3
```

### Startup Key Validation
When StreetReaderAI launches, `ConfigService.validateRequiredKeys()` checks whether the active providers selected under `[providers]` (or `[system]`) have `requires_key` set in their plugin definitions. If a required key is missing from `[keys]` (and not injected by the host environment), StreetReaderAI immediately displays a **Configuration Error** dialog naming the missing key and the section that requires it. You can also define arbitrary custom key names under `[keys]` (e.g., `my_custom_key = ...`) and reference them via `requires_key = my_custom_key` in any custom provider plugin section.

| Service Category | Built-In Providers | Required Key in `[keys]` | Notes |
| :--- | :--- | :--- | :--- |
| **Street Imagery** (`imagery_provider`) | `panoramax` (default) | *None* | Free, open federated 360° street-level imagery (STAC API). |
| | `mapillary` | `mapillary_token` | Free Client Token from the [Mapillary Developer Portal](https://www.mapillary.com/dashboard/developers). |
| | `google` | `google_maps_api_key` | Uses Google Street View Static API & Metadata API. |
| **Location & POIs** (`location_provider`) | `osm` (default) | *None* | Uses Nominatim for geocoding/autocomplete and extracts POIs directly from the cached OpenStreetMap road tile. |
| | `google` | `google_maps_api_key` | Uses Google Geocoding API and Places API (New) v1. |
| **Multimodal AI** (`ai_provider`) | `gemini` (default) | `gemini_api_key` | Uses `gemini_model` (`gemini-3.8-flash` by default; auto-detected in Google AI Studio). |
| | `openai` | `openai_api_key` | Uses `openai_model` (`gpt-5.6-terra` by default) via OpenAI Chat Completions API. |

### Changing AI Providers or Model Versions
Because API keys and model selections are managed on the server, switching between **Google Gemini** and **OpenAI** (or changing model versions) is done in `models.conf`:

1. **To use Google Gemini (default)**:
   ```ini
   [providers]
   ai_provider = gemini

   [models]
   gemini_model = gemini-3.8-flash

   [keys]
   gemini_api_key = YOUR_GEMINI_API_KEY
   ```
2. **To switch to OpenAI**:
   ```ini
   [providers]
   ai_provider = openai

   [models]
   openai_model = gpt-5.6-terra

   [keys]
   openai_api_key = YOUR_OPENAI_API_KEY
   ```
3. **Applying Changes**: Save `models.conf` and refresh the browser tab. `GET /api/config` re-reads `models.conf` on every request, so you do not need to restart the development server.

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

---

## 5. Adding a New Provider (No Code Required)

`ConfigService` automatically registers every `[imagery.<name>]`, `[location.<name>]`, and `[ai.<name>]` section in `streetreaderai.conf`, along with any custom key names defined under `[keys]` in `models.conf`. To add a new provider:

1. **Add the API key (if required)** under `[keys]` in `models.conf` using any descriptive name (e.g., `my_provider_key = ...`).
2. **Define the plugin section** (`[imagery.my_provider]`, `[location.my_provider]`, or `[ai.my_provider]`) in `streetreaderai.conf` with its URL templates and JSON dot-path field mappings, referencing `requires_key = my_provider_key`.
3. **Activate it** under `[providers]` in `models.conf` by setting `imagery_provider = my_provider`, `location_provider = my_provider`, or `ai_provider = my_provider` (and optionally `<name>_model = ...` under `[models]`).
4. **(Optional) Add a unit test** in [`src/app/services/provider_plugins_test.ts`](../src/app/services/provider_plugins_test.ts) using `config.applyConfText(...)` and a sample JSON payload to verify that all fields parse as expected.
