# StreetReaderAI

StreetReaderAI is an AI-powered accessibility tool designed for blind and low-vision travelers to explore and interact with street-level imagery. Users can navigate on foot, inspect their surroundings with detailed visual scene descriptions, detect upcoming intersections and points of interest, and ask natural language questions about the current scene using multimodal AI.

## Research Paper & Citation

StreetReaderAI is based on the research presented at ACM UIST 2025:

> Jon E. Froehlich, Alexander J. Fiannaca, Nimer M. Jaber, Victor Tsaran, and Shaun K. Kane. 2025. **StreetReaderAI: Making Street View Accessible Using Context-Aware Multimodal AI**. In *Proceedings of the 38th Annual ACM Symposium on User Interface Software and Technology (UIST ’25)*. Association for Computing Machinery, New York, NY, USA, 1–22. https://doi.org/10.1145/3746059.3747756

While the original research prototype in the paper was built on Google Street View and internal APIs (used with permission), this open-source release uses open APIs:
* **Road Network**: OpenStreetMap (OSM) via local extracts, the OSM `/api/0.6/map.json` endpoint, or the public Overpass API.
* **Street Imagery**: [Mapillary](https://www.mapillary.com/) Graph API v4 or [Panoramax](https://panoramax.fr/) STAC API for panoramic 360° street-level imagery.
* **Geocoding & POIs**: OpenStreetMap Nominatim (with optional Google Maps support).
* **Multimodal AI**: Google Gemini (`gemini-3.8-flash`) or OpenAI (`gpt-5.6-terra`).

### Cite this work
```bibtex
@inproceedings{Froehlich_2025,
  series = {UIST '25},
  title = {StreetReaderAI: Making Street View Accessible Using Context-Aware Multimodal AI},
  url = {https://doi.org/10.1145/3746059.3747756},
  DOI = {10.1145/3746059.3747756},
  booktitle = {Proceedings of the 38th Annual ACM Symposium on User Interface Software and Technology},
  publisher = {ACM},
  author = {Froehlich, Jon E. and Fiannaca, Alexander J. and Jaber, Nimer M and Tsaran, Victor and Kane, Shaun K.},
  year = {2025},
  pages = {1–22},
  collection = {UIST '25}
}
```

## Setup

### 1. Prerequisites
* **Node.js** (v18+) and **npm**
* **Python 3.10+**
* **[uv](https://docs.astral.sh/uv/)** (recommended Python package manager)
* An API key for [Gemini](https://gemini.google.com) or [ChatGPT](https://chatgpt.com/)

### 2. Automated Setup

Run the automated setup target from the repository root:

```bash
make setup
```

This command will:
1. Copy `server/streetreaderai.conf.example` to `server/streetreaderai.conf` (if not already present).
2. Install Python dependencies in a virtual environment via `uv sync`.
3. Install frontend npm dependencies in `client/`.

### 3. Configure API Keys & AI Model Selection

Open `server/streetreaderai.conf` in a text editor to configure your keys and model preferences:
* **`AI_MODEL_PROVIDER`**: Set to `"gemini"` (default) or `"openai"` to choose your multimodal AI provider. For either provider, you need an API key.
* **`GEMINI_API_KEY`** / **`OPENAI_API_KEY`**: Provide the corresponding key for your chosen provider.
* **`GEMINI_MODEL_ID`** / **`OPENAI_MODEL_ID`**: (Optional) Customize the specific model name (defaults to `gemini-3.8-flash` and `gpt-5.6-terra`).
* **`IMAGERY_PROVIDER`**: Set to `"mapillary"` (default) or `"panoramax"` (which requires no API key).
* **`MAPILLARY_CLIENT_TOKEN`**: Required when `IMAGERY_PROVIDER="mapillary"`. You can get a free token from the [Mapillary Developer Portal](https://www.mapillary.com/dashboard/developers).
* **`LOCATION_SERVICE`**: Defaults to `"osm"` (OpenStreetMap / Nominatim, requiring no API key). You can switch to `"google"` by supplying a `GOOGLE_MAPS_API_KEY`.
* **`SERVER_CACHE_MAX_MB`**: Total disk budget for server SQLite LRU caches in megabytes (defaults to `1024`).
* **`SERVER_CACHE_DB_PATH`**: (Optional) Custom path for the cache SQLite database file (defaults to `server/.cache/streetreaderai.db`).

### 4. Server Disk-Backed Caching Architecture

StreetReaderAI includes a bounded, thread-safe, disk-backed caching system powered by SQLite (`server/.cache/streetreaderai.db`). It keeps navigation, imagery, and AI scene inspection responsive across server restarts while strictly bounding disk usage:

* **Persistence Across Restarts**: Cache data survives server reboots and process reloads, eliminating cold-start re-fetching for previously visited neighborhoods.
* **Transparent Operation**: Operates entirely within the backend service layer with zero changes to REST API contracts or query parameters.
* **High Performance**: Uses SQLite WAL mode with a 32MB in-memory page cache for sub-millisecond lookups.
* **Bounded LRU Eviction**: Total cache size is capped at `SERVER_CACHE_MAX_MB` (default: 1024 MB). When the budget is reached, least-recently-used records are automatically pruned.
* **Six Dedicated Tiers**:
  1. **`image_cache`**: Stores full-resolution equirectangular panorama buffers downloaded from Mapillary or Panoramax. Heading rotations and `1440×1080` rectilinear viewport projections are served directly from cache with zero redundant image downloads.
  2. **`window_cache`**: Caches per-intersection imagery bounding boxes (`junction_v3`) and full 360° camera sequence frame lists (`seq`).
  3. **`road_cache`**: Caches OSM highway vector features with **spatial containment lookup**: when moving within known bounding boxes, road networks are reused instantly without issuing new network requests.
  4. **`metadata_cache`**: Caches individual panorama metadata records (`ImageMetadata`).
  5. **`graph_cache`**: Caches solved navigation nodes (`NodePlace`) and outgoing links (`NavigationLink`) produced by the 5-step sequence-slice routing solver.
  6. **`description_cache`**: Content-addressed cache keyed by SHA-256 hashes of the projected viewport image base64 bytes. Looking in a previously observed direction returns cached AI descriptions immediately.

### 5. Build, Start & URL Query Parameters

Build the Angular frontend and start the backend server:

```bash
# Build the client and launch the server on port 5001
make start
```

Open your browser and navigate to **<http://localhost:5001>**. The Flask backend serves both the REST API and the Angular single-page application.

#### Zero-Key Instant Exploration (`make start-panoramax`)
Want to test street navigation immediately before registering for a Mapillary token? Run:
```bash
make start-panoramax
```
This launches StreetReaderAI using **Panoramax** (`20 Rue de Rivoli, Paris, France`) + OpenStreetMap (Nominatim & Overpass), which require **zero API keys**. You can then pass your Gemini key directly in the browser URL (`http://localhost:5001/?gemini_key=YOUR_KEY`) to test AI descriptions and Q&A without editing any configuration files.

#### Running with Docker
You can also build and run the entire stack (Angular frontend + Python backend + persistent SQLite cache) in Docker without installing Node.js or Python locally:
```bash
# Launch with Docker Compose (persists SQLite cache in ./server/.cache)
GEMINI_API_KEY="your_key" IMAGERY_PROVIDER="panoramax" docker compose up --build

# Or using Make
make docker-run
```

#### Optional URL Query Parameters
You can customize runtime behavior directly via browser URL query parameters:
* **`?gemini_key=<API_KEY>`** (or `?geminiKey=<API_KEY>`): Overrides the server's configured `GEMINI_API_KEY` for AI scene descriptions (`describeImage`) and Q&A (`askQuestion`) during the current browser tab session (`sessionStorage`). Passing `?gemini_key=` with an empty value clears the session override.
* **`?demo=true`** (or `?demo=false`): Enables or disables Demo Mode in the browser, providing curated starting locations and sample AI questions in the UI.

### 6. Running Tests

```bash
# Run fast offline unit tests (server pytest + client Angular tests)
make test

# Run full integration and Playwright browser tests
make test-all
```
For detailed information on the test tiers, see [tests/README-tests.md](tests/README-tests.md) and [docs/routing_architecture.md](docs/routing_architecture.md).

## Credits

The original research prototype was developed by:
* [Jon Froehlich](https://jonfroehlich.github.io/)
* [Alex Fiannaca](https://www.linkedin.com/in/alfianna)
* [Victor Tsaran](https://www.linkedin.com/in/victortsaran)
* [Nimer Jaber](https://www.linkedin.com/in/nimer-jaber-68b96ba5)
* [Shaun Kane](https://shaunkane.com)

This open source version was created by:
* [Shaun Kane](https://shaunkane.com)
* [Sam Sepah](https://www.linkedin.com/in/samsepah)
* [Bill Neubauer](https://www.linkedin.com/in/william-neubauer)
* [Philip Nelson](https://research.google/people/philip-nelson/)

## Disclaimers
Eligibility for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security) is determined by the [Google Open Source Software Vulnerability Reward Program Rules](https://bughunters.google.com/about/rules/open-source/google-open-source-software-vulnerability-reward-program-rules).

This project is intended for demonstration purposes only. It is not
intended for use in a production environment.