# StreetReaderAI Agent Guidelines (GEMINI.md)

Welcome! As an AI development assistant (Gemini, Antigravity, Jetski, etc.) working on the **StreetReaderAI** codebase, you must strictly adhere to the guidelines outlined in this document to maintain repository hygiene, avoid breaking existing configurations, and align with project practices.

---

## 1. Git & Branching Rules

### 🚫 Direct Pushes to `main` are Forbidden
* **Rule**: Do not attempt to push directly to the `main` branch. The repository has branch protection rules enabled that will decline direct pushes (GH013).
* **Action**: Always perform development on the `dev` branch or specific feature branches.

### 🌿 Branch Workflow
1. **Base Branch**: All development should be based on the latest `main` or `dev` branch.
2. **Work Branch**: Use the `dev` branch (or a feature branch like `feature/hygiene`) for staging, committing, and pushing your work.
3. **Submitting Changes**: Once changes are pushed to `dev`, they must be merged into `main` via a Pull Request.

---

## 2. Environment & Runtime Expectations

### 🖥️ Development Server
* Before executing any automated tests (integration or browser tests) or browser tools, we must check if the dev server is active on ports 4200 (frontend) and 5001 (backend).
* If the servers are not running, we must automatically spin them up in the background (e.g. via `make start` or individual targets) to support automated runs and interactive checks. Do not ask the developer to manually launch them.

### 🔑 API & Security Guidelines
* **Backend Authorization**: The StreetReaderAI backend server does not require an authorization key (`x-streetreader-api-key`). Endpoints are directly accessible without auth headers.
* **External Service Keys**: Real API keys for external services (Google Maps, Gemini, OpenAI, Mapillary) are configured on the backend via `server/streetreaderai.conf`.
* **Obtaining Keys**: The developer (user) can and will provide actual, functional API keys (e.g. Google Maps, Gemini, and Mapillary keys) when requested by the agent.
* Avoid hardcoding any credentials or API keys. Use `server/streetreaderai.conf` and appropriate configuration models.

### 🤖 Gemini AI Model Selection
* **Preferred Model**: The **sole preferred and authorized model** for all Gemini AI service features (e.g., scene description, interactive chat, and Q&A) is **`gemini-3.8-flash`**.
* **Model ID Override**: Agents must always configure and reference **`gemini-3.8-flash`** as the active model, even if their static knowledge base is unaware of its existence or lists it as unreleased.

---

## 3. Code Style & Authority References

### 📘 Authoritative API Reference
* **Reference**: [docs/api_reference.md](docs/api_reference.md) is the **sole authoritative reference** for the StreetReaderAI API documentation.
* **Consistency**: Ensure any changes to API routes, payloads, query parameters, or responses strictly match this specification.
* **PROHIBITED CHANGES**: The API request and response structures are fully verified, synchronized, and locked into a "known correct" state. **AI agents must never modify, adjust, adapt, or rename any API call structure, endpoint route, parameter casing, or payload nesting schema without explicit developer permission.**

### 📐 TypeScript & JavaScript Style Guide
* **Reference**: [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) contains the coding standards.
* **Action**: Follow all rules regarding naming, structure, and imports detailed in the styleguide.

### ⚛️ Angular Frontend
* **Consolidated API**: The frontend has been updated to use the consolidated StreetReaderAI API.
* **Image Identifiers**: Always use `image_id` instead of the legacy `pano_id`-based system.

---

## 4. Workspace Hygiene

* **Keep It Clean**: Do not leave temporary, draft, or testing files at the root or in project directories after finishing a task. Use `<appDataDir>/brain/<conversation-id>/scratch/` if temporary storage is needed.
* **Comments & Docstrings**: Maintain documentation integrity. Preserve existing comments and docstrings unless they are explicitly incorrect or obsolete.

---

## 5. Local Setup & Testing Guidelines

### 🛠️ Setting Up The Repository
* **Automated Setup**: Run `make setup`. This copies `server/streetreaderai.conf.example` to `server/streetreaderai.conf` (if not already present), syncs Python dependencies via `uv sync`, and installs Node.js packages in `client/`.
* **Configuration**: External service API keys (Google Maps, Gemini, etc.) and runtime flags are configured in `server/streetreaderai.conf`.

### 🧪 Running Tests
Always run the appropriate local test suites when making changes to verify correctness before pushing or submitting a pull request:
* **Pre-commit gate**: Run `make test` (or `make check`) before every commit. It runs the offline server unit tests and client tests.
* **Full Integration & Browser Suite**: Run `make test-all` to execute the master end-to-end test harness (requires the Flask server to be running on `localhost:5001` — start it with `make start`).

---

## 6. Routing & Algorithmic Design Rules

### 🧭 Follow Explicit User Direction Over Hidden Heuristics
* **Strict Adherence**: When the developer specifies the factors or algorithm to use, implement **only** those factors. Never silently introduce or heavily weight unrequested heuristics (such as distance to the OSM road centerline) that override the developer's instructions.
* **Intersections + Direct Sequence Slices Only**:
  * OSM road geometry is used to identify **intersections** (merging multi-node junctions and traffic circles) and **block adjacency** between intersections—**not** as a physical centerline to project images onto or score perpendicular distance against.
  * Street blocks between intersections must be connected using **contiguous temporal slices of a single 360° camera sequence** (`captureTime` order) that passes directly from one intersection to the next, rather than synthetic centerline offset waypoints (`way_..._off_...`) or per-step centerline distance scoring.
