# Google AI Studio Server-Side Architecture Specification

Google AI Studio enforces a server-side execution policy for Gemini API calls so that API keys are never exposed in client-side browser bundles or unproxied browser network requests.

The platform check and runtime environment revolve around three criteria:

---

## 1. Capability Declaration (`metadata.json`)

AI Studio uses `metadata.json` to track project requirements and platform capabilities. The platform detection check looks specifically for `"MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"` inside `majorCapabilities`:

```json
{
  "name": "StreetReaderAI",
  "description": "An AI-powered accessibility tool for blind and low-vision travelers to explore and interact with 360° street-level imagery using multimodal AI.",
  "requestFramePermissions": ["microphone"],
  "majorCapabilities": ["MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"]
}
```

Apps without this entry are treated as legacy projects making unproxied client-side calls or relying on deprecated client-side key selector popups (`window.aistudio.hasSelectedApiKey`).

---

## 2. Server-Side Execution Model

In the server-side architecture, browser code is not permitted to handle `GEMINI_API_KEY` or call Google Generative Language endpoints directly:

1. **Secrets Management**: The API key is attached directly to the container runtime via `process.env.GEMINI_API_KEY` (visible and configurable under the platform's **Settings > Secrets** panel) or loaded on the server from `models.conf` / `streetreaderai.conf` during local development.
2. **Server-Side Client**: `@google/genai` SDK instances and outbound API calls are executed strictly in the Node.js server layer (`src/server.ts`):
   ```ts
   import { GoogleGenAI } from '@google/genai';

   const ai = new GoogleGenAI({
     apiKey: process.env.GEMINI_API_KEY,
     httpOptions: {
       headers: { 'User-Agent': 'aistudio-build' },
     },
   });
   ```
3. **Frontend Proxying**: The browser client communicates with local server endpoints (`GET /api/config` and `POST /api/proxy`) rather than sending requests or API keys directly from the browser to external APIs.

---

## 3. Dev Server & Middleware Integration

### A. Angular Application Server (`angular.json` + `src/server.ts`)

For Angular projects, AI Studio uses Angular's built-in application server configuration (`angular.json`) to serve both the client application and the Express middleware/route layer (`src/server.ts`) simultaneously on the same port:

```json
"build": {
  "options": {
    "server": "src/main.server.ts",
    "outputMode": "server",
    "ssr": { "entry": "src/server.ts" }
  }
}
```

All Angular routes are configured with `RenderMode.Client` (`src/main.server.ts`) so that the UI renders 100% in the browser while `src/server.ts` handles `/api/config` and `/api/proxy` on the Node.js server.

### B. Vite Dev Server Middleware (`vite.config.ts` + `src/server.ts`)

For Vite-based projects (such as Lit web applications), `vite.config.ts` mounts the Node.js middleware from `src/server.ts` directly onto Vite's HTTP server via `configureServer` and `configurePreviewServer`, serving both the static client and `/api/config` + `/api/proxy` on the same port.
