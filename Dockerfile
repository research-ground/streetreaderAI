# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# --- Stage 1: Build the Angular Frontend ---
FROM node:22-slim AS client-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Stage 2: Python Backend + Static SPA Server ---
FROM python:3.12-slim AS runtime

# Install uv for fast, reproducible Python dependency installation
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install Python dependencies from lockfile
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev

# Copy backend source, configuration template, and API reference docs
COPY server/ ./server/
COPY docs/ ./docs/

# Copy compiled Angular SPA from Stage 1
COPY --from=client-build /app/client/dist/StreetReaderAI/browser ./client/dist/StreetReaderAI/browser

# Prepare cache and log directories
RUN mkdir -p /app/server/.cache /app/logs

EXPOSE 5001

ENV HOST=0.0.0.0
ENV PORT=5001

# Run with 1 worker and 4 threads so the in-memory AreaSnapshot cache is shared across requests
CMD ["uv", "run", "gunicorn", "-w", "1", "--threads", "4", "--timeout", "120", "-b", "0.0.0.0:5001", "server.index:app"]
