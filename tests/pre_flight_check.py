#!/usr/bin/env python3

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

import os
import sys

def main():
    conf_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../server/streetreaderai.conf'))

    print("🔍 STAGE 1: RUNNING STATIC ANALYSIS & PRE-FLIGHT GATE")

    # 1. Check file existence
    if not os.path.exists(conf_path):
        print(f"   [FAIL] Configuration file 'server/streetreaderai.conf' not found at expected path: {conf_path}", file=sys.stderr)
        print("          Please copy server/streetreaderai.conf.example to server/streetreaderai.conf and configure your keys.", file=sys.stderr)
        sys.exit(1)

    print("   [OK] Pre-flight config check: 'server/streetreaderai.conf' present")

    # 2. Read and parse configurations
    config = {}
    try:
        with open(conf_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, val = line.split('=', 1)
                    key = key.strip()
                    val = val.strip()
                    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                        val = val[1:-1]
                    config[key] = val
    except Exception as e:
        print(f"   [FAIL] Failed to read or parse server/streetreaderai.conf: {e}", file=sys.stderr)
        sys.exit(1)

    # 3. Check for external key configurations dynamically based on configured providers
    keys_to_check = []
    
    ai_provider = (config.get('AI_MODEL_PROVIDER') or 'gemini').lower()
    if ai_provider == 'gemini':
        keys_to_check.append(('GEMINI_API_KEY', 'Gemini AI provider'))
    elif ai_provider == 'openai':
        keys_to_check.append(('OPENAI_API_KEY', 'OpenAI AI provider'))

    location_service = (config.get('LOCATION_SERVICE') or 'osm').lower()
    if location_service == 'google':
        keys_to_check.append(('GOOGLE_MAPS_API_KEY', 'Google location service'))
    elif location_service == 'osm':
        print("   [INFO] Location service is 'osm' (OpenStreetMap/Nominatim, no API key required)")

    imagery_provider = (config.get('IMAGERY_PROVIDER') or 'mapillary').lower()
    if imagery_provider == 'mapillary':
        # Mapillary token is optional for stub/offline mode, but note if present
        val = config.get('MAPILLARY_CLIENT_TOKEN', '').strip()
        if not val or any(p in val.upper() for p in ['YOUR_', '_HERE', 'PLACEHOLDER']):
            print("   [INFO] Imagery provider is 'mapillary' without a client token (running in stub mode)")
        else:
            print("   [OK] Key check: MAPILLARY_CLIENT_TOKEN is configured")

    placeholders = ['YOUR_', '_HERE', 'PLACEHOLDER']
    failed = False
    for key, desc in keys_to_check:
        val = config.get(key, '').strip()
        if not val:
            print(f"   [FAIL] Key check: {key} is missing or empty in server/streetreaderai.conf (required for {desc})", file=sys.stderr)
            failed = True
            continue

        is_placeholder = any(p in val.upper() for p in placeholders)
        if is_placeholder:
            print(f"   [FAIL] Key check: {key} is still set to a template/placeholder value: '{val}'", file=sys.stderr)
            failed = True
            continue

        print(f"   [OK] Key check: {key} is configured for {desc}")

    if failed:
        print("\n❌ Pre-flight check failed! Please configure valid API keys in server/streetreaderai.conf.", file=sys.stderr)
        sys.exit(1)

    print("➡️ Pre-flight checks passed successfully! [OK]\n")
    sys.exit(0)

if __name__ == '__main__':
    main()
