"""
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 """

import hashlib
import os
from flask import Flask, request, jsonify, send_from_directory

from server.core.cache import (
    clear_all_caches,
    description_cache,
    graph_cache,
    image_cache,
    metadata_cache,
    query_audit,
    road_cache,
    window_cache,
)
from server.core.config import config
from server.core.logger import logger, log_call
from server.core.exceptions import APIException
from server.core.models import AddressResponse, LatLng, NearbyPlacesResponse, POI, RelativePosition
from server.routing.route_provider import RouteProvider
from server.routing.map_math import get_relative_position

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIST = os.path.join(REPO_ROOT, 'client', 'dist', 'StreetReaderAI', 'browser')

app = Flask(__name__, static_folder=None)

# --- Service Initialization ---

# Geocoding
if config.LOCATION_SERVICE == "google":
    from server.services.geocoding.google_geocoding_service import GoogleLocationService
    location_service = GoogleLocationService(api_key=config.GOOGLE_MAPS_API_KEY)
else:
    from server.services.geocoding.osm_geocoding_service import OpenStreetMapLocationService
    location_service = OpenStreetMapLocationService()

# Imagery
if config.IMAGERY_PROVIDER == "panoramax":
    from server.services.imagery.panoramax_image_service import PanoramaxProvider
    imagery_provider = PanoramaxProvider(
        default_fov=config.DEFAULT_FOV,
        base_url=config.PANORAMAX_BASE_URL,
    )
elif config.IMAGERY_PROVIDER == "mapillary" and config.MAPILLARY_CLIENT_TOKEN:
    from server.services.imagery.mapillary_image_service import MapillaryProvider
    imagery_provider = MapillaryProvider(
        client_token=config.MAPILLARY_CLIENT_TOKEN,
        default_fov=config.DEFAULT_FOV,
    )
else:
    from server.services.imagery.stub_image_service import StubImageService
    imagery_provider = StubImageService()
    logger.warning("No imagery provider configured — imagery disabled, navigation will find no views")

# Routing engine
route_provider = RouteProvider(
    imagery=imagery_provider,
    location=location_service,
)

# AI
if config.AI_MODEL_PROVIDER == "openai":
    from server.services.ai.openai_ai_service import OpenAIService
    ai_service = OpenAIService(
        api_key=config.OPENAI_API_KEY,
        model_id=config.OPENAI_MODEL_ID
    )
else:
    from server.services.ai.gemini_ai_service import GeminiService
    ai_service = GeminiService(
        api_key=config.GEMINI_API_KEY,
        model_id=config.GEMINI_MODEL_ID
    )


@app.before_request
def setup_logging_context():
    # 0. Skip logging for preflight requests
    if request.method == 'OPTIONS':
        return

    # Log Request Details
    logger.debug(f">>> {request.method} {request.path}")
    if request.is_json:
        log_data = request.json.copy()
        if 'image_base64' in log_data: log_data['image_base64'] = "..."
        logger.debug(f"    Body: {log_data}")

@app.after_request
def log_response(response):
    if request.method == 'OPTIONS':
        return response
    logger.debug(f"<<< {response.status} {request.path}")
    return response

# --- Error Handlers ---

@app.errorhandler(APIException)
def handle_api_exception(e):
    logger.warning(f"API Error: {e.message}")
    return jsonify({"success": False, "message": e.message}), e.status_code

@app.errorhandler(Exception)
def handle_general_exception(e):
    logger.error(f"Unhandled Exception: {str(e)}", exc_info=True)
    return jsonify({"success": False, "message": "Internal Server Error"}), 500

# --- Routes ---

@app.route('/v1/streetreader:generatePanoramaView', methods=['POST'])
@log_call
def view_location():
    data = request.json
    image_id = data.get('name')
    canonical_node_id = data.get('canonicalNodeId')
    address = data.get('address')
    heading = data.get('heading', 0)
    pitch = data.get('pitch', 0)
    image_only = bool(data.get('imageOnly', False))
    coords = data.get('coordinates') or {}
    hint_lat = coords.get('latitude')
    hint_lng = coords.get('longitude')

    if not image_id and not canonical_node_id and not address and hint_lat is None:
        raise APIException("Missing canonicalNodeId, name, coordinates, or address")

    logger.info(f"[USER_EVENT] VIEW CHANGE: node={canonical_node_id}, image={image_id}, "
                f"address={address}, heading={heading}, imageOnly={image_only}")

    result = route_provider.get_pano_view(
        canonical_node_id=canonical_node_id,
        image_id=image_id,
        address=address,
        lat=hint_lat,
        lng=hint_lng,
        heading=heading,
        pitch=pitch,
        image_only=image_only,
    )
    return jsonify(result.model_dump())

@app.route('/v1/streetreader:resolveAddress', methods=['POST'])
@log_call
def address_info():
    data = request.json
    coords = data.get('coordinates') or {}
    lat = coords.get('latitude')
    lng = coords.get('longitude')

    if lat is None or lng is None:
        raise APIException("Missing coordinates (latitude/longitude)")

    res = location_service.reverse_geocode(lat, lng, result_type="street_address|route")
    if not res:
        raise APIException("Could not find street address for these coordinates.")
    return jsonify(AddressResponse(address=res["formatted_address"]).model_dump())

