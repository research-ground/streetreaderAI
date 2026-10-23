# StreetReaderAI Service & API Reference

This document is the single authoritative reference for the StreetReaderAI client-side service interfaces (`ApiService`) and data models. Each field has exactly one accepted spelling — there are no aliases.

---

## Architecture Overview

StreetReaderAI executes as a **100% client-side Angular SPA**. All navigation, road-graph solving, equirectangular panorama projection, geocoding, and AI vision calls are orchestrated in the browser through [`ApiService`](../src/app/services/api_service.ts), which delegates to:

* [`RouteProviderService`](../src/app/services/route_provider_service.ts) — 5-step intersection + sequence-slice routing solver.
* [`RoadDataService`](../src/app/services/road_data_service.ts) — OpenStreetMap v0.6 `/api/0.6/map.json` road network and POI extractor (with Overpass fallback).
* [`ImageryProviderService`](../src/app/services/imagery_provider_service.ts) — Declarative street imagery client configured by `[imagery.<name>]` in `streetreaderai.conf` (`retrieval_type = sequence | image`, `image_format = 360 | single`).
* [`PanoramaCropService`](../src/app/services/panorama_crop_service.ts) — HTML5 `<canvas>` 360° equirectangular-to-rectilinear projection (`960×720`, `120°` FOV, with decoded `Uint8ClampedArray` pixel buffer caching).
* [`LocationProviderService`](../src/app/services/location_provider_service.ts) — Declarative geocoding, reverse geocoding, autocomplete, and nearby POI client configured by `[location.<name>]` in `streetreaderai.conf`.
* [`AiProviderService`](../src/app/services/ai_provider_service.ts) — Declarative multimodal scene description and visual Q&A client configured by `[ai.<name>]` in `streetreaderai.conf` (Google Gemini `gemini-3.8-flash` or OpenAI-compatible `gpt-5.6-terra`).
* [`ConfigService`](../src/app/services/config_service.ts) — Loads `streetreaderai.conf` (falling back to `streetreaderai.conf.example`), parses `[system]`, `[keys]`, and declarative provider sections (`[imagery.*]`, `[location.*]`, `[ai.*]`), detects host environment keys (`process.env.GEMINI_API_KEY`), and validates required keys on launch (`validateRequiredKeys()`).

---

## 1. Location & Places (`LocationProviderService` / `ApiService`)

### `getNearbyPlaces({ lat, lng, radius?, heading? })`
Finds nearby Points of Interest (POIs) relative to a specific location and computes observer-relative positions (`LEFT`/`RIGHT`, `FRONT`/`BEHIND`).
* When **OpenStreetMap** (`[location.osm]`) is selected, POIs (`node` and building `way` elements with `name` tags) are extracted directly from the already-cached OpenStreetMap v0.6 road tile (`osmPoiTileCache`) with zero extra network calls whenever the user is inside the loaded road tile.
* When **Google Maps** (`[location.google]`) is selected, calls Places API v1 (`places:searchNearby`).

**Response Interface (`GetNearbyPlacesResponse`):**
```json
{
  "places": [
    {
      "name": "Fremont Troll",
      "vicinity": "North 36th Street",
      "location": {
        "latitude": 47.65095,
        "longitude": -122.34727
      },
      "types": [
        "tourism:attraction"
      ],
      "relativePosition": {
        "side": "LEFT",
        "depth": "FRONT"
      }
    }
  ]
}
```

---

### `autocompleteAddress(query, sessionToken?)` / `LocationProviderService.autocomplete(query, sessionToken?)`
Provides place and address suggestions.
* **OpenStreetMap**: Throttled (minimum 3 characters, 500ms debounce in UI) and cached in `metadataCache` against Nominatim `/search`.
* **Google Maps**: Calls Places API v1 (`places:autocomplete`).

**Response Interface (`AutocompleteResponse`):**
```json
{
  "suggestions": [
    {
      "description": "1600 Amphitheatre Parkway, Mountain View, CA, USA",
      "placeId": "ChIJ09H2YwK6j4ARoF7qfCBxhB8"
    }
  ]
}
```

---

## 2. Navigation & Imagery (`RouteProviderService` / `ApiService`)

### `getView(params)` / `RouteProviderService.getPanoView(params)`
The primary navigation method. Locates a position (by `canonicalNodeId` + `coordinates`, by `imageId`, by `coordinates`, or by `address`) and returns the rendered rectilinear viewport (`base64` JPEG), the resolved street/intersection address, and the adjacent navigation links computed for that node.

