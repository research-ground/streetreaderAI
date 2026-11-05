# Configuring Data & AI Providers (`streetreaderai.conf`)

StreetReaderAI uses a single human-readable INI configuration file—**[`streetreaderai.conf`](../streetreaderai.conf)**—read on the Node.js server ([`src/server.ts`](../src/server.ts)):

* A keyless `streetreaderai.conf` is checked directly into git (rather than `.conf.example`) so cloud IDEs like Google AI Studio can import the repository cleanly without renaming files.
* When adding personal API keys locally, mark the file `skip-worktree` so git ignores your local changes:
  ```bash
  git update-index --skip-worktree streetreaderai.conf
  ```

### Why Configuration Is Served via `/api/config` and `/api/proxy`
Google AI Studio requires all Gemini API calls to execute on the server (`MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`), and keeping API keys on the server prevents secrets from ever entering browser bundles or network logs.
* At startup (and on each config request), [`src/server.ts`](../src/server.ts) reads `streetreaderai.conf` (plus any environment variables like `GEMINI_API_KEY` injected by AI Studio).
* When the browser requests `GET /api/config`, the server returns the configuration with every non-empty key under `[keys]` replaced by an opaque placeholder (`__SERVER_KEY:<key_name>__`).
* Whenever a client service needs to call an API that requires a key (such as Gemini, OpenAI, Mapillary, or Google Maps), [`ConfigService.proxiedFetch()`](../src/app/services/config_service.ts) routes the request to `POST /api/proxy`, where `src/server.ts` validates the target hostname against configured provider domains, swaps `__SERVER_KEY:...__` for the real secret in server memory, and executes Gemini calls via the official `@google/genai` SDK while preserving real HTTP status codes and error messages (`503`, `429`, etc.).

---

## 1. System Settings (`[system]`) & API Keys (`[keys]`)

```ini
[system]
imagery_provider = panoramax
location_provider = osm
ai_provider = gemini
starting_address = 2110 5th Ave, Seattle, WA
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
| | `google` | `google_maps_api_key` | Uses Google Street View Static API & Metadata API. |
| **Location & POIs** (`location_provider`) | `osm` (default) | *None* | Uses Nominatim for geocoding/autocomplete and extracts POIs directly from the cached OpenStreetMap road tile. |
| | `google` | `google_maps_api_key` | Uses Google Geocoding API and Places API (New) v1. |
| **Multimodal AI** (`ai_provider`) | `gemini` (default) | `gemini_api_key` | Uses `gemini-3.5-flash-lite` by default (`[ai.gemini]`); auto-detected in Google AI Studio. |
| | `openai` | `openai_api_key` | Uses `gpt-5.6-terra` by default (`[ai.openai]`) via OpenAI Chat Completions API. |

### Changing AI Providers or Model Versions
Because API keys and model selections are managed on the server, switching between **Google Gemini** and **OpenAI** (or changing model versions) is done in `streetreaderai.conf`:

1. **To use Google Gemini (default)**:
   ```ini
   [system]
   ai_provider = gemini

   [keys]
   gemini_api_key = YOUR_GEMINI_API_KEY

   [ai.gemini]
   requires_key = gemini_api_key
   wire_format = gemini
   model_id = gemini-3.5-flash-lite
   endpoint_url = https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
   ```
2. **To switch to OpenAI**:
   ```ini
   [system]
   ai_provider = openai

   [keys]
   openai_api_key = YOUR_OPENAI_API_KEY

   [ai.openai]
   requires_key = openai_api_key
   wire_format = openai
   model_id = gpt-5.6-terra
   endpoint_url = https://api.openai.com/v1/chat/completions
   ```
3. **Applying Changes**: Save `streetreaderai.conf` and refresh the browser tab. `GET /api/config` re-reads `streetreaderai.conf` on every request, so you do not need to restart the development server.

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
| `model_id` | Model identifier substituted into `{model}` or sent in the request body (`gemini-3.5-flash-lite` or `gpt-5.6-terra`). |
| `endpoint_url` | Full API endpoint URL template (supports `{model}` and `{apiKey}` placeholders). |

### Gemini Voice Output (`[tts.gemini]`)

When **Voice type** is set to **Gemini** in Settings, [`SpeechOutputService`](../src/app/services/speech_output_service.ts) synthesizes speech with the model configured here (requests go through `POST /api/proxy`, so the key stays on the server). If a Gemini TTS request fails, the HTTP error is shown and that phrase is spoken with the local voice instead. The **Local** voice type uses English browser/OS voices only.

```ini
[tts.gemini]
requires_key = gemini_api_key
model_id = gemini-3.8-flash-lite-tts
endpoint_url = https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
```

---

## 5. Adding a New Provider (No Code Required)

`ConfigService` automatically registers every `[imagery.<name>]`, `[location.<name>]`, and `[ai.<name>]` section in `streetreaderai.conf`, along with any custom key names defined under `[keys]`. To add a new provider:

1. **Add the API key (if required)** under `[keys]` in `streetreaderai.conf` using any descriptive name (e.g., `my_provider_key = ...`).
2. **Define the plugin section** (`[imagery.my_provider]`, `[location.my_provider]`, or `[ai.my_provider]`) in `streetreaderai.conf` with its URL templates and JSON dot-path field mappings, referencing `requires_key = my_provider_key`.
3. **Activate it** under `[system]` in `streetreaderai.conf` by setting `imagery_provider = my_provider`, `location_provider = my_provider`, or `ai_provider = my_provider`.
4. **(Optional) Add a unit test** in [`src/app/services/provider_plugins_test.ts`](../src/app/services/provider_plugins_test.ts) using `config.applyConfText(...)` and a sample JSON payload to verify that all fields parse as expected.
