# StreetReaderAI API Reference

This document outlines the API endpoints of the StreetReaderAI server and is the single source of truth for both the client and the server. Each field has exactly one accepted spelling — there are no aliases.

---

## Base URL

*   `http://localhost:5001/v1/streetreader`

---

## Authentication

No authorization key is required to access the StreetReaderAI API endpoints.

---

## 1. Location & Geocoding

### `POST :resolveAddress`
Retrieves the formatted street address for a given set of coordinates.

**Request Payload:**
```json
{
  "coordinates": {
    "latitude": 40.7484405,
    "longitude": -73.9856644
  }
}
```

**Response Payload:**
```json
{
  "address": "10e W 34th St., New York, NY 10001"
}
```

---

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

## 2. Imagery

### `POST :generatePanoramaView`
The primary navigation call. Locates a position (by session node id + coordinates,
by image id, or directly by address), returns the rendered view plus the adjacent
navigation links computed for it. The server is stateless: each call fetches the
roads/imagery it needs and forgets them; the client caches the nodes it has
visited for the lifetime of the page.

**Request Payload:**
```json
{
  "canonicalNodeId": "way_6457203_off_184",     // OR "address": "411 15th Ave E, Seattle" OR "name": "<imageId>"
  "coordinates": { "latitude": 47.62210, "longitude": -122.31264 },  // required with canonicalNodeId
  "name": "3888112701332191",     // optional: image the client is viewing (continuity context)
  "heading": 90.0,
  "pitch": 0.0,
  "imageOnly": false              // true = re-crop `name` only; skips links (client has them cached)
}
```

**Response Payload:**
```json
{
  "name": "3888112701332191",
  "canonicalNodeId": "way_6457203_off_184",
  "image": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGB...",
  "actualHeading": 90.0,
  "status": "ok",
  "lane": "right",
  "isPano": true,
  "panoramaMetadata": {
    "coordinates": { "latitude": 47.62210, "longitude": -122.31264 },
    "captureTime": "1750000000000"
  },
  "links": [
    {
      "canonicalNodeId": "way_6457203_off_194",
      "imageId": "1030404238891270",
      "heading": 359.2,
      "arrivalHeading": 358.7,
      "coordinates": { "latitude": 47.62219, "longitude": -122.31264 },
      "distanceMeters": 10.1,
      "streetName": "15th Avenue East",
      "status": "ok",
      "captureTime": "1750000000000",
      "isPano": true,
      "lane": "right"
    }
  ]
}
```

Link fields for the client cache: `arrivalHeading` is the road tangent at the
landing (adopt it on arrival — no server-side alignment call needed);
`lane` is the viewing side (`right` / `left` / `center` in the travel frame);
`captureTime` / `isPano` describe the landing image.

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
Returns the road network graph (intersections and way segments) within a radius of the given coordinates for map visualization or debugging.

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
      "streetNames": ["15th Avenue East", "East Harrison Street"]
    }
  ],
  "edges": [
    {
      "fromId": "osm_999",
      "toId": "way_6457203_off_200",
      "bearing": 0.5,
      "lengthMeters": 15.2,
      "streetName": "15th Avenue East"
    }
  ]
}
```

---

### `GET /api/help`
Returns this API reference document in Markdown format (`text/markdown; charset=utf-8`). Useful for programmatic inspection or runtime help views.