**Request Parameters:**
```json
{
  "canonicalNodeId": "seq_3888112701332191",
  "coordinates": { "latitude": 47.62210, "longitude": -122.31264 },
  "imageId": "3888112701332191",
  "address": "411 15th Ave E, Seattle",
  "heading": 90.0,
  "pitch": 0.0
}
```

**Response Interface (`GetViewResponse`):**
```json
{
  "imageId": "3888112701332191",
  "canonicalNodeId": "seq_3888112701332191",
  "image": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGB...",
  "actualHeading": 90.0,
  "coordinates": { "latitude": 47.62210, "longitude": -122.31264 },
  "captureTime": "1750000000000",
  "address": "15th Avenue East",
  "status": "ok",
  "isPano": true,
  "links": [
    {
      "canonicalNodeId": "seq_1030404238891270",
      "imageId": "1030404238891270",
      "heading": 359.2,
      "arrivalHeading": 358.7,
      "coordinates": { "latitude": 47.62219, "longitude": -122.31264 },
      "distanceMeters": 10.1,
      "streetName": "15th Avenue East",
      "status": "ok",
      "captureTime": "1750000000000",
      "isPano": true
    }
  ]
}
```

---

### `renderView(options)`
Pure viewport rendering method. Re-crops an already-known 360° panorama (`imageId`) in-browser via `PanoramaCropService` at a new `heading` and `pitch` without re-solving road geometry or recomputing links.

**Request Interface (`RenderViewOptions`):**
```json
{
  "imageId": "3888112701332191",
  "heading": 180.0,
  "pitch": 0.0
}
```

**Response Interface (`RenderViewResponse`):**
```json
{
  "imageId": "3888112701332191",
  "image": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGB...",
  "actualHeading": 180.0
}
```

---

## 3. AI Services (`AiProviderService` / `ApiService`)

### `describeImage(imageBase64)`
Generates an AI-powered visual description (2–3 sentences focused on street layout, buildings, and permanent features for blind travelers) using the configured AI provider:
* **Google Gemini**: `gemini-3.8-flash`
* **OpenAI**: `gpt-5.6-terra`

**Response Interface (`DescribeImageResponse`):**
```json
{
  "description": "This is a wide urban street, characterized by dense, multi-story commercial buildings..."
}
```

---

### `askQuestion(imageBase64, question, detectActions?)`
Answers specific questions about the current street view image and optionally detects navigational intent when `detectActions` (`chatControlsApp`) is enabled.

**Response Interface (`AskQuestionResponse`):**
```json
{
  "answer": "Moving forward to the next intersection.",
  "navigationalAction": "MOVE_FORWARD"
}
```
*Note: `navigationalAction` is one of `"MOVE_FORWARD"`, `"MOVE_BACKWARD"`, `"TURN_LEFT"`, `"TURN_RIGHT"`, `"TURN_AROUND"`, or `"NONE"`.*

---

## 4. Diagnostics & Graph Inspection

### `getLocalGraph({ lat, lng, radiusMeters? })`
Returns the solved local navigation graph (unified `osm_<id>` intersections and `seq_<imageId>` block waypoints) within `radiusMeters` (default `80`) for the `RadarViewComponent` mini-map and debugging.

**Response Interface (`LocalGraphResponse`):**
```json
{
  "center": { "latitude": 47.62235, "longitude": -122.31283 },
  "radiusMeters": 80.0,
  "currentNodeId": "osm_999",
  "nodes": [
    {
      "canonicalNodeId": "osm_999",
      "coordinates": { "latitude": 47.62235, "longitude": -122.31283 },
      "kind": "intersection",
      "status": "ok",
      "imageId": "3888112701332191",
      "streetNames": ["15th Avenue East", "East Harrison Street"],
      "sequenceId": "seq_123"
    }
  ],
  "edges": [
    {
      "fromId": "osm_999",
      "toId": "osm_1000",
      "bearing": 0.5,
      "lengthMeters": 85.2,
      "streetName": "15th Avenue East",
      "polyline": [
        { "latitude": 47.62235, "longitude": -122.31283 },
        { "latitude": 47.62312, "longitude": -122.31283 }
      ]
    }
  ],
  "queryAudit": {
    "external_calls": {},
    "total_external_calls": 0,
    "cache_hits": { "road": 1, "window": 1 },
    "total_cache_hits": 2,
    "duplicate_queries": [],
    "duplicate_count": 0
  }
}
```
