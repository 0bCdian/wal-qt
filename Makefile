# wal-qt — CMake + embedded renderer + Go CLI (see README)
# Install layout mirrors wal-utauri: user PREFIX ~/.local or system /usr/local.

SHELL := /bin/bash

PREFIX ?= $(HOME)/.local
DESTDIR ?=
INSTALL_PREFIX_SYSTEM ?= /usr/local

BUILD_DIR ?= build
CMAKE_BUILD_TYPE ?= Release
JOBS ?= $(shell nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

APP_NAME := wal-qt-host
SOURCE_BINARY := $(BUILD_DIR)/$(APP_NAME)
CLI_BINARY := $(BUILD_DIR)/wal-qt

BIN_DIR ?= $(DESTDIR)$(PREFIX)/bin
DESKTOP_DIR ?= $(DESTDIR)$(PREFIX)/share/applications

# CMake finds LayerShellQt via its config package; these paths cover typical installs.
LAYER_SHELL_QT_CONFIG_CANDIDATES := \
	/usr/lib/cmake/LayerShellQt/LayerShellQtConfig.cmake \
	/usr/local/lib/cmake/LayerShellQt/LayerShellQtConfig.cmake \
	$(HOME)/.local/lib/cmake/LayerShellQt/LayerShellQtConfig.cmake

# Qt PipeWire: checked before configure (CMake still authoritative).
PKG_CONFIG_MODULES := \
	Qt6Core Qt6Gui Qt6Widgets Qt6WebEngineWidgets Qt6WebChannel Qt6Network Qt6Test \
	libpipewire-0.3

# Set SKIP_DEPS_CHECK=1 to skip toolchain / pkg-config probes (e.g. exotic Qt layouts).
SKIP_DEPS_CHECK ?=

.PHONY: help deps deps-check renderer build build-host build-cli clean \
	test test-host test-cli check openapi openapi-check \
	install uninstall install-system uninstall-system verify-binary verify-cli-binary

help:
	@echo "wal-qt — build and install (Qt6 WebEngine + LayerShellQt + PipeWire + Go CLI)"
	@echo ""
	@echo "Prereqs: CMake, C++17 compiler, pkg-config, Node.js + pnpm 11 (Corepack OK),"
	@echo "         Qt6 WebEngine, LayerShellQt, PipeWire dev, Go >= 1.26."
	@echo ""
	@echo "Build:"
	@echo "  make deps-check       Verify toolchain + pkg-config modules + LayerShellQt CMake package + Go"
	@echo "  make deps             pnpm install --frozen-lockfile in renderer/ + go mod download in cli/"
	@echo "  make renderer         pnpm run build in renderer/ (embed dist/ via qrc)"
	@echo "  make build-host       deps-check, deps, renderer, then CMake Release build → build/wal-qt-host"
	@echo "  make build-cli        deps-check, then go build → build/wal-qt"
	@echo "  make build            build-host then build-cli (default target)"
	@echo "  make openapi          Regenerate Go client from openapi/wal-qt.yaml via oapi-codegen"
	@echo "  make openapi-check    Verify generated client matches committed spec (for CI)"
	@echo "  make test             ctest (host tests) then go test ./... (CLI tests)"
	@echo "  make test-host        ctest only"
	@echo "  make test-cli         go test ./... in cli/ only"
	@echo "  make check            renderer lint + typecheck + tests + go vet + gofmt check"
	@echo "  make clean            rm build/"
	@echo ""
	@echo "Install:"
	@echo "  make install            Install both binaries + desktop to PREFIX (default: $(HOME)/.local)"
	@echo "  make uninstall          Remove user-local install"
	@echo "  make install-system     PREFIX=$(INSTALL_PREFIX_SYSTEM) (often needs sudo)"
	@echo "  make uninstall-system   Remove system install"
	@echo ""
	@echo "Variables: PREFIX DESTDIR BUILD_DIR CMAKE_BUILD_TYPE JOBS SKIP_DEPS_CHECK=1"

deps-check:
	@if [ -n "$(SKIP_DEPS_CHECK)" ]; then echo "deps-check skipped (SKIP_DEPS_CHECK=1)"; exit 0; fi
	@for cmd in cmake pkg-config node pnpm go; do \
		command -v $$cmd >/dev/null 2>&1 || { echo "Missing required command: $$cmd" >&2; exit 1; }; \
	done
	@if command -v c++ >/dev/null 2>&1; then :; \
	elif command -v g++ >/dev/null 2>&1; then :; \
	elif command -v clang++ >/dev/null 2>&1; then :; \
	else echo "No C++ compiler found (c++, g++, or clang++)" >&2; exit 1; fi
	@pkg-config --exists $(PKG_CONFIG_MODULES) || { \
		echo "Missing one or more pkg-config modules: $(PKG_CONFIG_MODULES)" >&2; \
		echo "Arch examples: qt6-base qt6-webengine qt6-webchannel pipewire layer-shell-qt" >&2; \
		exit 1; \
	}
	@layer_ok=0; \
	for f in $(LAYER_SHELL_QT_CONFIG_CANDIDATES); do \
		if [ -f "$$f" ]; then layer_ok=1; break; fi; \
	done; \
	if [ "$$layer_ok" -ne 1 ]; then \
		echo "Could not find LayerShellQtConfig.cmake in:" >&2; \
		for f in $(LAYER_SHELL_QT_CONFIG_CANDIDATES); do echo "  $$f" >&2; done; \
		echo "Install LayerShellQt (e.g. Arch: layer-shell-qt) or set CMAKE_PREFIX_PATH." >&2; \
		exit 1; \
	fi
	@go_version=$$(go version 2>/dev/null | grep -oP 'go\K[0-9]+\.[0-9]+'); \
	go_major=$$(echo "$$go_version" | cut -d. -f1); \
	go_minor=$$(echo "$$go_version" | cut -d. -f2); \
	if [ "$$go_major" -lt 1 ] || { [ "$$go_major" -eq 1 ] && [ "$$go_minor" -lt 26 ]; }; then \
		echo "Go >= 1.26 required, found: go$$go_version" >&2; exit 1; \
	fi
	@echo "deps-check: ok"

deps:
	cd renderer && pnpm install --frozen-lockfile
	cd cli && go mod download

renderer:
	cd renderer && pnpm run build

build-host: deps-check deps renderer
	cmake -B $(BUILD_DIR) -DCMAKE_BUILD_TYPE=$(CMAKE_BUILD_TYPE)
	cmake --build $(BUILD_DIR) -j$(JOBS)

build-cli: deps-check
	cd cli && go build -trimpath -ldflags="-s -w" -o ../$(BUILD_DIR)/wal-qt ./

build: build-host build-cli

openapi:
	cd cli && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen \
		--config=oapi-codegen.yaml \
		../openapi/wal-qt.yaml

openapi-check: openapi openapi-coverage
	@if ! git diff --exit-code -- cli/internal/client/client.gen.go openapi/wal-qt.yaml; then \
		echo "" >&2; \
		echo "openapi-check: generated client or spec drifted from committed files." >&2; \
		echo "Run 'make openapi' and commit the result." >&2; \
		exit 1; \
	fi
	@echo "openapi-check: ok (no drift)"

# Asserts every JSON field the renderer (TS) and host (C++) read off a
# LoadRequest is documented in the OpenAPI spec. Catches the silent-drop
# regression where a missing spec field causes the engine's generated client
# to omit it on the wire.
openapi-coverage:
	@python3 scripts/check-spec-coverage.py

clean:
	rm -rf $(BUILD_DIR)

test-host:
	ctest --test-dir $(BUILD_DIR) --output-on-failure

test-cli:
	cd cli && go test ./...

test: test-host test-cli

check:
	cd renderer && pnpm run check:all:strict
	cd cli && go vet ./...
	@dirty=$$(gofmt -l cli/); \
	if [ -n "$$dirty" ]; then \
		echo "gofmt: the following files need formatting (run: gofmt -w <file>):" >&2; \
		echo "$$dirty" >&2; \
		exit 1; \
	fi
	@echo "check: ok"

verify-binary:
	@test -f "$(SOURCE_BINARY)" || (echo "Missing $(SOURCE_BINARY). Run: make build" >&2 && exit 1)

verify-cli-binary:
	@test -f "$(CLI_BINARY)" || (echo "Missing $(CLI_BINARY). Run: make build" >&2 && exit 1)

install: verify-binary verify-cli-binary
	install -dm755 "$(BIN_DIR)" "$(DESKTOP_DIR)"
	install -Dm755 "$(SOURCE_BINARY)" "$(BIN_DIR)/$(APP_NAME)"
	install -Dm755 "$(CLI_BINARY)" "$(BIN_DIR)/wal-qt"
	printf '%s\n' \
		'[Desktop Entry]' \
		'Type=Application' \
		'Name=wal-qt-host' \
		'GenericName=Wayland Wallpaper Host' \
		'Comment=Qt6 WebEngine wallpaper host (Wayland layer-shell)' \
		'Exec=wal-qt-host' \
		'Categories=Graphics;Utility;' \
		'Terminal=false' \
		'StartupNotify=false' \
		'Keywords=wallpaper;wayland;waypaper;' | \
		install -Dm644 /dev/stdin "$(DESKTOP_DIR)/wal-qt-host.desktop"

uninstall:
	rm -f "$(BIN_DIR)/$(APP_NAME)"
	rm -f "$(BIN_DIR)/wal-qt"
	rm -f "$(DESKTOP_DIR)/wal-qt-host.desktop"

install-system:
	$(MAKE) install PREFIX="$(INSTALL_PREFIX_SYSTEM)"

uninstall-system:
	$(MAKE) uninstall PREFIX="$(INSTALL_PREFIX_SYSTEM)"
