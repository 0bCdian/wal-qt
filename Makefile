# wal-qt — CMake + embedded renderer (see README)
# Install layout mirrors wal-utauri: user PREFIX ~/.local or system /usr/local.

SHELL := /bin/bash

PREFIX ?= $(HOME)/.local
DESTDIR ?=
INSTALL_PREFIX_SYSTEM ?= /usr/local

BUILD_DIR ?= build
CMAKE_BUILD_TYPE ?= Release
JOBS ?= $(shell nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

APP_NAME := wal-qt
SOURCE_BINARY := $(BUILD_DIR)/$(APP_NAME)

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

.PHONY: help deps deps-check renderer build clean test check \
	install uninstall install-system uninstall-system verify-binary

help:
	@echo "wal-qt — build and install (Qt6 WebEngine + LayerShellQt + PipeWire)"
	@echo ""
	@echo "Prereqs: CMake, C++17 compiler, pkg-config, Node/npm, Qt6 WebEngine, LayerShellQt, PipeWire dev."
	@echo ""
	@echo "Build:"
	@echo "  make deps-check       Verify toolchain + pkg-config modules + LayerShellQt CMake package"
	@echo "  make deps             npm ci in renderer/"
	@echo "  make renderer         npm run build in renderer/ (embed dist/ via qrc)"
	@echo "  make build            deps-check, deps, renderer, then CMake Release build"
	@echo "  make test             ctest (after build)"
	@echo "  make check            renderer lint + typecheck + tests (npm run check:all:strict)"
	@echo "  make clean            rm build/"
	@echo ""
	@echo "Install:"
	@echo "  make install            Install binary + desktop to PREFIX (default: $(HOME)/.local)"
	@echo "  make uninstall          Remove user-local install"
	@echo "  make install-system     PREFIX=$(INSTALL_PREFIX_SYSTEM) (often needs sudo)"
	@echo "  make uninstall-system   Remove system install"
	@echo ""
	@echo "Variables: PREFIX DESTDIR BUILD_DIR CMAKE_BUILD_TYPE JOBS SKIP_DEPS_CHECK=1"

deps-check:
	@if [ -n "$(SKIP_DEPS_CHECK)" ]; then echo "deps-check skipped (SKIP_DEPS_CHECK=1)"; exit 0; fi
	@for cmd in cmake pkg-config node npm; do \
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
	@echo "deps-check: ok"

deps:
	cd renderer && npm ci

renderer:
	cd renderer && npm run build

build: deps-check deps renderer
	cmake -B $(BUILD_DIR) -DCMAKE_BUILD_TYPE=$(CMAKE_BUILD_TYPE)
	cmake --build $(BUILD_DIR) -j$(JOBS)

clean:
	rm -rf $(BUILD_DIR)

test:
	ctest --test-dir $(BUILD_DIR) --output-on-failure

check:
	cd renderer && npm run check:all:strict

verify-binary:
	@test -f "$(SOURCE_BINARY)" || (echo "Missing $(SOURCE_BINARY). Run: make build" >&2 && exit 1)

install: verify-binary
	install -dm755 "$(BIN_DIR)" "$(DESKTOP_DIR)"
	install -Dm755 "$(SOURCE_BINARY)" "$(BIN_DIR)/$(APP_NAME)"
	printf '%s\n' \
		'[Desktop Entry]' \
		'Type=Application' \
		'Name=wal-qt' \
		'GenericName=Wayland Wallpaper Host' \
		'Comment=Qt6 WebEngine wallpaper host (Wayland layer-shell)' \
		'Exec=wal-qt' \
		'Categories=Graphics;Utility;' \
		'Terminal=false' \
		'StartupNotify=false' \
		'Keywords=wallpaper;wayland;waypaper;' | \
		install -Dm644 /dev/stdin "$(DESKTOP_DIR)/wal-qt.desktop"

uninstall:
	rm -f "$(BIN_DIR)/$(APP_NAME)"
	rm -f "$(DESKTOP_DIR)/wal-qt.desktop"

install-system:
	$(MAKE) install PREFIX="$(INSTALL_PREFIX_SYSTEM)"

uninstall-system:
	$(MAKE) uninstall PREFIX="$(INSTALL_PREFIX_SYSTEM)"
