# StreetReaderAI

StreetReaderAI is an AI-powered accessibility tool designed for blind and low-vision travelers to explore and interact with street-level imagery. Users can navigate on foot, inspect their surroundings with detailed visual scene descriptions, detect upcoming intersections and points of interest, and ask natural language questions about the current scene using multimodal AI.

## Research Paper & Citation

StreetReaderAI is based on the research presented at ACM UIST 2025:

> Jon E. Froehlich, Alexander J. Fiannaca, Nimer M. Jaber, Victor Tsaran, and Shaun K. Kane. 2025. **StreetReaderAI: Making Street View Accessible Using Context-Aware Multimodal AI**. In *Proceedings of the 38th Annual ACM Symposium on User Interface Software and Technology (UIST ’25)*. Association for Computing Machinery, New York, NY, USA, 1–22. https://doi.org/10.1145/3746059.3747756

While the original research prototype in the paper was built on Google Street View and internal APIs (used with permission), this open-source release runs as a **100% client-side Angular Single-Page Application (SPA)** using open and browser-accessible APIs:
* **Road Network & POIs**: OpenStreetMap (OSM) via the official `/api/0.6/map.json` endpoint and public Overpass API mirrors.
* **Street Imagery**: [Panoramax](https://panoramax.fr/) STAC API (no API key required) or [Mapillary](https://www.mapillary.com/) Graph API v4 for panoramic 360° street-level imagery, projected in-browser via HTML5 `<canvas>`.
* **Geocoding & Places**: OpenStreetMap Nominatim & Overpass (with optional Google Maps Platform support).
* **Multimodal AI**: Google Gemini (`gemini-3.8-flash`) or OpenAI (`gpt-5.6-terra`).

*(Note: The earlier Python Flask backend + Angular client version is preserved on the [`client-server`](https://github.com/research-ground/streetreaderAI/tree/client-server) branch.)*

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

---

## Quick Start

### 1. Prerequisites
* **Node.js** (v18+) and **npm**
* An API key for [Google Gemini](https://aistudio.google.com/app/apikey) or [OpenAI](https://platform.openai.com/)

### 2. Install & Run

```bash
# Install frontend dependencies
make setup

# Launch the Angular development server on http://localhost:4200
make start
```

Open **<http://localhost:4200>** in your browser.

### 3. First-Run Setup & Configuration

On first launch (or whenever no active AI API key is configured), StreetReaderAI presents the **Welcome & Setup** dialog where you select your initial preferences:

1. **AI Scene Description (Required)**:
   * Because visual scene description is core to StreetReaderAI, you must configure an AI vision API key before entering the app (unless a key is already provided by a host environment or key-sharing proxy).
   * Choose **Google Gemini** (`gemini-3.8-flash`) or **OpenAI** (`gpt-5.6-terra`) and enter your API key.
2. **Accessibility & Controls**:
   * **Self-voicing speech output**: Read descriptions, street announcements, and chat answers aloud using browser TTS (turn off if using an external screen reader).
   * **Automatically generate scene descriptions**: Describe each new panorama automatically upon arrival.
   * **Allow movement commands in chat**: Let natural-language commands (e.g., *"turn left"*, *"go forward"*) move or rotate the view.
   * **Global Hotkey Modifier**: Choose `Alt` (default), `Alt + Shift` (recommended for screen readers), `Ctrl`, `Ctrl + Shift`, `Command`, or `Command + Shift`.
   * **Direction format**: Choose cardinal directions, degrees, or both.
3. **Street Imagery & Location Data Sources**:
   * **Street Imagery Provider**:
     * **Panoramax** (default) — Open, federated 360° street-level imagery requiring **zero API keys**.
     * **Mapillary** — Requires a free Client Token from the [Mapillary Developer Portal](https://www.mapillary.com/dashboard/developers).
   * **Location & Geocoding Provider**:
     * **OpenStreetMap** (default) — Uses Nominatim and the cached OSM v0.6 road tile with **zero API keys**.
     * **Google Maps Platform** — Uses Google Geocoding and Places APIs (requires a Google Maps API Key).

You can update any of these options later via the **Settings** button or by pressing `Shift + /` (`?` for hotkeys).

### 4. Running in Google AI Studio (100% Free-Tier Configuration)

StreetReaderAI is compatible with **Google AI Studio** and can run end-to-end on a **100% free plan** with zero paid APIs or credit card required:

#### Free-Tier Configuration Matrix
| Capability | Provider to Select | Cost / Key Requirement |
| :--- | :--- | :--- |
| **1. Street Imagery** | **Panoramax** (Default) | **Free** — Open federated 360° imagery; no API key required |
| **2. Road Network & Routing** | **OpenStreetMap v0.6 API** (Default) | **Free** — Public OSM road & intersection data; no API key required |
| **3. Geocoding & Nearby POIs** | **OpenStreetMap (Nominatim & Tile POIs)** (Default) | **Free** — Uses Nominatim & cached OSM road tiles; no API key required |
| **4. Vision-Language Model (VLM)** | **Google Gemini (`gemini-3.8-flash`)** (Default) | **Free Tier** — Provided automatically by AI Studio (`GEMINI_API_KEY` / `API_KEY`) or via a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

#### How to Import / Deploy in Google AI Studio
1. Open [Google AI Studio](https://aistudio.google.com/) and go to **Build** (or **Apps** $\rightarrow$ **Create new app**).
2. Import the **`client/`** folder from this repository (which contains `package.json`, `angular.json`, `metadata.json`, and `src/`):
   * **Option A (Upload Folder / Zip)**: Upload the contents of the `client/` directory into a new AI Studio app.
   * **Option B (GitHub Import)**: Connect your GitHub repository in AI Studio and point the app root to `client/`.
3. **Automatic Key Injection**:
   * When running inside the AI Studio preview environment, StreetReaderAI automatically detects the injected `process.env.GEMINI_API_KEY` (or `process.env.API_KEY`), pre-configures Google Gemini (`gemini-3.8-flash`), and uses an in-memory fallback (`safeStorage`) when running inside AI Studio's sandboxed iframe.
   * Keep **Street Imagery Provider** set to **Panoramax** and **Location & Geocoding Provider** set to **OpenStreetMap** in the First-Run dialog so that no Mapillary or Google Maps billing keys are needed.
4. **Sharing / Deploying from AI Studio**:
   * Click **Share** in AI Studio to share the applet link with other users (each viewer uses their own free AI Studio Gemini quota), or click **Deploy to Cloud Run** in the top-right corner of AI Studio for a standalone hosted URL.

### 5. Building & Running Tests

```bash
# Run unit tests (Vitest + Angular TestBed)
make test

# Build static production bundle into client/dist/StreetReaderAI/browser
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
