# StreetReaderAI Test Suite

This directory contains the automated test suites for StreetReaderAI, organized into three tiers: **Unit Tests**, **Integration Tests**, and **End-to-End (E2E) Browser Tests**.

---

## Directory Structure

```text
tests/
├── conftest.py              # Pytest fixtures & automatic server lifecycle manager
├── api_client.py            # HTTP client for invoking StreetReaderAI REST endpoints
├── pre_flight_check.py      # Pre-flight environment and API key configuration gate
├── run_all_tests.py         # Master test pipeline runner generating JUnit XML reports
│
├── unit/                    # Fast, offline unit tests (no network calls, fully mocked)
│   ├── test_config.py       # Configuration loading, type validation & fallbacks
│   ├── test_cache.py        # Disk-backed SQLite & in-memory LRU cache policies, spatial lookup & persistence
│   ├── test_utils.py        # Map math (bearing, distance, relative position)
│   ├── test_image_utils.py  # OpenCV rectilinear perspective projection (cv2.remap) & panorama cropping
│   ├── test_roads.py        # OSM road network topology, multi-node intersection clustering & block adjacency
│   ├── test_navigate.py     # 5-step sequence-slice routing solver, intersection unification & link building
│   ├── test_gemini_service.py # Gemini AI structured output, prompt generation & API key overrides
│   ├── test_openai_service.py # OpenAI AI structured output & error handling
│   ├── test_geocoding_services.py # OSM/Nominatim and Google Geocoding parsing & error logic
│   ├── test_overpass_road_service.py # Overpass QL query construction & mirror failover
│   ├── test_mapillary_provider.py # Mapillary metadata parsing, sequence fetching & HTTP 503 error handling
│   ├── test_panoramax_provider.py # Panoramax STAC API metadata, sequence fetching & panorama projection
│   └── test_api_endpoints.py # Isolated Flask test-client request validation & error models
│
├── integration/             # Live backend API tests against localhost:5001
│   ├── test_auth.py         # Basic API connectivity & routing sanity check
│   ├── test_geocoding.py    # Live reverse geocoding, nearby POIs, and autocomplete
│   ├── test_navigation.py   # Live multi-step street walking, intersection turns, sequence caching & Gemini visual inspection
│   └── test_ai.py           # Live AI image description & navigational Q&A (skipped if no key)
│
└── e2e/                     # End-to-end browser tests
    └── test_browser.py      # Playwright browser accessibility, hotkeys, speech & settings
```

---

## Test Tiers

### 1. Unit Tests (`tests/unit/`)
* **Execution**: Run via `uv run pytest tests/unit/ -v` (or `make test`).
* **Properties**: 100% offline, zero network dependencies, runs in ~2.5 seconds.
* **Coverage**: Math and geometry calculations, road graph traversals, image cropping, Pydantic schema validation, and isolated provider unit logic (mocking external API calls).

### 2. Integration Tests (`tests/integration/`)
* **Execution**: Run via `uv run pytest tests/integration/ -v`.
* **Properties**: Tests the Flask REST API endpoints over HTTP on `localhost:5001`.
* **Automatic Server Lifecycle**: If port 5001 is not running, `tests/conftest.py` automatically boots the local Flask server in the background and terminates it when the test run completes.
* **Provider Flexibility**:
  * Geocoding tests exercise whichever provider is active (`LOCATION_SERVICE="osm"` or `"google"`).
  * Navigation tests gracefully handle both live Mapillary tokens and stub mode.
  * AI tests run against the active provider (`AI_MODEL_PROVIDER="gemini"` or `"openai"`) and automatically skip if no valid API key is present in `server/streetreaderai.conf`.

### 3. End-to-End (E2E) Browser Tests (`tests/e2e/`)
* **Execution**: Run via `uv run pytest tests/e2e/ -v`.
* **Properties**: Uses Playwright (Chromium) to test user journeys in the Angular frontend:
  * First-run onboarding dialogs and preset selection.
  * Speech synthesis mocks and verbal announcements.
  * Keyboard navigation hotkeys (`Alt + Arrows`).
  * Settings dialog persistence across reloads and clean-slate resets.
  * Address search autocomplete.
* **Prerequisites**: Install the browser binaries once with `uv run playwright install chromium`.

---

## Running All Tests

To run the master multi-stage test pipeline (pre-flight checks, unit tests, integration tests, and browser tests):

```bash
uv run python tests/run_all_tests.py
# or
make test-all
```

Test reports and JUnit XML logs are output to `dist/tests/`.
