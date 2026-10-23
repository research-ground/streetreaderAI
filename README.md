# StreetReaderAI

StreetReaderAI is an AI-powered accessibility tool designed for blind and low-vision travelers to explore and interact with street-level imagery. Users can navigate on foot, inspect their surroundings with detailed visual scene descriptions, detect upcoming intersections and points of interest, and ask natural language questions about the current scene using multimodal AI.

## Research Paper & Citation

StreetReaderAI is based on the research presented at ACM UIST 2025:

> Jon E. Froehlich, Alexander J. Fiannaca, Nimer M. Jaber, Victor Tsaran, and Shaun K. Kane. 2025. **StreetReaderAI: Making Street View Accessible Using Context-Aware Multimodal AI**. In *Proceedings of the 38th Annual ACM Symposium on User Interface Software and Technology (UIST ’25)*. Association for Computing Machinery, New York, NY, USA, 1–22. https://doi.org/10.1145/3746059.3747756

While the original research prototype in the paper was built on Google Street View and internal APIs (used with permission), this open-source release runs as a **100% client-side Angular Single-Page Application (SPA)** using open and browser-accessible APIs:
* **Road Network**: OpenStreetMap (OSM) via the official `/api/0.6/map.json` endpoint and public Overpass API mirrors.
* **Street Imagery**: [Panoramax](https://panoramax.fr/) STAC API (no API key required) or [Mapillary](https://www.mapillary.com/) Graph API v4 for panoramic 360° street-level imagery, projected in-browser via HTML5 `<canvas>`.
* **Geocoding & POIs**: OpenStreetMap Nominatim & Overpass (with optional Google Maps Platform support).
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

## Quick Start

### 1. Prerequisites
* **Node.js** (v18+) and **npm**
* An API key for [Google Gemini](https://aistudio.google.com/app/apikey) or [OpenAI](https://platform.openai.com/) (configured in the in-app **Settings** dialog)

### 2. Install & Run

```bash
# Install frontend dependencies
make setup

# Launch the Angular development server on http://localhost:4200
make start
```

Open **<http://localhost:4200>** in your browser.

### 3. Configuring Data Sources & API Keys

Click the **Settings** gear icon (or press `Alt+G`) to configure providers and API keys (stored locally in your browser's `localStorage`):
* **Street Imagery Provider**:
  * **Panoramax** (default when no Mapillary token is set) — Open, federated street-level imagery requiring **zero API keys**.
  * **Mapillary** — Requires a free Client Token from the [Mapillary Developer Portal](https://www.mapillary.com/dashboard/developers).
* **Location & Geocoding Provider**:
  * **OpenStreetMap** (default) — Uses Nominatim and Overpass with **zero API keys**.
  * **Google Maps Platform** — Uses Google Geocoding and Places APIs (requires a Google Maps API Key).
* **AI Vision Provider**:
  * **Google Gemini** (`gemini-3.8-flash`) — Requires a Gemini API Key.
  * **OpenAI** (`gpt-5.6-terra`) — Requires an OpenAI API Key.

### 4. Building & Running Tests

```bash
# Run unit tests
make test

# Build static production bundle into client/dist/StreetReaderAI/browser
make build
```

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
