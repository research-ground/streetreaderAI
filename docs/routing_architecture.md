# StreetReaderAI Routing & Imagery Architecture

All routing and navigation logic lives in a single self-contained module:
[`server/routing/route_provider.py`](../server/routing/route_provider.py).

---

## Core Design Principle: 5-Step Intersections + Direct Sequence Slices

StreetReaderAI never projects panoramic imagery onto OpenStreetMap road centerlines or scores frames by perpendicular distance to road geometry. Instead, it builds a unified navigation graph using a **5-step algorithm**:

1. **Identify OSM Intersections & Block Adjacency (`RoadNetwork`)**
   - Parse walkable/drivable OSM ways (`RoadDataSource` fallback chain: `LocalExtractRoadService` $\to$ `OsmMapApiRoadService` $\to$ `OverpassRoadService`).
   - Merge multi-node junctions, roundabouts, and unnamed traffic-circle connectors within `junction_merge_m` (`30 m`) into a single intersection cluster `cid`.
   - Walk along ways across degree-2 same-street joins (`RoadNetwork.walk`) to determine which intersection clusters `(cid_a, cid_b)` are directly adjacent along a street block.

2. **Discover & Chronologically Sort 360° Camera Sequences (`AreaSnapshot.discover_and_expand`)**
   - Fetch `30 m` imagery bounding boxes around intersections within `45 m` of the user and their immediate block neighbors (1 SQLite `window_cache` entry per junction).
   - Expand only the panoramic sequences that bridge two adjacent intersections (`seqs_at[cid_a] & seqs_at[cid_b]`, capped at the top 2 sequences per block), sorting each sequence's frames chronologically by `captureTime`.

3. **Slice Sequences into Direct Block Passes (`AreaSnapshot.solve`)**
   - Slice each sequence into contiguous temporal passes `frames[idx_a : idx_b + 1]` that visit `cid_a` and `cid_b` within `capture_max_m` (`30 m`), with:
     - No intermediate intersection visit (`< 18 m`),
     - Low sinuosity (`path_len / straight_dist <= 1.35`), and
     - Bounded frame spacing (`max_step <= 30 m`).

4. **Pick the Best Sequence Slice per Block & Sample Waypoints**
   - Rank candidate passes for each adjacent pair `(cid_a, cid_b)` by sinuosity, endpoint proximity to the two intersections, and max frame step (with a continuity bonus for `active_sequences`).
   - Sample intermediate frames along the winning sequence slice at `~step_m` (`18 m`) intervals (`seq_<imageId>`).

5. **Unify Intersections & Connect Bidirectional Block Chains**
   - Select one canonical panoramic frame for each intersection `cid` (`osm_<cid>`) that minimizes distance to the incident block slices and intersection center.
   - Connect every solved block as a bidirectional chain `[osm_<cid_a>, seq_<f1>, seq_<f2>, ..., osm_<cid_b>]` so stepping forward into an intersection and turning onto any cross street shares the exact same intersection node.

---

## High-Resolution Panorama Projection & Future Quality Roadmap

### Implemented High-Resolution Pipeline
- **Full-Resolution Source Spheres**:
  - [`MapillaryProvider`](../server/services/imagery/mapillary_image_service.py) requests `thumb_original_url` (typically `4096×2048` to `5760×2880`, falling back to `thumb_2048_url`) only at the final `get_image` step for the viewed node.
  - [`PanoramaxProvider`](../server/services/imagery/panoramax_image_service.py) prefers `assets.hd` (falling back to `assets.sd`).
- **Bicubic `1440×1080` Rectilinear Projection**:
  - [`crop_panorama`](../server/services/imagery/image_utils.py) projects the 360° equirectangular sphere into a `1440×1080` viewport using `cv2.INTER_CUBIC` interpolation and `BORDER_WRAP`.

