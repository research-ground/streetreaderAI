# StreetReaderAI

StreetReaderAI is an AI-powered accessibility tool designed for blind and low-vision travelers to explore and interact with street-level imagery. Users can navigate on foot, inspect their surroundings with detailed visual scene descriptions, detect upcoming intersections and points of interest, and ask natural language questions about the current scene using multimodal AI.

## Research Paper & Citation

StreetReaderAI is based on the research presented at ACM UIST 2025:

> Jon E. Froehlich, Alexander J. Fiannaca, Nimer M. Jaber, Victor Tsaran, and Shaun K. Kane. 2025. **StreetReaderAI: Making Street View Accessible Using Context-Aware Multimodal AI**. In *Proceedings of the 38th Annual ACM Symposium on User Interface Software and Technology (UIST ’25)*. Association for Computing Machinery, New York, NY, USA, 1–22. https://doi.org/10.1145/3746059.3747756

While the original research prototype in the paper was built on Google Street View and internal APIs (used with permission), this open-source release uses open APIs:
* **Road Network**: OpenStreetMap (OSM) via the public Overpass API (or local extracts).
* **Street Imagery**: [Mapillary](https://www.mapillary.com/) Graph API v4 for panoramic 360° street-level imagery.
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
* **`MAPILLARY_CLIENT_TOKEN`**: You can get a free token from the [Mapillary Developer Portal](https://www.mapillary.com/dashboard/developers).
* **`LOCATION_SERVICE`**: Defaults to `"osm"` (OpenStreetMap / Nominatim, requiring no API key). You can switch to `"google"` by supplying a `GOOGLE_MAPS_API_KEY`.
* **`SERVER_CACHE_MAX_MB`**: Total disk budget for server SQLite LRU caches in megabytes (defaults to `"200"`).
* **`SERVER_CACHE_DB_PATH`**: (Optional) Custom path for the cache SQLite database file (defaults to `server/.cache/streetreaderai.db`).

### 4. Server Disk-Backed Caching Architecture

StreetReaderAI includes a bounded, thread-safe, disk-backed caching system powered by SQLite (`server/.cache/streetreaderai.db`). It keeps navigation, imagery, and AI scene inspection responsive across server restarts while strictly bounding disk usage:

* **Persistence Across Restarts**: Cache data survives server reboots and process reloads, eliminating cold-start re-fetching for previously visited neighborhoods.
* **Transparent Operation**: Operates entirely within the backend service layer with zero changes to REST API contracts or query parameters.
* **High Performance**: Uses SQLite WAL mode with a 32MB in-memory page cache for sub-millisecond lookups.
* **Bounded LRU Eviction**: Total cache size is capped at `SERVER_CACHE_MAX_MB` (default: 200 MB). When the budget is reached, least-recently-used records are automatically pruned.
* **Four Dedicated Tiers**:
  1. **Panorama Imagery**: Stores decoded/raw JPEG thumbnail buffers downloaded from Mapillary. Heading rotations and viewport crops are served directly from disk/cache with zero redundant image downloads.
  2. **Mapillary Window Slices**: Caches road way coordinate window slices (~12,000 queries) to accelerate adjacent node lookup during street traversal.
  3. **Overpass Road Geometry**: Caches highway vector features with **spatial containment lookup**: when moving within known bounding boxes, road networks are reused instantly without issuing new network requests to Overpass.
  4. **Multimodal AI Scene Descriptions**: Content-addressed cache keyed by SHA-256 hashes of the cropped viewport image base64 bytes (~1,000 descriptions). Looking in a previously observed direction returns cached descriptions immediately.

### 5. Build & Start

Build the Angular frontend and start the backend server:

```bash
# Build the client and launch the server on port 5001
make start
```

Open your browser and navigate to **<http://localhost:5001>**. The Flask backend serves both the REST API and the Angular single-page application.

### 6. Running Tests

```bash
# Run fast offline unit tests (93 tests)
make test

# Run full integration and Playwright browser tests
make test-all
```
For detailed information on the test tiers, see [tests/README-tests.md](tests/README-tests.md).

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