# StreetReaderAI Makefile
# Orchestrates setup, building, serving, and testing the Angular SPA.

.PHONY: setup build start test check make-for-aistudio help

help:
	@echo "StreetReaderAI Management Commands:"
	@echo "  make setup             - Install npm dependencies"
	@echo "  make start             - Start the Angular development server on http://localhost:4200"
	@echo "  make build             - Build the static Angular SPA into dist/StreetReaderAI/browser"
	@echo "  make test              - Run unit tests"
	@echo "  make make-for-aistudio - Create a clean zip of tracked files for Google AI Studio import"

setup:
	npm install
	@if [ ! -f models.conf ]; then cp models.conf.example models.conf && echo "==> Created models.conf from models.conf.example"; fi
	@if [ ! -f streetreaderai.conf ]; then cp streetreaderai.conf.example streetreaderai.conf && echo "==> Created streetreaderai.conf from streetreaderai.conf.example"; fi
	@echo "==> Setup complete. Edit models.conf to configure API keys and models, then run 'make start'."

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

make-for-aistudio:
	@echo "==> Creating clean archive streetreaderai-aistudio.zip for Google AI Studio..."
	git archive --format=zip --output=streetreaderai-aistudio.zip HEAD -- . ':!docs/screenshot.png'
	@ls -lh streetreaderai-aistudio.zip
