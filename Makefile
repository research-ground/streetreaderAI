# StreetReaderAI Makefile
# Orchestrates setup, building, serving, and testing the Angular SPA.

.PHONY: setup build start test check help

help:
	@echo "StreetReaderAI Management Commands:"
	@echo "  make setup - Install npm dependencies"
	@echo "  make start - Start the Angular development server on http://localhost:4200"
	@echo "  make build - Build the static Angular SPA into dist/StreetReaderAI/browser"
	@echo "  make test  - Run unit tests"

setup:
	npm install
	@echo "==> Setup complete. Run 'make start' and configure API keys in the First-Run / Settings dialog."

build:
	@echo "==> Building static Angular SPA into dist/..."
	npm run build

start:
	@echo "==> Starting Angular dev server on http://localhost:4200 ..."
	npm start

test:
	@echo "==> Running unit tests..."
	npm test -- --watch=false

check: test
