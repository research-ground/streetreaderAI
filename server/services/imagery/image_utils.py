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

import io
import math
import cv2
import numpy as np

def crop_panorama(image_bytes: bytes, heading: float, img_heading: float, fov: int, output_width: int = 1024, output_height: int = 768) -> bytes:
    """
    Crops a 360 panorama into a specific window based on heading and FOV.
    Uses OpenCV to apply a proper rectilinear projection (removes fisheye distortion).
    """
    # 1. Decode image with OpenCV
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image.")
        
    h, w = img.shape[:2]
    
    # 2. Calculate the relative yaw and pitch
    # Mapillary pano center is the compass_angle.
    yaw_deg = (heading - img_heading + 180) % 360 - 180
    pitch_deg = 0  # Assuming horizontal look for now
    
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    
    # Calculate focal length for the desired FOV (horizontal field of view)
    fov_rad = math.radians(fov)
    f = 0.5 * output_width / math.tan(fov_rad / 2)

    # 3. Create the mapping grid for remap
    # Output image pixel coordinates
    # x goes from -W/2 to W/2
    # y goes from -H/2 to H/2
    x, y = np.meshgrid(np.arange(output_width) - output_width / 2, 
                       np.arange(output_height) - output_height / 2)

    # 3D ray vectors for each pixel
    # Z is forward, X is right, Y is down
    Z = np.full_like(x, f)
    X = x
    Y = y
    
    # Rotate by pitch (around X axis)
    cos_p = math.cos(pitch)
    sin_p = math.sin(pitch)
    Y_rot = Y * cos_p - Z * sin_p
    Z_rot = Y * sin_p + Z * cos_p
    
    # Rotate by yaw (around Y axis)
    cos_y = math.cos(yaw)
    sin_y = math.sin(yaw)
    X_rot = X * cos_y + Z_rot * sin_y
    Z_final = -X * sin_y + Z_rot * cos_y

    # Convert 3D rays to spherical coordinates (longitude and latitude)
    lon = np.arctan2(X_rot, Z_final)
    lat = np.arcsin(Y_rot / np.sqrt(X_rot**2 + Y_rot**2 + Z_final**2))
    
    # Map spherical coordinates to original equirectangular image pixels
    # lon is in [-pi, pi], lat is in [-pi/2, pi/2]
    map_x = (lon / (2 * math.pi) + 0.5) * w
    map_y = (lat / math.pi + 0.5) * h
    
    # Convert map coordinates to float32 for cv2.remap
    map_x = map_x.astype(np.float32)
    map_y = map_y.astype(np.float32)
    
    # Apply the remap. BORDER_WRAP automatically handles 360-degree wrapping for X axis
    cropped = cv2.remap(img, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    
    # 4. Encode to JPEG
    is_success, buffer = cv2.imencode(".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not is_success:
        raise ValueError("Failed to encode cropped image.")
        
    return buffer.tobytes()
