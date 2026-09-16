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

from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal

# --- Base Configuration ---

class ApiModel(BaseModel):
    """Base for the API wire schemas. No case conversion happens anywhere:
    fields are declared in the exact (camelCase) names the frontend expects,
    and model_dump() emits them verbatim."""
    model_config = ConfigDict(
        populate_by_name=True,
        from_attributes=True
    )

# --- Common Models ---

class LatLng(ApiModel):
    latitude: float
    longitude: float

class LocationMetadata(ApiModel):
    imageId: str
    coordinates: LatLng
    captureTime: str
    heading: float
    description: Optional[str] = None
    isPano: bool = False
    sequenceId: Optional[str] = None

class StandardResponse(ApiModel):
    """Base response model for endpoint payloads."""
    message: Optional[str] = None

# --- Specific Endpoint Responses ---

class NavigationLink(ApiModel):
    canonicalNodeId: str
    imageId: Optional[str] = None
    heading: float                # bearing of travel leaving the current node (deg)
    coordinates: LatLng           # landing node's coordinates (not the image's)
    distanceMeters: float         # distance to reach the landing node
    streetName: str = ""
    status: str = "ok"            # "ok" | "path_only"
    captureTime: Optional[str] = None   # landing image capture time (epoch ms string)
    isPano: bool = False                # landing image is panoramic
    lane: Optional[str] = None          # "right" | "left" | "center" in the travel frame
    arrivalHeading: Optional[float] = None  # road tangent at the landing node (deg)

class PanoramaMetadata(ApiModel):
    """Metadata container nested inside generatePanoramaView response."""
    coordinates: LatLng
    captureTime: str

class ViewResponse(StandardResponse):
    image: Optional[str] = None
    name: Optional[str] = None                  # image_id when available
    canonicalNodeId: Optional[str] = None       # canonical location the user is at
    actualHeading: Optional[float] = None
    panoramaMetadata: Optional[PanoramaMetadata] = None
    links: Optional[List[NavigationLink]] = None
    status: str = "ok"                          # "ok" | "path_only"
    lane: Optional[str] = None                  # viewing lane: "right" | "left" | "center"
    isPano: bool = False

class AddressResponse(StandardResponse):
    address: Optional[str] = None

class RelativePosition(ApiModel):
    side: str # e.g. RIGHT
    depth: str # e.g. FRONT

class POI(ApiModel):
    name: str
    vicinity: str = ""
    location: LatLng
    types: List[str] = []
    relativePosition: RelativePosition

class NearbyPlacesResponse(StandardResponse):
    places: Optional[List[POI]] = None

# --- Debug / diagnostics ---

class DebugNode(ApiModel):
    canonicalNodeId: str
    coordinates: LatLng
    kind: str                    # "intersection" | "waypoint"
    status: str = "unknown"      # "ok" | "path_only" | "unknown" (not yet resolved)
    imageId: Optional[str] = None
    streetNames: List[str] = []

class DebugEdge(ApiModel):
    fromId: str
    toId: str
    bearing: float
    lengthMeters: float
    streetName: str = ""

class LocalGraphResponse(StandardResponse):
    center: LatLng
    radiusMeters: float
    currentNodeId: Optional[str] = None
    nodes: List[DebugNode] = []
    edges: List[DebugEdge] = []

# --- AI Service Models ---

class DescribeResponse(ApiModel):
    description: str

class ChatResponse(StandardResponse):
    answer: str = Field(..., description="The natural language response to the user's message.")
    navigationalAction: Literal["TURN_LEFT", "TURN_RIGHT", "TURN_AROUND", "MOVE_FORWARD", "MOVE_BACKWARD", "NONE"] = Field("NONE")
