# StreetReaderAI API Reference

This document outlines the API endpoints of the StreetReaderAI server and is the single source of truth for both the client and the server. Each field has exactly one accepted spelling — there are no aliases.

---

## Base URL

*   `http://localhost:5001/v1/streetreader`

---

## Authentication

No authorization key is required to access the StreetReaderAI API endpoints.

---

## 1. Location & Places

### `POST :searchNearbyPlaces`
Finds nearby Points of Interest (POIs) relative to a specific location.

**Request Payload:**
```json
{
  "location": {
    "latitude": 40.7484405,
    "longitude": -73.9856644
  },
  "heading": 0.0
}
```
*Note: `heading` is optional (defaults to `0.0`) and is used to compute the observer-relative position (`relativePosition.side` and `relativePosition.depth`) for each POI.*

**Response Payload:**
```json
{
  "places": [
    {
      "name": "Congestion relief zone",
      "location": {
        "latitude": 40.748428499999996,
        "longitude": -73.9856429
      },
      "types": [
        "regulated_area"
      ],
      "relativePosition": {
        "side": "RIGHT",
        "depth": "BEHIND"
      }
    }
  ]
}
```

---

### `POST :autocompletePlace`
Provides an address suggestions proxy for place lookups.

**Request Payload:**
```json
{
  "query": "1600 Amphithe",
  "session_token": "unique-session-string"
}
```

**Response Payload:**
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

## 2. Navigation & Imagery

### `POST :generatePanoramaView`
The primary navigation call. Locates a position (by canonical node ID + coordinates,
by image ID, by coordinates, or directly by address) and returns the rendered view,
the resolved street/intersection address, and the adjacent navigation links computed
for that node.

**Request Payload:**
```json
{
  "canonicalNodeId": "seq_3888112701332191",  // OR "address": "411 15th Ave E, Seattle" OR "imageId": "<imageId>"
  "coordinates": { "latitude": 47.62210, "longitude": -122.31264 },  // required with canonicalNodeId, or standalone seed
  "imageId": "3888112701332191",              // optional: preferred image at the node or direct image lookup
  "heading": 90.0,
  "pitch": 0.0
}
```

**Response Payload:**
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

Link fields for the client cache: `arrivalHeading` is the road tangent at the
landing (adopt it on arrival — no server-side alignment call needed);
`captureTime` / `isPano` describe the landing image.

---

### `POST :renderView`
Pure viewport rendering call. Re-crops an already-known 360° panorama (`imageId`)
at a new `heading` and `pitch` without solving road geometry or recomputing links.
Used when rotating in place or stepping onto a previously visited node in the
client's session cache.

**Request Payload:**
```json
{
  "imageId": "3888112701332191",
  "heading": 180.0,
  "pitch": 0.0
}
```

**Response Payload:**
```json
{
  "imageId": "3888112701332191",
  "image": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGB...",
  "actualHeading": 180.0
}
```

---

## 3. AI Services

### `POST :describeImage`
Generates an AI-powered visual description of the provided image using the configured AI provider (Gemini or OpenAI).

**Request Payload:**
```json
{
  "image": "base64_encoded_jpeg_string..."
}
```

**Response Payload:**
```json
{
  "description": "This is a wide urban street, characterized by dense, multi-story commercial buildings..."
}
```

---

### `POST :askQuestion`
Answers specific questions about the provided image and can optionally detect navigational intent.

**Request Payload:**
```json
{
  "image": "base64_encoded_jpeg_string...",
  "question": "Go forward to the next intersection",
  "detect_navigational_intent": true
}
```

**Response Payload:**
```json
{
  "answer": "Moving forward to the next intersection.",
  "navigationalAction": "MOVE_FORWARD"
}
```

*Note: When `detect_navigational_intent` is `true`, `navigationalAction` will be one of: `"MOVE_FORWARD"`, `"MOVE_BACKWARD"`, `"TURN_LEFT"`, `"TURN_RIGHT"`, `"TURN_AROUND"`, or `"NONE"`. When `detect_navigational_intent` is `false`, it is always `"NONE"`.*

---

## 4. Diagnostics & System

### `POST :getLocalGraph`
Returns the solved local navigation graph (unified `osm_<id>` intersections and `seq_<imageId>` block waypoints) within a radius of the given coordinates for map visualization or debugging.

**Request Payload:**
```json
{
  "coordinates": {
    "latitude": 47.62235,
    "longitude": -122.31283
  },
  "radiusMeters": 80
}
```
*Note: `radiusMeters` is optional (defaults to `80`).*

**Response Payload:**
```json
{
  "center": {
    "latitude": 47.62235,
    "longitude": -122.31283
  },
  "radiusMeters": 80.0,
  "currentNodeId": null,
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

---

### `GET :config`
Returns public runtime configuration for bootstrapping the client application.

**Response Payload:**
```json
{
  "startingAddress": "601 N 34th St, Seattle, WA",
  "imageryProvider": "mapillary",
  "demoMode": false
}
```

---

### `GET :cacheStats`
Returns current server cache entry counts across all tiers (`image`, `window`, `road`, `metadata`, `graph`, `description`) and live query audit telemetry (`external_calls`, `cache_hits`, `duplicate_queries`).

---

### `GET /api/help`
Returns this API reference document in Markdown format (`text/markdown; charset=utf-8`). Useful for programmatic inspection or runtime help views.
