# StreetReaderAI Routing & Imagery Architecture

All routing, road-network extraction, sequence solving, and equirectangular projection run 100% client-side in the browser across three services:
* [`client/src/app/services/route_provider_service.ts`](../client/src/app/services/route_provider_service.ts)
* [`client/src/app/services/road_data_service.ts`](../client/src/app/services/road_data_service.ts)
* [`client/src/app/services/panorama_crop_service.ts`](../client/src/app/services/panorama_crop_service.ts)

---

## Core Design Principle: 5-Step Intersections + Direct Sequence Slices

StreetReaderAI never projects panoramic imagery onto OpenStreetMap road centerlines or scores frames by perpendicular distance to road geometry. Instead, it builds a unified navigation graph using a **5-step algorithm**:

1. **Identify OSM Intersections & Block Adjacency (`RoadNetwork`)**
   - Fetch walkable/drivable OSM ways in a `500 m` bounding box from the official OpenStreetMap v0.6 endpoint (`https://api.openstreetmap.org/api/0.6/map.json`), with fallback to public Overpass API mirrors (`RoadDataService`).
   - Merge multi-node junctions, roundabouts, and unnamed traffic-circle connectors within `junctionMergeM` (`30 m`) into a single intersection cluster `cid`.
   - Walk along ways across degree-2 same-street joins (`RoadNetwork.walk`) to determine which intersection clusters `(cid_a, cid_b)` are directly adjacent along a street block.

2. **Discover & Chronologically Sort 360° Camera Sequences (`AreaSnapshot.discoverAndExpand`)**
   - Fetch `30 m` imagery bounding boxes around intersections within `45 m` of the user and their immediate block neighbors (1 `windowCache` entry per junction).
   - Expand only the panoramic sequences that bridge two adjacent intersections (`seqs_at[cid_a] ∩ seqs_at[cid_b]`, capped at the top 2 sequences per block), sorting each sequence's frames chronologically by `captureTime`.

3. **Slice Sequences into Direct Block Passes (`AreaSnapshot.solve`)**
   - Slice each sequence into contiguous temporal passes `frames[idx_a .. idx_b]` that visit `cid_a` and `cid_b` within `captureMaxM` (`30 m`), with:
     - No intermediate intersection visit (`< 18 m`),
     - Low sinuosity (`pathLen / straightDist <= 1.35`), and
     - Bounded frame spacing (`maxStep <= 30 m`).

4. **Pick the Best Sequence Slice per Block & Sample Waypoints**
   - Rank candidate passes for each adjacent pair `(cid_a, cid_b)` by sinuosity, endpoint proximity to the two intersections, and max frame step (with a continuity bonus for `activeSequences`).
   - Sample intermediate frames along the winning sequence slice at `~stepM` (`18 m`) intervals (`seq_<imageId>`).

5. **Unify Intersections & Connect Bidirectional Block Chains**
   - Select one canonical panoramic frame for each intersection `cid` (`osm_<cid>`) that minimizes distance to the incident block slices and intersection center.
   - Connect every solved block as a bidirectional chain `[osm_<cid_a>, seq_<f1>, seq_<f2>, ..., osm_<cid_b>]` so stepping forward into an intersection and turning onto any cross street shares the exact same intersection node.

---

## In-Browser Equirectangular Panorama Projection

* **Full-Resolution Source Spheres (`ImageryProviderService`)**:
  * **Panoramax** (`https://api.panoramax.xyz/api`): Queries STAC `/search` for 360° equirectangular collections and downloads `assets.hd` (falling back to `assets.sd`) with `crossOrigin = 'anonymous'`.
  * **Mapillary** (`https://graph.mapillary.com`): Queries `thumb_original_url` (falling back to `thumb_2048_url`) for the viewed node.
* **Rectilinear Viewport Rendering (`PanoramaCropService`)**:
  * Projects the 360° equirectangular sphere into a `1440×1080` (`90°` horizontal FOV) rectilinear JPEG viewport in-browser using HTML5 `<canvas>` spherical inverse gnomonic projection (`cropPanoramaToBase64`).
  * Rotating in place (`renderView`) re-projects the cached `HTMLImageElement` in memory with zero network calls.

---

## OpenStreetMap Rate-Limit Safeguards & Client Caching (`client_cache.ts`)

Because StreetReaderAI runs directly in the browser against public OpenStreetMap APIs, it enforces strict request-budget safeguards:

1. **Spatial Road Tile Reuse (`200 m` Window)**:
   * Each `/api/0.6/map.json` fetch covers a `±500 m` (`1 km × 1 km`) tile.
   * Subsequent steps within `200 m` of any cached tile center reuse the in-memory `RoadNetwork` (`roadCache`) with **0 network requests**.
2. **Zero-Call Nearby POI Extraction (`osmPoiTileCache`)**:
   * While parsing `/api/0.6/map.json`, `RoadDataService` extracts all named POI nodes and building/amenity ways (`amenity`, `shop`, `tourism`, `leisure`, `historic`, `healthcare`, `office`, `craft`, `public_transport`, `building`) into `osmPoiTileCache`.
   * `LocationProviderService.getNearbyPlaces()` reads directly from `osmPoiTileCache` whenever the user is inside the loaded tile—making **0 Overpass or Nominatim requests** during normal street exploration.
3. **In-Memory Street Name Resolution Before Reverse Geocoding**:
   * `RouteProviderService` resolves the current node's street or intersection name from the solved OSM graph (`streetNames`) first, and only falls back to Nominatim `/reverse` if no OSM street name exists.
4. **Throttled & Cached Autocomplete**:
   * Address autocomplete requires at least 3 characters, debounces keystrokes by `500 ms`, and caches results in `metadataCache`.

---

## Radar Mini-Map (`client/src/app/components/radar_view/radar_view.ts`)

The frontend displays a permanent, non-interactive (`aria-hidden="true"`, keyboard-safe) Street View–style radar mini-map in the bottom-right corner:
- Queries `ApiService.getLocalGraph()` when the user moves to a new node.
- Rotates the heading fan immediately as the user turns left/right (`heading` state signal).
- Renders solved street polylines, waypoint dots, intersection rings, and the current node marker.

---

## Testing (`make test`)

* [`client/src/app/services/route_provider_service_test.ts`](../client/src/app/services/route_provider_service_test.ts): Offline unit tests for the 5-step sequence graph solver, OSM v0.6 POI extraction (`extractPoisFromOsmElements`), and zero-network-call tile reuse.
* [`client/src/app/services/config_service_test.ts`](../client/src/app/services/config_service_test.ts): Unit tests for provider persistence, API key validation, and key-sharing proxy lock behavior.
