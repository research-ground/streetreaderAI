# StreetReaderAI Makefile
# Orchestrates setup, building, and testing.

.PHONY: setup build start start-panoramax docker-build docker-run test test-all check help

CLIENT_DIR = client

help:
	@echo "StreetReaderAI Management Commands:"
	@echo "  make setup           - Create config from example and install all dependencies"
	@echo "  make start           - Build client and start server on http://localhost:5001"
	@echo "  make start-panoramax - Build client and start with Panoramax imagery (no API keys needed)"
	@echo "  make docker-build    - Build the StreetReaderAI Docker image"
	@echo "  make docker-run      - Build and run StreetReaderAI via Docker Compose on port 5001"
	@echo "  make build           - Build the Angular client into client/dist"
	@echo "  make test            - Run offline test suite (server unit tests + client tests)"
	@echo "  make test-all        - Run full test pipeline (integration + browser tests)"

# --- Setup ---
setup:
	@test -f server/streetreaderai.conf || cp server/streetreaderai.conf.example server/streetreaderai.conf
	uv sync
	cd $(CLIENT_DIR) && npm install
	@echo "==> Setup complete. Edit server/streetreaderai.conf with your API keys if needed."

# --- Build & Run ---
build:
	@echo "==> Building client into $(CLIENT_DIR)/dist..."
	cd $(CLIENT_DIR) && npm run build

start: build
	@echo "==> Starting server on http://localhost:5001 ..."
	uv run python -m server.index

start-panoramax: build
	@echo "==> Starting server with Panoramax imagery (zero API keys required) on http://localhost:5001 ..."
	IMAGERY_PROVIDER=panoramax uv run python -m server.index

docker-build:
	docker build -t streetreaderai:latest .

docker-run:
	docker compose up --build

# --- Testing ---
test:
	@echo "==> Running server unit tests..."
	uv run pytest tests/unit/ -q
	@echo "==> Running client tests..."
	cd $(CLIENT_DIR) && npm test -- --watch=false
	@echo "==> All offline tests passed!"

check: test

test-all:
	@echo "==> Running full test pipeline..."
	uv run ./tests/run_all_tests.py
