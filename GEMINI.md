# StreetReaderAI Agent Guidelines (GEMINI.md)

Welcome! As an AI development assistant (Gemini, Antigravity, Jetski, etc.) working on the **StreetReaderAI** codebase, you must strictly adhere to the guidelines outlined in this document to maintain repository hygiene, avoid breaking existing configurations, and align with project practices.

---

## 1. Git & Branching Rules

### 🌿 Branch Workflow
1. **Primary Branch**: `main` is the primary development branch for the pure client-side Angular SPA.

---

## 2. Environment & Runtime Expectations

### 🖥️ Development Server
* StreetReaderAI runs as a 100% client-side Angular SPA at the repository root on port 4200 (`make start` / `npm start`).
* If the dev server is not running when executing browser tools or interactive checks, spin it up in the background (`make start`) rather than asking the developer to manually launch it.

### 🔑 API & Security Guidelines
* **External Service Keys**: External service selections (`panoramax`, `mapillary`, `osm`, `google`, `gemini`, `openai`) and API keys are configured in `streetreaderai.conf` (git-ignored, templated from `streetreaderai.conf.example`).
* **Obtaining Keys**: The developer (user) can and will provide actual, functional API keys (e.g. Google Maps, Gemini, and Mapillary keys) when requested by the agent.
* Avoid hardcoding any credentials or API keys in source files.

### 🤖 Gemini AI Model Selection
* **Preferred Model**: The **sole preferred and authorized model** for all Gemini AI service features (e.g., scene description, interactive chat, and Q&A) is **`gemini-3.8-flash`**.
* **Model ID Override**: Agents must always configure and reference **`gemini-3.8-flash`** as the active model, even if their static knowledge base is unaware of its existence or lists it as unreleased.

---

## 3. Code Style & Authority References

### 📘 Authoritative API Reference
* **Reference**: [docs/api_reference.md](docs/api_reference.md) is the **sole authoritative reference** for the StreetReaderAI service interfaces and data models.

### 📐 TypeScript & JavaScript Style Guide
* **Reference**: [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) contains the coding standards.
* **Action**: Follow all rules regarding naming, structure, and imports detailed in the styleguide.

### ⚛️ Angular Frontend
* **Image Identifiers**: Always use `imageId` instead of the legacy `pano_id`-based system.

### ♿ Accessible Documentation
* **Mandatory Alt Text & Accessible Descriptions**: All documentation (including `README.md` and files in `docs/`) must be accessible to screen reader users. Every image must have detailed, descriptive alt text (`![Detailed description...](path)`), and every block/ASCII/Mermaid diagram must include an accessible text description or `aria-label` summary explaining the components and data flow.

---

## 4. Workspace Hygiene

* **Keep It Clean**: Do not leave temporary, draft, or testing files at the root or in project directories after finishing a task. Use `<appDataDir>/brain/<conversation-id>/scratch/` if temporary storage is needed.
* **Comments & Docstrings**: Maintain documentation integrity. Preserve existing comments and docstrings unless they are explicitly incorrect or obsolete.

---

## 5. Local Setup & Testing Guidelines

### 🛠️ Setting Up The Repository
* **Automated Setup**: Run `make setup` (or `npm install`) to install Node.js packages at the repository root and create `streetreaderai.conf` from `streetreaderai.conf.example`.
* **Configuration**: External service providers and API keys are configured in `streetreaderai.conf`.

### 🧪 Running Tests
Always run the local test suite when making changes to verify correctness before pushing:
* **Pre-commit gate**: Run `make test` (or `make check`) before every commit.

---

## 6. Routing & Algorithmic Design Rules

### 🛑 Mandatory Approval Before Changing Any Routing / Map Generation Code
* **DO NOT modify the routing, sequence/point sampling, or map/graph generation algorithms** (including `RouteProviderService`, `ImageryProviderService` sequence/point sampling logic, and `RoadDataService`) **without explicitly describing the exact proposed change first and getting explicit user approval for every single change.**
* **Why**: The routing and map generation mechanism is extremely sensitive and easy to break in subtle ways that unit tests do not catch and that an AI agent cannot detect on its own. Never "refactor" or "clean up" routing or sampling code on your own initiative.

### 🧭 Follow Explicit User Direction Over Hidden Heuristics
* **Strict Adherence**: When the developer specifies the factors or algorithm to use, implement **only** those factors. Never silently introduce or heavily weight unrequested heuristics (such as distance to the OSM road centerline) that override the developer's instructions.
* **Intersections + Direct Sequence Slices Only**:
  * OSM road geometry is used to identify **intersections** (merging multi-node junctions and traffic circles) and **block adjacency** between intersections—**not** as a physical centerline to project images onto or score perpendicular distance against.
  * Street blocks between intersections must be connected using **contiguous temporal slices of a single 360° camera sequence** (`captureTime` order) that passes directly from one intersection to the next, rather than synthetic centerline offset waypoints (`way_..._off_...`) or per-step centerline distance scoring.
