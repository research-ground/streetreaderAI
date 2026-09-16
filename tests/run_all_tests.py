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

import subprocess
import time
import os
import sys
import shutil

# ANSI escape sequences for premium visual terminal colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def print_header(title):
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN}>>> {title}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}\n")

def run_stage(name, command, cwd, log_file=None):
    print(f"{BOLD}Starting Stage: {name}...{RESET}")
    start_time = time.time()
    
    # Ensure stdout/stderr are routed properly (and saved to log file if requested)
    if log_file:
        with open(log_file, "w") as lf:
            proc = subprocess.run(command, shell=True, cwd=cwd, stdout=lf, stderr=lf)
    else:
        proc = subprocess.run(command, shell=True, cwd=cwd)
        
    duration = time.time() - start_time
    status = proc.returncode
    
    if status == 0:
        print(f"{GREEN}✔ Stage '{name}' completed successfully in {duration:.2f}s!{RESET}\n")
        return "PASS", duration
    else:
        print(f"{RED}✘ Stage '{name}' FAILED with exit code {status} in {duration:.2f}s!{RESET}")
        if log_file:
            print(f"{YELLOW}   ↳ Check raw logs at: file://{os.path.abspath(log_file)}{RESET}\n")
        return "FAIL", duration

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    dist_tests_dir = os.path.join(root_dir, "dist", "tests")
    os.makedirs(dist_tests_dir, exist_ok=True)
    
    # Initialize stages summaries
    summary = []
    
    print_header("STREETREADERAI MASTER HARNESS RUNNER")
    
    # ==========================================
    python_cmd = "uv run" if shutil.which("uv") else ".venv/bin/python"

    # ==========================================
    # STAGE 1: Pre-flight configuration gate
    # ==========================================
    print_header("STAGE 1: Pre-flight Keys & Environment Check")
    status_1, duration_1 = run_stage(
        "Pre-flight Config Check",
        f"{python_cmd} tests/pre_flight_check.py",
        root_dir
    )
    summary.append(("1. Pre-flight Config Check", status_1, duration_1, "stdout"))
    
    if status_1 != "PASS":
        print(f"{RED}{BOLD}✘ Early Gate Termination: Pre-flight check failed! Please configure server/streetreaderai.conf with valid credentials.{RESET}")
        sys.exit(1)
        
    # ==========================================
    # STAGE 2: Standalone Math & Crops Unit Logic
    # ==========================================
    print_header("STAGE 2: Math & PIL Cylindrical Crops Unit Tests")
    log_2 = os.path.join(dist_tests_dir, "stage_2_unit.log")
    status_2, duration_2 = run_stage(
        "Unit Tests (Math & Crops)",
        f"{python_cmd} pytest tests/unit/ -v --junitxml={os.path.join(dist_tests_dir, 'junit_unit.xml')}",
        root_dir,
        log_file=log_2
    )
    summary.append(("2. Math & Crops Unit Tests", status_2, duration_2, log_2))
    
    # ==========================================
    # STAGE 3: Local Live endpoints Integration Checks
    # ==========================================
    print_header("STAGE 3: Local Backend Live Endpoints Integration Suite")
    log_3 = os.path.join(dist_tests_dir, "stage_3_local_integration.log")
    status_3, duration_3 = run_stage(
        "Local Live API Integration",
        f"{python_cmd} pytest tests/integration/ -v --junitxml={os.path.join(dist_tests_dir, 'junit_local_integration.xml')}",
        root_dir,
        log_file=log_3
    )
    summary.append(("3. Local Live API Integration", status_3, duration_3, log_3))
    

    # ==========================================
    # STAGE 4: Playwright Accessibility & UI E2E
    # ==========================================
    print_header("STAGE 4: Playwright Accessibility, Settings, & UI E2E")
    log_4 = os.path.join(dist_tests_dir, "stage_4_browser_e2e.log")
    status_4, duration_4 = run_stage(
        "Playwright Browser Accessibility UI",
        f"{python_cmd} pytest tests/e2e/ -v --junitxml={os.path.join(dist_tests_dir, 'junit_browser_e2e.xml')}",
        root_dir,
        log_file=log_4
    )
    summary.append(("4. Playwright Browser E2E", status_4, duration_4, log_4))
    
    # ==========================================
    # FINAL DASHBOARD REPORT GENERATION
    # ==========================================
    print_header("STREETREADERAI SYSTEM TESTS EXECUTION SUMMARY")
    
    print(f"{BOLD}{'Stage Name':<35} | {'Status':<8} | {'Duration':<9} | {'Reports/Logs Links'}{RESET}")
    print("-" * 100)
    
    any_failed = False
    total_duration = 0
    
    for name, status, duration, log_path in summary:
        total_duration += duration
        if status == "PASS":
            status_str = f"{GREEN}{BOLD}PASS ✔{RESET}"
        else:
            status_str = f"{RED}{BOLD}FAIL ✘{RESET}"
            any_failed = True
            
        report_link = f"file://{os.path.abspath(log_path)}" if log_path != "stdout" else "Console standard output"
        print(f"{name:<35} | {status_str:<8} | {duration:>7.2f}s | {report_link}")
        
    print("-" * 100)
    print(f"{BOLD}Total Combined Duration:{RESET} {total_duration:.2f}s")
    print(f"{BOLD}JUnit XML Test Reports Exported To:{RESET} file://{dist_tests_dir}/")
    
    if any_failed:
        print(f"\n{RED}{BOLD}✘ MASTER PIPELINE RUN STATUS: FAILED (One or more stages failed. Please check the reports links listed above.){RESET}\n")
        sys.exit(1)
    else:
        print(f"\n{GREEN}{BOLD}✔ MASTER PIPELINE RUN STATUS: ALL STAGES PASSED SUCCESSFUL!{RESET}\n")
        sys.exit(0)

if __name__ == "__main__":
    main()
