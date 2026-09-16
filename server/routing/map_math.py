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

"""Geographic math primitives: bearings, flat-earth distances, and the
camera-relative position used for nearby-place announcements. Distances use
the same M_PER_DEG constant as the routing engine's projections."""

import math

def calculate_bearing(lat1, lng1, lat2, lng2):
    """Calculates the bearing from (lat1, lng1) to (lat2, lng2)."""
    d_lon = math.radians(lng2 - lng1)
    y = math.sin(d_lon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - \
        math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(d_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def calculate_distance(lat1, lng1, lat2, lng2):
    """Calculates the approximate distance in meters between two points."""
    M_PER_DEG = 111139 
    dy = (lat2 - lat1) * M_PER_DEG
    dx = (lng2 - lng1) * M_PER_DEG * math.cos(math.radians(lat1))
    return math.sqrt(dx**2 + dy**2)

def get_relative_position(cam_lat, cam_lng, cam_heading, poi_lat, poi_lng):
    """Calculates if a POI is front/behind and left/right of the camera."""
    poi_bearing = calculate_bearing(cam_lat, cam_lng, poi_lat, poi_lng)

    # Calculate relative angle (-180 to 180)
    diff = (poi_bearing - cam_heading + 180) % 360 - 180
    
    side = "right" if diff > 0 else "left"
    depth = "front" if abs(diff) < 90 else "behind"
    return side, depth