### Future Image Quality & Placement Enhancements
1. **Horizon Leveling (Pitch & Roll Correction)**
   - Community 360° cameras mounted on helmets, backpacks, bike handlebars, or sloped vehicle roofs can have a 5°–20° tilt baked into the equirectangular stitch.
   - **Approach**: Query Mapillary's `computed_rotation` (OpenSfM's 3D angle-axis world-to-camera rotation vector `[rx, ry, rz]`) or Panoramax's `pers:pitch` / `pers:roll` properties, derive the rig's pitch and roll offsets relative to the horizon, and apply the full 3D rotation $R_{\text{roll}} R_{\text{pitch}} R_{\text{yaw}}$ in [`crop_panorama`](../server/services/imagery/image_utils.py) before spherical remapping.
2. **Sequence Quality & Rig Stability Scoring (Step 3 / Step 4)**
   - When multiple sequences traverse the same block (e.g., a shaky bicycle/backpack capture vs. a stabilized vehicle roof rig), rank candidate passes using:
     - **Mapillary `quality_score`** (`0.0–1.0` score penalizing motion blur, poor exposure, and low resolution).
     - **Heading stability**: Penalize frame-to-frame jitter between `computed_compass_angle` and the GPS displacement bearing $\text{bearing}(f_k, f_{k+1})$. Stabilized vehicle rigs maintain near-zero angular jitter, whereas handheld/helmet mounts wobble between frames.
     - **Capture recency (`captureTime`)**: Add a small tie-breaker favoring newer sequences when geometric scores are comparable.
3. **Local-Window Waypoint Sampling (Step 4)**
   - Instead of selecting strictly the single frame closest to `target_d = total_d * (k / n_steps)`, evaluate all frames within a `±4 m` window of `target_d` and pick the frame with the highest `quality_score` and lowest heading deviation from the local travel bearing (avoiding frames captured mid-bump or mid-turn).

---

## Caching & Database Efficiency (`server/core/cache.py`)

All caches are backed by a single SQLite database (`server/.cache/streetreaderai.db`) with a configurable total size budget (`SERVER_CACHE_MAX_MB`, default `1024 MB`):

- `road_cache`: OSM way geometry per tile.
- `window_cache`: Per-junction imagery bounding boxes (`junction_v3`) and full sequence frame lists (`seq`). Bulk fetches store the list in a single `window_cache.put` operation without per-frame database writes.
- `graph_cache`: Solved `NodePlace` and `NavigationLink` payloads keyed by `(provider, canonical_node_id, image_id)`.
- `image_cache`: Downloaded equirectangular panorama bytes (`hd:<imageId>` / `panoramax_hd:<imageId>`).

---

## Radar Mini-Map (`client/src/app/components/radar_view/radar_view.ts`)

The frontend displays a permanent, non-interactive (`aria-hidden="true"`, keyboard-safe) Google Street View–style radar mini-map in the bottom-right corner:
- Queries `POST /v1/streetreader:getLocalGraph` when the user moves to a new node.
- Rotates the heading fan immediately as the user turns left/right (`heading` state signal).
- Renders solved street polylines, waypoint dots, intersection rings, and the current node marker.

---

## Testing (`tests/`)

- **Offline Unit Tests (`make test`)**:
  - [`tests/unit/test_roads.py`](../tests/unit/test_roads.py): OSM marker classification, junction clustering, and arc-walking.
  - [`tests/unit/test_navigate.py`](../tests/unit/test_navigate.py): 5-step sequence graph solver, intersection unification, and `RouteProvider` contracts.
  - [`tests/unit/test_mapillary_provider.py`](../tests/unit/test_mapillary_provider.py) & [`tests/unit/test_panoramax_provider.py`](../tests/unit/test_panoramax_provider.py): Sequence and bounding-box fetching.
- **Live Integration & Visual Inspection (`tests/integration/test_navigation.py`)**:
  - End-to-end multi-step walking and turning across intersections.
  - Sequence fetching and SQLite cache efficiency verification.
  - Google Maps Hybrid satellite overlay rendering + Gemini (`askQuestion`) visual inspection for graph connectivity and road alignment.
