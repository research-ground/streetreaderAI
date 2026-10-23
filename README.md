# StreetReaderAI

**StreetReaderAI** is an AI-powered accessibility web application that enables blind and low-vision travelers to explore real-world streets virtually. Combining street-level panoramic imagery, OpenStreetMap road-network routing, nearby points of interest, and multimodal AI, StreetReaderAI lets users:

* **Walk through neighborhoods step by step** along real street blocks and across intersections using keyboard shortcuts or voice commands.
* **Hear concise, accessibility-focused scene descriptions** (2–3 sentences describing street layout, sidewalks, buildings, and permanent landmarks rather than passing cars or weather).
* **Understand spatial orientation** with intersection street announcements (*"Ahead: North 34th Street; Left and Right: Fremont Avenue North"*) and nearby points of interest labeled by observer-relative position (*`FRONT LEFT`*, *`BEHIND RIGHT`*).
* **Ask natural-language visual questions** about the current view (e.g., *"Is there a marked crosswalk or curb ramp ahead?"*, *"What storefronts are visible?"*) and optionally control movement through chat (*"turn left"*, *"move forward"*).

> **Research Prototype & Feedback**: StreetReaderAI is an experimental research prototype and will likely have bugs. Please [file bugs on GitHub](https://github.com/research-ground/streetreaderAI/issues) or send feedback and questions to [streetreaderai-team@google.com](mailto:streetreaderai-team@google.com).

![Screenshot of the StreetReaderAI main interface showing a street-level view of North 34th Street in Seattle flanked by brick and modern mixed-use buildings and street trees. Floating panels on the left display Navigation (with an Address Search input and numbered preset buttons 1 through 4 for Seattle, Paris, Amsterdam, and Brussels), Scene Description (reading "This is a straight urban street flanked by multi-story mixed-use buildings on both sides..."), and Movement Keys (arrow keys to move forward, turn around 180 degrees, or turn left and right 45 degrees). Floating panels on the right display Points of Interest (Parkside Dental behind left, ZoomCare behind right, and PCC Dog on Bike front right), Chat & AI Controls (with a question input, microphone button, and numbered preset questions 5 through 8), and a bottom-right radar mini-map showing the local street graph and current heading cone. A bottom status bar announces the current address, Ahead: North 34th Street, Speech Off, and Heading: West 283 degrees.](docs/screenshot.png)

---

## Running StreetReaderAI

### Option 1: Run in Google AI Studio (Zero-Setup, 100% Free Tier)

Because the repository is public and uses open defaults (**Panoramax** for 360° street imagery and **OpenStreetMap** for road routing, geocoding, and POIs), you can run StreetReaderAI directly in **Google AI Studio** with zero paid APIs or credit card required:

1. Open **[Google AI Studio](https://aistudio.google.com/)** (**Build**) and import this public GitHub repository (`https://github.com/research-ground/streetreaderAI`), or generate a clean archive locally with `make make-for-aistudio` and import `streetreaderai-aistudio.zip`.
2. **Automatic Setup**: StreetReaderAI uses its built-in defaults (**Panoramax** + **OpenStreetMap**) and automatically detects AI Studio's injected `GEMINI_API_KEY` (`gemini-3.8-flash`)—no configuration file is required.
3. **Sharing or Deploying**: Click **Share** in AI Studio to share your applet link with others, or click **Deploy to Cloud Run** in the top-right corner of AI Studio for a standalone hosted URL.

### Option 2: Run Locally

#### Prerequisites
* **Node.js** (v18+) and **npm**
* An API key for [Google Gemini](https://aistudio.google.com/app/apikey) (or [OpenAI](https://platform.openai.com/))

#### Install, Configure & Launch
```bash
# 1. Install frontend dependencies and create streetreaderai.conf from streetreaderai.conf.example
make setup
```

Open `streetreaderai.conf` in any text editor and add your AI API key under `[keys]`:

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

> **Note**: StreetReaderAI loads its default configuration from [`streetreaderai.conf.example`](streetreaderai.conf.example) and overlays any settings or API keys you define in `streetreaderai.conf`. `streetreaderai.conf` is git-ignored so your personal API keys are never committed (always edit `streetreaderai.conf` rather than `streetreaderai.conf.example`). If a required key for the active providers in `[system]` is missing on launch, StreetReaderAI displays a **Configuration Error** dialog identifying which key to add. See **[Configuring Data & AI Providers](docs/configuration.md)** for full details on switching or adding providers.

Start the development server:

```bash
# 2. Launch the Angular development server on http://localhost:4200
make start
```

Open **<http://localhost:4200>** in your browser.

---

## Getting Started: How to Use StreetReaderAI

### 1. First-Run Accessibility Preferences
When StreetReaderAI opens for the first time, the **Welcome** dialog lets you configure how the interface communicates with you (you can adjust these anytime via the **Settings** button in the top bar):
* **Self-voicing speech output**: Speaks scene descriptions, street/heading announcements, and AI answers aloud using browser text-to-speech. Turn this **off** if you are already using an external screen reader (such as NVDA, JAWS, or VoiceOver).
* **Automatically generate scene descriptions**: Automatically generates a 2–3 sentence visual description whenever you arrive at a new location or turn.
* **Allow movement commands in chat**: Lets natural-language commands in chat (e.g., *"turn left"*, *"go forward"*) rotate or move your position.
* **Global Hotkey Modifier (`Mod`)**: Choose `Alt` (default), `Alt + Shift` (recommended alongside screen readers), `Ctrl`, `Ctrl + Shift`, `Command`, or `Command + Shift`.
* **Direction Format**: Choose cardinal directions (*North-West*), degrees (*315°*), or both.

### 2. Jumping to a Location
* **Address Search**: Press `Mod + L` (or select the **Address Search** box in the top-left **Navigation** panel), type an address or landmark, and press `Enter`.
* **Preset Locations**: Press number keys `1` through `4` (when not typing in a text box) or click one of the four preset location buttons in the **Navigation** panel to jump immediately to curated streets in Seattle, Paris, Amsterdam, or Brussels.

### 3. Walking & Turning Along the Street
* **Move Forward**: Press `↑` (Up Arrow) or `Mod + ↑` to step forward (~18 meters) along the current street block toward the next intersection.
* **Turn Around (180°)**: Press `↓` (Down Arrow) or `Mod + ↓` to face the opposite direction.
* **Turn Left / Right (45°)**: Press `←` (Left Arrow) or `→` (Right Arrow) (or `Mod + ←` / `Mod + →`) to rotate your view in 45° increments. At intersections, rotating aligns you with cross streets so pressing `↑` walks down the newly faced street.
* **Where Am I?**: Press `Mod + I` at any time to hear your current street address, compass heading, and which streets lie ahead or to your left and right.

### 4. Scene Descriptions & Nearby Points of Interest
* **Scene Description Panel**: Displays the AI-generated description of the current view. Press `Mod + A` to toggle automatic descriptions on or off.
* **Points of Interest (POI) Panel**: Lists nearby businesses, clinics, and landmarks along with their street name and position relative to your current heading (e.g., *`FRONT LEFT`*, *`FRONT RIGHT`*, *`BEHIND LEFT`*).

### 5. Asking Visual Questions & Voice Input
* **Ask a Question**: Press `Mod + K` to focus the **Chat & AI Controls** input box, type any question about what is visible in the scene, and press `Enter`.
* **Voice Input**: Press `Mod + B` (or click the microphone button) to speak your question or navigation command.
* **Preset Questions**: Press number keys `5` through `8` (when not typing in a text box) to ask one of the four suggested questions for the current location.

### 6. Screen Curtain & Keyboard Shortcut Help
* **Screen Curtain**: Press `Mod + T` to black out the visual interface so sighted researchers or developers can experience the non-visual interaction flow.
* **Help & Shortcuts Dialog**: Press `?` (`Shift + /`) to open the complete list of keyboard shortcuts, usage tips, and data attributions, or press `Escape` to stop speech and close open dialogs.

---

## System Architecture

StreetReaderAI is architected as a **100% client-side Angular Single-Page Application (SPA)** with no custom backend server required:

* **Angular Web Application (`src/`)**: Runs entirely in the user's browser. During development it is served by `ng serve` (`make start`), and in production `make build` compiles a static bundle (`dist/StreetReaderAI/browser`) that can run in Google AI Studio or be hosted on any static web server (Nginx, Apache, GitHub Pages, Cloud Run, etc.).
* **Declarative Configuration (`streetreaderai.conf`)**: Rather than hardcoding provider logic, [`ConfigService`](src/app/services/config_service.ts) loads `streetreaderai.conf` on startup to configure four external service categories via URL templates and JSON dot-path field mappings:
  1. **Road Network & Routing ([`RoadDataService`](src/app/services/road_data_service.ts) & [`RouteProviderService`](src/app/services/route_provider_service.ts))**: Fetches local walkable/drivable street geometry from the OpenStreetMap v0.6 API (`/api/0.6/map.json`, with Overpass API fallback), merges multi-node junctions into unified intersections (`osm_<id>`), and connects adjacent intersections using validated camera sequences (`seq_<imageId>`).
  2. **Street-Level Imagery ([`ImageryProviderService`](src/app/services/imagery_provider_service.ts) & [`PanoramaCropService`](src/app/services/panorama_crop_service.ts))**: Supports both sequence-based 360° equirectangular providers (`retrieval_type = sequence`, `image_format = 360`, such as **Panoramax** and **Mapillary**, cropped into rectilinear viewports in-browser via HTML5 `<canvas>`) and point-sampled directional providers (`retrieval_type = image`, `image_format = single`).
  3. **Geocoding & Points of Interest ([`LocationProviderService`](src/app/services/location_provider_service.ts))**: Handles forward/reverse geocoding, debounced address autocomplete, and observer-relative POI discovery using **OpenStreetMap** (Nominatim + zero-extra-call extraction from cached OSM road tiles) or **Google Maps Platform** (Geocoding + Places API v1).
  4. **Multimodal Vision-Language Model ([`AiProviderService`](src/app/services/ai_provider_service.ts))**: Sends the current viewport image to **Google Gemini** (`gemini-3.8-flash`) or **OpenAI** (`gpt-5.6-terra`) to generate blind-traveler-oriented scene descriptions and structured visual Q&A responses with optional navigation action detection.
* **In-Browser Caching ([`client_cache.ts`](src/app/services/client_cache.ts))**: Multi-layer in-memory LRU caches (`roadCache`, `osmPoiTileCache`, `windowCache`, `metadataCache`, `graphCache`, and `PanoramaCropService`'s decoded pixel buffer cache) plus `singleflight` request deduplication ensure that exploring a neighborhood or rotating in place minimizes external API calls.

---

## Testing & Building

```bash
# Run the offline unit test suite (Vitest + Angular TestBed)
make test

# Build the static production bundle into dist/StreetReaderAI/browser
make build
```

### Overview of the Test Suite (`make test`)
All tests run offline in Vitest + Angular `TestBed` without requiring live API keys or network access:
* **Routing & 5-Step Graph Solver ([`src/app/services/route_provider_service_test.ts`](src/app/services/route_provider_service_test.ts))**: Tests street name normalization, OSM intersection clustering, sequence slicing across street blocks (`retrieval_type = sequence`), point-sampled block solving (`retrieval_type = image`), street-hint seed selection, zero-network-call POI extraction from cached OSM road tiles, and single-tile reuse across movements.
* **Declarative Provider Plugins ([`src/app/services/provider_plugins_test.ts`](src/app/services/provider_plugins_test.ts))**: Verifies that `ImageryProviderService`, `LocationProviderService`, and `AiProviderService` execute custom `.conf` plugins across `sequence`/`360`, `image`/`single`, custom geocoding/autocomplete dot-paths, and `gemini`/`openai` wire formats.
* **Configuration & Key Validation ([`src/app/services/config_service_test.ts`](src/app/services/config_service_test.ts))**: Tests `streetreaderai.conf` INI parsing, default provider setup, AI Studio host environment key injection, and missing-key error reporting (`validateRequiredKeys()`).
* **Demo Mode & Preset Shortcuts ([`src/app/demo_mode/demo_mode_test.ts`](src/app/demo_mode/demo_mode_test.ts))**: Verifies hotkeys `1`–`4` (preset locations) and `5`–`8` (preset visual questions), fallback to generic questions on custom address search, and preset button rendering.
* **UI Component Tests (`src/app/components/**/*_test.ts`, [`src/app/app_test.ts`](src/app/app_test.ts))**: Component creation and behavior tests for `App`, `NavigationComponent`, `PoiListComponent` (including `maxPoiItems` filtering), `SceneDescriptionComponent`, and `AdjacentLinksComponent`.

---

## Documentation
* **[Configuring Data & AI Providers (`streetreaderai.conf`)](docs/configuration.md)**: Reference for `[system]`, `[keys]`, and declarative `[imagery.*]`, `[location.*]`, and `[ai.*]` plugin definitions.
* **[Service & API Reference](docs/api_reference.md)**: Authoritative reference for `ApiService` data models and TypeScript interfaces.
* **[Routing & Imagery Architecture](docs/routing_architecture.md)**: Deep dive into the 5-step intersection + sequence-slice routing algorithm, HTML5 `<canvas>` equirectangular projection, and OpenStreetMap rate-limit safeguards.

---

## Research Paper & Citation

StreetReaderAI is based on research presented at ACM UIST 2025:

> Jon E. Froehlich, Alexander J. Fiannaca, Nimer M. Jaber, Victor Tsaran, and Shaun K. Kane. 2025. **StreetReaderAI: Making Street View Accessible Using Context-Aware Multimodal AI**. In *Proceedings of the 38th Annual ACM Symposium on User Interface Software and Technology (UIST ’25)*. Association for Computing Machinery, New York, NY, USA, 1–22. https://doi.org/10.1145/3746059.3747756

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

---

## Data Sources & Attribution

* **Road Network & Map Data**: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
* **Street-Level Imagery (Panoramax)**: © [Panoramax](https://panoramax.xyz/) contributors (IGN / OpenStreetMap France community instances), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) / [Etalab Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
* **Street-Level Imagery (Mapillary)**: © [Mapillary](https://www.mapillary.com/) contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
* **Geocoding & Places**: Powered by [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) (© OpenStreetMap contributors) and [Google Maps Platform](https://developers.google.com/maps) (© Google).
* **AI Scene Descriptions & Q&A**: Powered by [Google Gemini](https://ai.google.dev/) (© Google) and [OpenAI](https://openai.com/).

---

## Credits

The original research prototype was developed by [Jon Froehlich](https://jonfroehlich.github.io/), [Alex Fiannaca](https://www.linkedin.com/in/alfianna), [Victor Tsaran](https://www.linkedin.com/in/victortsaran), [Nimer Jaber](https://www.linkedin.com/in/nimer-jaber-68b96ba5), and [Shaun Kane](https://shaunkane.com).

This open source version was created by [Shaun Kane](https://shaunkane.com), [Sam Sepah](https://www.linkedin.com/in/samsepah), [Bill Neubauer](https://www.linkedin.com/in/william-neubauer), and [Philip Nelson](https://research.google/people/philip-nelson/).

## Disclaimers
Eligibility for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security) is determined by the [Google Open Source Software Vulnerability Reward Program Rules](https://bughunters.google.com/about/rules/open-source/google-open-source-software-vulnerability-reward-program-rules).

This project is intended for demonstration purposes only. It is not intended for use in a production environment.
