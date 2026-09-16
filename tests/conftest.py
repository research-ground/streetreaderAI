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
import os
from dotenv import load_dotenv

# Load configuration from server/streetreaderai.conf
conf_path = os.path.join(os.path.dirname(__file__), '..', 'server', 'streetreaderai.conf')
if os.path.exists(conf_path):
    load_dotenv(dotenv_path=conf_path)

def pytest_addoption(parser):
    parser.addoption(
        "--num-runs", action="store", default=1, type=int, help="Number of times to run each test"
    )

def pytest_generate_tests(metafunc):
    n = metafunc.config.getoption("--num-runs")
    if n > 1:
        metafunc.fixturenames.append("_repeat_run")
        metafunc.parametrize("_repeat_run", range(n))

@pytest.fixture(scope="session")
def api_url():
    """Returns the base URL for the StreetReaderAI API."""
    return "http://localhost:5001/v1/streetreader"

from api_client import StreetReaderAPIClient

@pytest.fixture(scope="session")
def api_headers():
    """Returns the standard headers for API requests."""
    return {
        "Content-Type": "application/json"
    }

@pytest.fixture(scope="session")
def api_client(api_url):
    """Returns an initialized StreetReaderAPIClient."""
    return StreetReaderAPIClient(api_url)

import subprocess
import socket
import time
import shutil

def is_port_open(host="localhost", port=5001):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False

@pytest.fixture(scope="session", autouse=True)
def auto_start_server():
        
    if is_port_open(port=5001):
        print("\n[INFO] Backend server already running on port 5001.")
        yield
        return
        
    print("\n[INFO] Backend server not active. Auto-starting local server...")
    
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    
    log_file_path = os.path.join(root_dir, 'tests/server.log')
    log_file = open(log_file_path, 'w')
    
    uv_bin = shutil.which("uv")
    if uv_bin:
        cmd = [uv_bin, "run", "python", "-m", "server.index"]
    else:
        python_exec = os.path.join(root_dir, '.venv', 'bin', 'python')
        cmd = [python_exec, "-m", "server.index"]
    
    proc = subprocess.Popen(
        cmd,
        cwd=root_dir,
        stdout=log_file,
        stderr=log_file
    )
    
    started = False
    for _ in range(15):
        if is_port_open(port=5001):
            started = True
            break
        if proc.poll() is not None:
            log_file.close()
            with open(log_file_path, 'r') as lf:
                logs = lf.read()
            raise RuntimeError(
                f"Backend server failed to start: Exit code {proc.returncode}\n"
                f"Logs:\n{logs}"
            )
        time.sleep(1)
        
    if not started:
        proc.terminate()
        raise RuntimeError("Timeout: Backend server failed to respond on port 5001 within 15 seconds.")
        
    print("[INFO] Backend server auto-started and listening successfully!")
    
    try:
        yield
    finally:
        print("\n[INFO] Shutting down auto-started backend server...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        log_file.close()
        print("[INFO] Backend server process terminated.")


@pytest.fixture(autouse=True)
def reset_global_caches():
    from server.core.cache import image_cache, window_cache, road_cache, description_cache
    image_cache.clear()
    window_cache.clear()
    road_cache.clear()
    description_cache.clear()
    yield
