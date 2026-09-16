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

import pytest
import math
from server.routing.map_math import calculate_bearing, calculate_distance, get_relative_position

def test_calculate_bearing_cardinal_directions():
    # North: (0, 0) to (1, 0)
    assert calculate_bearing(0, 0, 1, 0) == 0.0
    
    # East: (0, 0) to (0, 1)
    assert calculate_bearing(0, 0, 0, 1) == 90.0
    
    # South: (0, 0) to (-1, 0)
    assert calculate_bearing(0, 0, -1, 0) == 180.0
    
    # West: (0, 0) to (0, -1)
    assert calculate_bearing(0, 0, 0, -1) == 270.0

def test_calculate_bearing_diagonals():
    # Northeast: angle should be 45 degrees
    assert math.isclose(calculate_bearing(0, 0, 1, 1), 45.0, abs_tol=0.1)
    
    # Northwest: angle should be 315 degrees
    assert math.isclose(calculate_bearing(0, 0, 1, -1), 315.0, abs_tol=0.1)

def test_calculate_distance_zero():
    assert calculate_distance(37.7749, -122.4194, 37.7749, -122.4194) == 0.0

def test_calculate_distance_known():
    # Distance between Seattle (47.6062, -122.3321) and Bellevue (47.6101, -122.2015)
    dist = calculate_distance(47.6062, -122.3321, 47.6101, -122.2015)
    # Approx distance is around ~9800 meters depending on simple spherical projection
    assert 9000 < dist < 11000

def test_get_relative_position():
    # Camera at (0, 0) looking North (0 degrees)
    # POI at (1, 1) -> Bearing is ~45 (front-right)
    side, depth = get_relative_position(0, 0, 0, 1, 1)
    assert side == "right"
    assert depth == "front"
    
    # Camera at (0, 0) looking South (180 degrees)
    # POI at (1, 1) -> Relative target is behind the camera direction
    side, depth = get_relative_position(0, 0, 180, 1, 1)
    assert side == "left"
    assert depth == "behind"
    
    # POI exactly to the left (West: bearing 270)
    side, depth = get_relative_position(0, 0, 0, 0, -1)
    assert side == "left"
