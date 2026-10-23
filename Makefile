# StreetReaderAI Makefile
# Orchestrates setup, building, serving, and testing the client-only Angular SPA.

.PHONY: setup build start test check help

CLIENT_DIR = client

help:
	@echo "StreetReaderAI Management Commands:"
	@echo "  make setup - Install client npm dependencies"
	@echo "  make start - Start the Angular development server on http://localhost:4200"
	@echo "  make build - Build the static Angular SPA into client/dist/StreetReaderAI/browser"
	@echo "  make test  - Run client unit tests"

setup:
	cd $(CLIENT_DIR) && npm install
	@echo "==> Setup complete. Run 'make start' and configure API keys in the Settings dialog."

build:
	@echo "==> Building static Angular SPA into $(CLIENT_DIR)/dist..."
	cd $(CLIENT_DIR) && npm run build

start:
	@echo "==> Starting Angular dev server on http://localhost:4200 ..."
	cd $(CLIENT_DIR) && npm start

test:
	@echo "==> Running client unit tests..."
	cd $(CLIENT_DIR) && npm test -- --watch=false

check: test