@app.route('/v1/streetreader:searchNearbyPlaces', methods=['POST'])
@log_call
def nearby_places():
    data = request.json
    location = data.get('location') or {}
    lat = location.get('latitude')
    lng = location.get('longitude')

    if lat is None or lng is None:
        raise APIException("Missing location (latitude/longitude)")

    heading = data.get('heading', 0)
    places = []
    for p in location_service.nearby_search(lat, lng, config.DEFAULT_NEARBY_RADIUS_M):
        poi_lat = p["geometry"]["location"]["lat"]
        poi_lng = p["geometry"]["location"]["lng"]
        side, depth = get_relative_position(lat, lng, heading, poi_lat, poi_lng)
        places.append(POI(
            name=p.get("name"),
            vicinity=p.get("vicinity", ""),
            location=LatLng(latitude=poi_lat, longitude=poi_lng),
            types=p.get("types", []),
            relativePosition=RelativePosition(side=side.upper(), depth=depth.upper()),
        ))
    return jsonify(NearbyPlacesResponse(places=places[:10]).model_dump())

@app.route('/v1/streetreader:describeImage', methods=['POST'])
@log_call
def describe_location():
    data = request.json
    image_base64 = data.get('image')

    if not image_base64: raise APIException("Missing image data")

    image_hash = hashlib.sha256(image_base64.encode('utf-8')).hexdigest()
    cached_desc = description_cache.get(image_hash)
    if cached_desc is not None:
        logger.info(f"[USER_EVENT] AI Description served from cache (0.0s): {cached_desc}")
        return jsonify({"description": cached_desc})

    logger.info("[USER_EVENT] Generating image description")
    description = ai_service.generate_description(image_base64)
    logger.info(f"[USER_EVENT] AI Description: {description}")
    description_cache.put(image_hash, description)

    return jsonify({"description": description})

@app.route('/v1/streetreader:askQuestion', methods=['POST'])
@log_call
def ask_question():
    data = request.json
    image_base64 = data.get('image')
    question = data.get('question')
    detect_actions = bool(data.get('detect_navigational_intent', False))

    if not image_base64 or not question: raise APIException("Missing image or question")

    logger.info(f"[USER_EVENT] AI Question: {question}")

    answer = ai_service.ask_question(
        image_base64,
        question,
        detect_actions=detect_actions
    )

    logger.info(f"[USER_EVENT] AI Response: {answer.answer}")

    return jsonify(answer.model_dump())

@app.route('/v1/streetreader:autocompletePlace', methods=['POST'])
@log_call
def autocomplete():
    data = request.json
    query = data.get('query', '')
    session_token = data.get('session_token', 'default-session')

    logger.info(f"[USER_EVENT] Autocomplete query: {query}")

    predictions = location_service.autocomplete(query, session_token=session_token)
    suggestions = []
    for p in predictions:
        suggestions.append({
            "description": p.description,
            "placeId": p.place_id
        })
    return jsonify({"suggestions": suggestions})

@app.route('/v1/streetreader:getLocalGraph', methods=['POST'])
@log_call
def local_graph():
    data = request.json or {}
    coords = data.get('coordinates') or {}
    lat = coords.get('latitude')
    lng = coords.get('longitude')
    radius_m = data.get('radiusMeters') or 80
    if lat is None or lng is None:
        raise APIException("Missing lat/lng")
    result = route_provider.get_local_graph(lat, lng, radius_m=radius_m)
    return jsonify(result.model_dump())

@app.route('/api/help', methods=['GET'])
def get_help():
    try:
        with open(os.path.join(REPO_ROOT, 'docs', 'api_reference.md'), 'r') as f:
            content = f.read()
        return content, 200, {'Content-Type': 'text/markdown; charset=utf-8'}
    except Exception as e:
        return f"Error reading api_reference.md: {str(e)}", 500

@app.route('/v1/streetreader:config', methods=['GET'])
@app.route('/api/config', methods=['GET'])
def get_config():
    start_addr = (
        config.PANORAMAX_STARTING_ADDRESS
        if config.IMAGERY_PROVIDER == "panoramax"
        else config.STARTING_ADDRESS
    )
    return jsonify({
        "startingAddress": start_addr,
        "imageryProvider": config.IMAGERY_PROVIDER,
        "demoMode": config.DEMO_MODE,
    })


@app.route('/v1/streetreader:cacheStats', methods=['GET'])
def get_cache_stats():
    return jsonify({
        "caches": {
            "image": len(image_cache),
            "window": len(window_cache),
            "road": len(road_cache),
            "metadata": len(metadata_cache),
            "graph": len(graph_cache),
            "description": len(description_cache),
        },
        "queryAudit": query_audit.snapshot(),
    })


# --- Frontend (Angular SPA) ---

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_spa(path):
    """Serve the built Angular app; fall back to index.html for client-side routes."""
    if path and os.path.exists(os.path.join(FRONTEND_DIST, path)):
        return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, 'index.html')


def clear_cache() -> None:
    """Clears all server in-memory LRU caches (images, windows, roads, descriptions).

    Callable locally within Python (e.g. scripts, tests, or interactive shells).
    """
    clear_all_caches()


if __name__ == '__main__':
    import sys
    if '--clear-cache' in sys.argv:
        clear_cache()
        print("Server in-memory cache cleared successfully.")
        sys.exit(0)
    app.run(debug=True, host='localhost', port=5001)
