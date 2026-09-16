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
from PIL import Image
from server.services.imagery.image_utils import crop_panorama

def test_crop_panorama_dimensions():
    # 1. Create a dummy image of size 2000x1000 with simple RGB lines
    img = Image.new('RGB', (2000, 1000), color='blue')
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    image_bytes = buf.getvalue()

    # 2. Run crop with standard parameters (heading 90, img_heading 0, fov 90)
    cropped_bytes = crop_panorama(image_bytes, heading=90.0, img_heading=0.0, fov=90, output_width=400, output_height=400)
    
    # 3. Assert correct format and bounds
    assert isinstance(cropped_bytes, bytes)
    assert len(cropped_bytes) > 0
    
    # Load returned image bytes and verify dimensions
    with Image.open(io.BytesIO(cropped_bytes)) as final_img:
        assert final_img.size == (400, 400)
        assert final_img.format == "JPEG"

def test_crop_panorama_wrapping_boundary():
    # Create dummy image
    img = Image.new('RGB', (2000, 1000), color='red')
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    image_bytes = buf.getvalue()
    
    # Run crop on wrapping edge boundary (heading 180, center at 0, fov 90 wraps around)
    cropped_bytes = crop_panorama(image_bytes, heading=180.0, img_heading=0.0, fov=90, output_width=200, output_height=200)
    
    with Image.open(io.BytesIO(cropped_bytes)) as final_img:
        assert final_img.size == (200, 200)
