# StreetReaderAI

StreetReaderAI is an AI-powered accessibility tool designed for blind and low-vision travelers to explore and interact with street-level imagery. Users can navigate on foot, inspect their surroundings with detailed visual scene descriptions, detect upcoming intersections and points of interest, and ask natural language questions about the current scene using multimodal AI.

> **Research Prototype & Feedback**: StreetReaderAI is an experimental research prototype and will likely have bugs. Please [file bugs on GitHub](https://github.com/research-ground/streetreaderAI/issues) or send feedback and questions to [streetreaderai-team@google.com](mailto:streetreaderai-team@google.com).

![Screenshot of the StreetReaderAI main interface showing a street-level view of North 34th Street in Seattle flanked by brick and modern mixed-use buildings and street trees. Floating panels on the left display Navigation (with an Address Search input and numbered preset buttons 1 through 4 for Seattle, Paris, Amsterdam, and Brussels), Scene Description (reading "This is a straight urban street flanked by multi-story mixed-use buildings on both sides..."), and Movement Keys (arrow keys to move forward, turn around 180 degrees, or turn left and right 45 degrees). Floating panels on the right display Points of Interest (Parkside Dental behind left, ZoomCare behind right, and PCC Dog on Bike front right), Chat & AI Controls (with a question input, microphone button, and numbered preset questions 5 through 8), and a bottom-right radar mini-map showing the local street graph and current heading cone. A bottom status bar announces the current address, Ahead: North 34th Street, Speech Off, and Heading: West 283 degrees.](docs/screenshot.png)

## Research Paper & Citation

StreetReaderAI is based on the research presented at ACM UIST 2025:

> Jon E. Froehlich, Alexander J. Fiannaca, Nimer M. Jaber, Victor Tsaran, and Shaun K. Kane. 2025. **StreetReaderAI: Making Street View Accessible Using Context-Aware Multimodal AI**. In *Proceedings of the 38th Annual ACM Symposium on User Interface Software and Technology (UIST ’25)*. Association for Computing Machinery, New York, NY, USA, 1–22. https://doi.org/10.1145/3746059.3747756

While the original research prototype in the paper was built on Google Street View and internal APIs (used with permission), this open-source release runs as a **100% client-side Angular Single-Page Application (SPA)** using open and browser-accessible APIs:
* **Road Network & POIs**: OpenStreetMap (OSM) via the official `/api/0.6/map.json` endpoint and public Overpass API mirrors.
* **Street Imagery**: [Panoramax](https://panoramax.fr/) STAC API (no API key required) or [Mapillary](https://www.mapillary.com/) Graph API v4 for panoramic 360° street-level imagery, projected in-browser via HTML5 `<canvas>`.
* **Geocoding & Places**: OpenStreetMap Nominatim & Overpass (with optional Google Maps Platform support).
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

---

## System Architecture

**Diagram Description**: The StreetReaderAI browser Angular Single-Page Application (SPA) sits at the center of four external data and AI services configured in `streetreaderai.conf`:
1. **Street Imagery (top)** flows into StreetReaderAI: Panoramax STAC API (default, open) or Mapillary Graph API v4 (token) provide 360° equirectangular images and sequence metadata (or directional single-image views).
2. **Route & Road Network (left)** flows into StreetReaderAI: OpenStreetMap v0.6 `map.json` (with Overpass API mirror fallback) provides intersections and street block geometry.
3. **Geocoding & Nearby POIs (bottom)** exchanges address lookup, autocomplete, and POI queries with StreetReaderAI: OpenStreetMap Nominatim and cached OSM tile POIs (default) or Google Geocoding and Places API v1.
4. **Vision-Language Model (right)** exchanges scene descriptions and visual Q&A with StreetReaderAI: Google Gemini (`gemini-3.8-flash`) or OpenAI (`gpt-5.6-terra`).

<figure role="img" aria-label="System architecture diagram showing the StreetReaderAI Browser Angular SPA connected to four external services: 1. Street Imagery (Panoramax STAC API or Mapillary Graph API v4) sending 360-degree equirectangular images and sequence metadata; 2. Route and Road Network (OpenStreetMap v0.6 map.json and Overpass fallback) sending intersections and street blocks; 3. Geocoding and Nearby POIs (OpenStreetMap Nominatim and Cached OSM Tile POIs, or Google Geocoding and Places API v1) handling address lookup, autocomplete, and POIs; and 4. Vision-Language Model (Google Gemini gemini-3.8-flash or OpenAI gpt-5.6-terra) handling scene descriptions and Q&A.">

```text
                                 +----------------------------------------+
                                 |   1. Street Imagery (360° Panoramas)   |
                                 |   - Panoramax STAC API (Default, Open) |
                                 |   - Mapillary Graph API v4 (Token)     |
                                 +-------------------+--------------------+
                                                     |
                                                     | 360° Equirectangular Images
                                                     | & Sequence Metadata
                                                     v
+----------------------------------+     +-----------+------------+     +------------------------------------+
| 2. Route & Road Network          |     |                        |     | 4. Vision-Language Model (VLM)     |
| - OpenStreetMap v0.6 map.json    |---->|    StreetReaderAI      |<--->| - Google Gemini (gemini-3.8-flash) |
| - Overpass API Mirrors (Fallback)|     |  (Browser Angular SPA) |     | - OpenAI (gpt-5.6-terra)           |
|   (Intersections & Street Blocks)|     |                        |     |   (Scene Descriptions & Q&A)       |
+----------------------------------+     +-----------+------------+     +------------------------------------+
                                                     ^
                                                     | Address Lookup,
                                                     | Autocomplete & POIs
                                                     v
                                 +-------------------+--------------------+
                                 |   3. Geocoding & Nearby POIs           |
                                 |   - OpenStreetMap Nominatim &          |
                                 |     Cached OSM Tile POIs (Default)     |
                                 |   - Google Geocoding & Places API v1   |
                                 +----------------------------------------+
```

</figure>

---

## Quick Start

### 1. Prerequisites
* **Node.js** (v18+) and **npm**
* An API key for [Google Gemini](https://aistudio.google.com/app/apikey) or [OpenAI](https://platform.openai.com/)

### 2. Install, Configure & Run

```bash
# Install frontend dependencies and create streetreaderai.conf from streetreaderai.conf.example
make setup
```

Open [`streetreaderai.conf`](streetreaderai.conf.example) in any text editor and add your AI API key under `[keys]` (plus any optional keys if you switch imagery or location providers under `[system]`):

```ini
[system]
imagery_provider = panoramax
location_provider = osm
ai_provider = gemini
starting_address = 601 N 34th St, Seattle, WA
max_poi_items = 20

[keys]
gemini_api_key = YOUR_GEMINI_API_KEY
openai_api_key =
mapillary_access_token =
google_maps_api_key =
```

> **Note**: `streetreaderai.conf` is listed in `.gitignore` so your API keys are never committed to version control. If a required key for the active providers in `[system]` is missing on launch, StreetReaderAI immediately displays a **Configuration Error** dialog identifying which key to add in `streetreaderai.conf`.

Then start the development server:

```bash
# Launch the Angular development server on http://localhost:4200
make start
```

Open **<http://localhost:4200>** in your browser.

### 3. Declarative Provider Plugins (`streetreaderai.conf`)

All backend services (Street Imagery, Location/Geocoding, and AI Vision) are configured declaratively in `streetreaderai.conf` using URL templates and JSON dot-path field mappings—no code changes are required to switch or add providers:

* **`[imagery.<name>]`**:
  * `retrieval_type = sequence | image`:
    * `sequence`: Queries a bounding box (`bbox_url`) and expands multi-image camera trajectories (`sequence_url`) along street blocks (e.g., **Panoramax**, **Mapillary**).
    * `image`: Queries single-point metadata (`point_url`) at intersections and samples points along candidate blocks so the 5-step sequence routing solver validates street connectivity identically to sequence-based providers.
  * `image_format = 360 | single`:
    * `360`: Fetches a full 360° equirectangular panorama (`field_image_url`) and projects rectilinear viewports in-browser via HTML5 `<canvas>` (`PanoramaCropService`).
    * `single`: Fetches a directional rectilinear image (`image_url`) for the requested `heading` and `pitch`.
* **`[location.<name>]`**: Configures forward geocoding (`geocode_url`), reverse geocoding (`reverse_url`), address autocomplete (`autocomplete_url`), and nearby POI mode (`poi_mode = osm_tile | google_places`).
* **`[ai.<name>]`**: Configures the multimodal vision endpoint (`api_Style = gemini | openai_compatible`, `model`, and `endpoint_url`).

### 4. Accessibility & Controls (Welcome & Settings Dialogs)

On first launch, StreetReaderAI presents the **Welcome** dialog where you can customize your accessibility and interaction preferences (also accessible anytime via the **Settings** button or `Alt + S`):

* **Self-voicing speech output**: Read descriptions, street announcements, and chat answers aloud using browser TTS (turn off if using an external screen reader).
* **Automatically generate scene descriptions**: Describe each new view automatically upon arrival.
* **Allow movement commands in chat**: Let natural-language commands (e.g., *"turn left"*, *"go forward"*) move or rotate the view.
* **Global Hotkey Modifier**: Choose `Alt` (default), `Alt + Shift` (recommended for screen readers), `Ctrl`, `Ctrl + Shift`, `Command`, or `Command + Shift`.
* **Direction format**: Choose cardinal directions, degrees, or both.

### 5. Running in Google AI Studio (100% Free-Tier Configuration)

StreetReaderAI is compatible with **Google AI Studio** and can run end-to-end on a **100% free plan** with zero paid APIs or credit card required:

#### Free-Tier Configuration Matrix
| Capability | Default Provider in `streetreaderai.conf.example` | Cost / Key Requirement |
| :--- | :--- | :--- |
| **1. Street Imagery** | **`panoramax`** (`retrieval_type = sequence`, `image_format = 360`) | **Free** — Open federated 360° imagery; no API key required |
| **2. Road Network & Routing** | **OpenStreetMap v0.6 API** | **Free** — Public OSM road & intersection data; no API key required |
| **3. Geocoding & Nearby POIs** | **`osm`** (Nominatim & Cached OSM Tile POIs) | **Free** — Uses Nominatim & cached OSM road tiles; no API key required |
| **4. Vision-Language Model (VLM)** | **`gemini`** (`gemini-3.8-flash`) | **Free Tier** — Provided automatically by AI Studio (`GEMINI_API_KEY` / `API_KEY`) or via a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

#### How to Import / Deploy in Google AI Studio
1. Generate a clean zip archive of the repository's tracked files (excluding `node_modules/`, `.git/`, and your private `streetreaderai.conf`):
   ```bash
   make make-for-aistudio
   ```
   This produces `streetreaderai-aistudio.zip` in the repository root.
2. Open [Google AI Studio](https://aistudio.google.com/) (**Build**) and start a blank project by typing `"blank project"` in the prompt.
3. When the project opens, **stop the agent** immediately (it will begin generating template files even though you requested a blank project).
4. Add/attach `streetreaderai-aistudio.zip` to the chat prompt and prompt the agent: `"import files"`.
5. **Automatic Configuration & Key Injection**:
   * When `streetreaderai.conf` is not present, StreetReaderAI automatically loads `streetreaderai.conf.example` (which defaults to `panoramax`, `osm`, and `gemini`) and detects AI Studio's injected `process.env.GEMINI_API_KEY` (or `process.env.API_KEY`).
   * Anyone who spawns a copy of the project in AI Studio can also edit `streetreaderai.conf.example` directly in the AI Studio code editor to customize providers, URLs, or keys.
6. **Sharing / Deploying from AI Studio**:
   * Click **Share** in AI Studio to share the applet link with other users (each viewer uses their own free AI Studio Gemini quota), or click **Deploy to Cloud Run** in the top-right corner of AI Studio for a standalone hosted URL.

### 6. Building & Running Tests

```bash
# Run unit tests (Vitest + Angular TestBed)
make test

# Build static production bundle into dist/StreetReaderAI/browser
make build
```

---

## Documentation
* **[Service & API Reference](docs/api_reference.md)**: Authoritative reference for `ApiService` data models and service interfaces.
* **[Routing & Imagery Architecture](docs/routing_architecture.md)**: Deep dive into the 5-step intersection + sequence-slice routing algorithm, HTML5 `<canvas>` equirectangular projection, and OSM rate-limit safeguards.

---

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
