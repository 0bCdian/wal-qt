# wal-qt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Authoritative spec:** [/home/obsy/dev/waypaper/wal-qt.md](../../../../wal-qt.md). When in doubt, the spec wins; this plan operationalises it.

**Goal:** Build `wal-qt` — a C++/Qt6 Wayland wallpaper host that serves the existing `wayland-utauri` HTTP API over a Unix socket, places one full-screen `QWebEngineView` per output on the `zwlr_layer_shell_v1` background layer, and runs a ported version of the wal-utauri TypeScript renderer SPA via `QWebChannel`. Drop-in replacement for the wal-utauri Tauri backend — **the Go daemon does not change**.

**Architecture:** Two-process: Go daemon (unchanged) ⇄ HTTP/1.1 over `$XDG_RUNTIME_DIR/wayland-utauri.sock` ⇄ `wal-qt` C++ binary. `wal-qt` runs `QApplication` with one `WallpaperWindow` per `QScreen`, each carrying a `QWebEngineView` configured as a `LayerShellQt` background-layer surface. JS↔C++ uses `QWebChannel`; HTML wallpaper assets are served via a custom `waypaperhtml://` scheme handler with canonicalised path sandboxing; network is gated by `QWebEngineUrlRequestInterceptor`.

**Tech Stack:** C++17, Qt 6 (Core, Gui, Widgets, WebEngineWidgets, WebChannel, Network, Test), `LayerShellQt` (`layer-shell-qt`), CMake ≥ 3.16. Renderer ported from `wal-utauri/src/renderer/` (TypeScript + Vite + GSAP, vitest for tests).

**Working directory:** `/home/obsy/dev/waypaper/wal-qt/` (new repo). Reference repo: `/home/obsy/dev/waypaper/wal-utauri/` (renderer source). Reference repo: `/home/obsy/dev/waypaper/waypaper-engine/daemon/internal/backend/waylandutauri/` (HTTP contract; do **not** modify).

---

## Conventions for every task

- **TDD where feasible.** Pure logic (HTTP parser, path resolver, manifest parser, allowlist matching) → write a `QTest` first, watch it fail, implement, watch it pass, commit. GUI/Wayland integration (LayerShellQt placement, QWebEngineView rendering) is verified manually with the commands in §§3.2 and 20 of the spec.
- **Commit cadence:** one commit per task (test + implementation together when test-driven, or feature + manual verify note otherwise). Conventional Commits style: `feat:`, `test:`, `chore:`, `docs:`, `fix:`.
- **No placeholders, no TODOs in committed code** except the explicit stub called out in Task 25 (audio-reactive capture).
- **File ownership:** every file is created by exactly one task and modified by named later tasks only.
- **Coding style:** `clang-format` with the bundled `.clang-format` (Task 1 creates it). Header guards via `#pragma once`. `Q_OBJECT` in any class with signals/slots/`Q_INVOKABLE`. Use `QString`/`QByteArray`/`QJsonDocument` — never raw `char*` arithmetic on socket bytes (spec §22.2).
- **Build commands run from repo root** unless stated.

---

## File structure (locked in before tasks)

```
wal-qt/
├── .clang-format
├── .gitignore
├── CMakeLists.txt
├── README.md
├── src/
│   ├── main.cpp
│   ├── app/
│   │   ├── app.h / app.cpp                       — QApplication owner, screen topology, wires controller+http
│   │   └── single_instance.h / single_instance.cpp — QLockFile wrapper
│   ├── http/
│   │   ├── http_request.h                         — POD struct
│   │   ├── http_server.h / http_server.cpp        — QLocalServer + per-connection HTTP/1.1 parser
│   │   └── http_responder.h                       — std::function alias + helpers
│   ├── wallpaper/
│   │   ├── wallpaper_controller.h / .cpp          — route dispatch, wait_for_completion bookkeeping
│   │   ├── wallpaper_window.h / .cpp              — per-screen QWidget host of QWebEngineView + LayerShellQt config
│   │   ├── wallpaper_bridge.h / .cpp              — QWebChannel QObject (signals to JS, slots from JS)
│   │   ├── pending_load.h / .cpp                  — multi-monitor ack aggregator with timeout
│   │   └── target_resolver.h / .cpp               — waypaper.json / index.html / directory resolution + manifest parser
│   ├── web/
│   │   ├── scheme_handler.h / .cpp                — waypaperhtml:// QWebEngineUrlSchemeHandler
│   │   ├── network_interceptor.h / .cpp           — QWebEngineUrlRequestInterceptor
│   │   └── csp_injector.h / .cpp                  — meta-tag CSP user script builder
│   └── util/
│       ├── socket_path.h / .cpp                   — XDG_RUNTIME_DIR resolution
│       └── mime.h / .cpp                          — extension → mime
├── tests/
│   ├── CMakeLists.txt
│   ├── test_http_parser.cpp
│   ├── test_target_resolver.cpp
│   ├── test_scheme_handler_paths.cpp
│   ├── test_network_interceptor.cpp
│   ├── test_socket_path.cpp
│   ├── test_pending_load.cpp
│   └── fixtures/
│       ├── pkg_with_manifest/                    (waypaper.json + index.html)
│       ├── pkg_html_only/                        (index.html, no manifest)
│       ├── pkg_directory_only/                   (no index.html → resolver should fall back)
│       └── malicious_path_traversal/             (symlink escaping root)
├── renderer/                                      — ported wal-utauri SPA (Task 26+)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── styles.css
│   │   └── renderer/                              — copied from wal-utauri/src/renderer/
│   └── dist/                                      — build output (gitignored, embedded as Qt resource at build time)
└── docs/
    └── superpowers/plans/2026-05-07-wal-qt-bootstrap.md   (this file)
```

---

# Phase 0 — Repo bootstrap

### Task 1: Initialise repo and tooling files

**Files:**
- Create: `/home/obsy/dev/waypaper/wal-qt/.gitignore`
- Create: `/home/obsy/dev/waypaper/wal-qt/.clang-format`
- Create: `/home/obsy/dev/waypaper/wal-qt/README.md`

- [ ] **Step 1: `git init`**

```bash
cd /home/obsy/dev/waypaper/wal-qt && git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```
build/
build-*/
.cache/
compile_commands.json
renderer/node_modules/
renderer/dist/
*.qrc.depends
*.user
.vscode/
```

- [ ] **Step 3: Write `.clang-format`**

```
BasedOnStyle: LLVM
IndentWidth: 4
ColumnLimit: 100
PointerAlignment: Left
AccessModifierOffset: -4
AllowShortFunctionsOnASingleLine: Inline
```

- [ ] **Step 4: Write `README.md`** — one paragraph describing wal-qt + a pointer to `wal-qt.md` and this plan. No marketing copy.

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "chore: initialise wal-qt repo with formatting + gitignore"
```

---

### Task 2: Top-level `CMakeLists.txt` skeleton

**Files:**
- Create: `/home/obsy/dev/waypaper/wal-qt/CMakeLists.txt`

- [ ] **Step 1: Write the CMake file** (uses spec §2 plus extra modules we need)

```cmake
cmake_minimum_required(VERSION 3.16)
project(wal-qt VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(WAL_QT_BUILD_TESTS "Build wal-qt unit tests" ON)

find_package(Qt6 REQUIRED COMPONENTS
    Core Gui Widgets WebEngineWidgets WebChannel Network Test)
find_package(LayerShellQt REQUIRED)

add_library(wal_qt_lib STATIC) # populated by add_subdirectory below
target_include_directories(wal_qt_lib PUBLIC src)
target_link_libraries(wal_qt_lib PUBLIC
    Qt6::Core Qt6::Gui Qt6::Widgets
    Qt6::WebEngineWidgets Qt6::WebChannel Qt6::Network
    LayerShellQt::Interface)

add_subdirectory(src)

add_executable(wal-qt src/main.cpp)
target_link_libraries(wal-qt PRIVATE wal_qt_lib)

if(WAL_QT_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
```

- [ ] **Step 2: Create the empty `src/CMakeLists.txt`**

```cmake
target_sources(wal_qt_lib PRIVATE
    # populated by later tasks
)
```

- [ ] **Step 3: Create empty `src/main.cpp` stub** so configure succeeds:

```cpp
#include <QCoreApplication>
int main(int argc, char *argv[]) { QCoreApplication a(argc, argv); return 0; }
```

- [ ] **Step 4: Create empty `tests/CMakeLists.txt`** — single comment line `# populated by Phase 1+`.

- [ ] **Step 5: Configure & build to prove the toolchain is wired**

```bash
cd /home/obsy/dev/waypaper/wal-qt && cmake -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build -j
```

Expected: builds a no-op `wal-qt` binary with no errors. If `LayerShellQt` is missing: `sudo pacman -S layer-shell-qt qt6-webengine qt6-webchannel`.

- [ ] **Step 6: Commit**

```bash
git add CMakeLists.txt src/CMakeLists.txt src/main.cpp tests/CMakeLists.txt && \
git commit -m "chore: cmake skeleton with Qt6 + LayerShellQt"
```

---

# Phase 1 — Pure utilities (TDD)

### Task 3: `socket_path` resolver — TDD

**Files:**
- Create: `src/util/socket_path.h`
- Create: `src/util/socket_path.cpp`
- Create: `tests/test_socket_path.cpp`
- Modify: `src/CMakeLists.txt` (add sources)
- Modify: `tests/CMakeLists.txt` (add test target)

- [ ] **Step 1: Write the failing test** in `tests/test_socket_path.cpp`

```cpp
#include <QtTest/QtTest>
#include "util/socket_path.h"

class TestSocketPath : public QObject {
    Q_OBJECT
private slots:
    void prefersXdgRuntimeDir() {
        qputenv("XDG_RUNTIME_DIR", "/run/user/1000");
        QCOMPARE(walqt::socketPath(), QString("/run/user/1000/wayland-utauri.sock"));
        QCOMPARE(walqt::lockPath(),   QString("/run/user/1000/wayland-utauri.lock"));
    }
    void fallsBackToTmp() {
        qunsetenv("XDG_RUNTIME_DIR");
        QVERIFY(walqt::socketPath().endsWith("/wayland-utauri.sock"));
    }
};
QTEST_GUILESS_MAIN(TestSocketPath)
#include "test_socket_path.moc"
```

- [ ] **Step 2: Append to `tests/CMakeLists.txt`**

```cmake
function(walqt_add_test NAME)
    add_executable(${NAME} ${NAME}.cpp)
    target_link_libraries(${NAME} PRIVATE wal_qt_lib Qt6::Test)
    add_test(NAME ${NAME} COMMAND ${NAME})
endfunction()

walqt_add_test(test_socket_path)
```

- [ ] **Step 3: Add stub header `src/util/socket_path.h`**

```cpp
#pragma once
#include <QString>
namespace walqt {
QString socketPath();
QString lockPath();
}
```

- [ ] **Step 4: Add empty `src/util/socket_path.cpp`** that returns `QString{}` so it links but the test fails.

- [ ] **Step 5: Append to `src/CMakeLists.txt`**

```cmake
target_sources(wal_qt_lib PRIVATE
    util/socket_path.cpp
)
```

- [ ] **Step 6: Build & run, expect FAIL**

```bash
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_socket_path
```

- [ ] **Step 7: Implement** in `src/util/socket_path.cpp`

```cpp
#include "util/socket_path.h"
#include <QDir>
namespace walqt {
static QString base() {
    QString r = qEnvironmentVariable("XDG_RUNTIME_DIR");
    return r.isEmpty() ? QDir::tempPath() : r;
}
QString socketPath() { return base() + "/wayland-utauri.sock"; }
QString lockPath()   { return base() + "/wayland-utauri.lock"; }
}
```

- [ ] **Step 8: Build & re-run, expect PASS**

- [ ] **Step 9: Commit**

```bash
git add src/util tests/test_socket_path.cpp tests/CMakeLists.txt src/CMakeLists.txt && \
git commit -m "feat(util): socket and lock path resolution with XDG fallback"
```

---

### Task 4: `mime` lookup — TDD

**Files:**
- Create: `src/util/mime.h`, `src/util/mime.cpp`
- Create: `tests/test_mime.cpp`
- Modify: `src/CMakeLists.txt`, `tests/CMakeLists.txt`

- [ ] **Step 1: Write the test** mirroring the table in spec §9.2:

```cpp
#include <QtTest/QtTest>
#include "util/mime.h"
class TestMime : public QObject { Q_OBJECT
private slots:
    void knownTypes_data() {
        QTest::addColumn<QString>("path"); QTest::addColumn<QByteArray>("mime");
        QTest::newRow("html") << "x.html" << QByteArray("text/html");
        QTest::newRow("js")   << "x.js"   << QByteArray("application/javascript");
        QTest::newRow("css")  << "a/b.css"<< QByteArray("text/css");
        QTest::newRow("json") << "m.json" << QByteArray("application/json");
        QTest::newRow("png")  << "i.png"  << QByteArray("image/png");
        QTest::newRow("jpg")  << "i.jpg"  << QByteArray("image/jpeg");
        QTest::newRow("jpeg") << "i.jpeg" << QByteArray("image/jpeg");
        QTest::newRow("mp4")  << "v.mp4"  << QByteArray("video/mp4");
        QTest::newRow("webm") << "v.webm" << QByteArray("video/webm");
        QTest::newRow("wasm") << "m.wasm" << QByteArray("application/wasm");
        QTest::newRow("unk")  << "x.zzz"  << QByteArray("application/octet-stream");
    }
    void knownTypes() { QFETCH(QString,path); QFETCH(QByteArray,mime);
        QCOMPARE(walqt::mimeForPath(path), mime); }
};
QTEST_GUILESS_MAIN(TestMime)
#include "test_mime.moc"
```

- [ ] **Step 2: Register test** — append `walqt_add_test(test_mime)` to `tests/CMakeLists.txt`.

- [ ] **Step 3: Stub header** `src/util/mime.h`:

```cpp
#pragma once
#include <QByteArray>
#include <QString>
namespace walqt { QByteArray mimeForPath(const QString &path); }
```

- [ ] **Step 4: Stub cpp** returning `"application/octet-stream"`. Add to `src/CMakeLists.txt`. Build, run test → FAIL.

- [ ] **Step 5: Implement** body verbatim from spec §9.2 `mimeTypeForPath`.

- [ ] **Step 6: Build, run → PASS, commit**

```bash
git commit -am "feat(util): mime type lookup by extension"
```

---

# Phase 2 — HTTP server (TDD parser, integration server)

### Task 5: HTTP request parser — TDD

The parser is a pure function on `QByteArray` so we can test it without any sockets.

**Files:**
- Create: `src/http/http_request.h`
- Create: `src/http/http_parser.h`, `src/http/http_parser.cpp`
- Create: `tests/test_http_parser.cpp`

- [ ] **Step 1: Define the POD** in `src/http/http_request.h`:

```cpp
#pragma once
#include <QByteArray>
#include <QString>
namespace walqt {
struct HttpRequest {
    QString method;     // "GET" / "POST"
    QString path;       // "/wallpaper/load"
    QByteArray body;    // raw bytes
};
enum class ParseStatus { NeedMore, Done, BadRequest, TooLarge };
}
```

- [ ] **Step 2: Header for the parser** `src/http/http_parser.h`:

```cpp
#pragma once
#include "http_request.h"
namespace walqt {
// Incremental parser. Feed bytes via consume(); when status == Done, request() is filled
// and bytesConsumed() tells how many bytes were used (rest is leftover for the next req).
class HttpParser {
public:
    static constexpr int kMaxHeaderBytes = 16 * 1024;
    static constexpr int kMaxBodyBytes   = 4 * 1024 * 1024;

    ParseStatus consume(const QByteArray &incoming);
    const HttpRequest &request() const { return req_; }
    int bytesConsumed() const { return consumed_; }
    void reset();

private:
    QByteArray buf_;
    HttpRequest req_;
    int consumed_ = 0;
    int contentLength_ = -1;
    bool headersDone_ = false;
};
}
```

- [ ] **Step 3: Write tests** — eight cases:

```cpp
#include <QtTest/QtTest>
#include "http/http_parser.h"
using namespace walqt;
class TestHttpParser : public QObject { Q_OBJECT
private slots:
    void getNoBody() {
        HttpParser p;
        QCOMPARE(p.consume("GET /health HTTP/1.1\r\nHost: x\r\n\r\n"), ParseStatus::Done);
        QCOMPARE(p.request().method, QString("GET"));
        QCOMPARE(p.request().path,   QString("/health"));
        QCOMPARE(p.request().body.size(), 0);
    }
    void postWithJsonBody() {
        QByteArray b = "POST /wallpaper/load HTTP/1.1\r\n"
                       "Content-Type: application/json\r\n"
                       "Content-Length: 13\r\n\r\n"
                       "{\"ok\":true}\r\n";
        HttpParser p;
        QCOMPARE(p.consume(b), ParseStatus::Done);
        QCOMPARE(p.request().path, QString("/wallpaper/load"));
        QCOMPARE(p.request().body, QByteArray("{\"ok\":true}\r\n"));
    }
    void splitAcrossChunks() {
        HttpParser p;
        QCOMPARE(p.consume("POST /x HTTP/1.1\r\nContent-Length: 5"),
                 ParseStatus::NeedMore);
        QCOMPARE(p.consume("\r\n\r\nhel"), ParseStatus::NeedMore);
        QCOMPARE(p.consume("lo"), ParseStatus::Done);
        QCOMPARE(p.request().body, QByteArray("hello"));
    }
    void missingContentLengthOnPostMeansZero() {
        HttpParser p;
        QCOMPARE(p.consume("POST /x HTTP/1.1\r\n\r\n"), ParseStatus::Done);
        QCOMPARE(p.request().body.size(), 0);
    }
    void rejectsHugeHeader() {
        HttpParser p;
        QByteArray big(HttpParser::kMaxHeaderBytes + 1, 'A');
        QCOMPARE(p.consume(big), ParseStatus::TooLarge);
    }
    void rejectsHugeBody() {
        HttpParser p;
        QByteArray h = "POST /x HTTP/1.1\r\nContent-Length: 999999999\r\n\r\n";
        QCOMPARE(p.consume(h), ParseStatus::TooLarge);
    }
    void rejectsMalformedRequestLine() {
        HttpParser p;
        QCOMPARE(p.consume("GARBAGE\r\n\r\n"), ParseStatus::BadRequest);
    }
    void caseInsensitiveHeader() {
        HttpParser p;
        QByteArray b = "POST /x HTTP/1.1\r\ncoNTent-LENgth: 2\r\n\r\nhi";
        QCOMPARE(p.consume(b), ParseStatus::Done);
        QCOMPARE(p.request().body, QByteArray("hi"));
    }
};
QTEST_GUILESS_MAIN(TestHttpParser)
#include "test_http_parser.moc"
```

- [ ] **Step 4: Add sources + test target.** `src/CMakeLists.txt` += `http/http_parser.cpp`. `tests/CMakeLists.txt` += `walqt_add_test(test_http_parser)`.

- [ ] **Step 5: Stub `http_parser.cpp`** that returns `ParseStatus::BadRequest`. Build, run → FAIL on every case.

- [ ] **Step 6: Implement** the parser. Algorithm (write this in `consume`):
  1. Append `incoming` to `buf_`. If `buf_.size() > kMaxHeaderBytes` and `!headersDone_` → `TooLarge`.
  2. If `!headersDone_`: locate `"\r\n\r\n"`. If absent → `NeedMore`.
  3. Parse the request line: `QList<QByteArray> parts = firstLine.split(' ');` — require exactly 3 parts and `parts[2].startsWith("HTTP/")`. Else `BadRequest`. `req_.method = QString::fromLatin1(parts[0]); req_.path = QString::fromUtf8(parts[1]);`.
  4. Walk header lines: split on first `:`, trim, lowercase the name. If name == `"content-length"` parse to int (`bool ok; long n = value.toLong(&ok)`). If `!ok || n < 0 || n > kMaxBodyBytes` → `TooLarge` (or `BadRequest`).
  5. Set `contentLength_` (default 0 if absent), `headersDone_ = true`, drop the headers from `buf_`.
  6. If `buf_.size() < contentLength_` → `NeedMore`.
  7. `req_.body = buf_.left(contentLength_); consumed_ = headerBytes + contentLength_;` → `Done`.

- [ ] **Step 7: Build & run, expect 8 PASS, commit**

```bash
git commit -am "feat(http): incremental request parser with size guards"
```

---

### Task 6: `HttpServer` over `QLocalServer`

**Files:**
- Create: `src/http/http_server.h`, `src/http/http_server.cpp`

This task is integration plumbing — manual verify with `curl`. No new unit test (parser is already covered).

- [ ] **Step 1: Write the header**

```cpp
#pragma once
#include <QObject>
#include <QLocalServer>
#include <QHash>
#include <functional>
#include "http_request.h"
class QLocalSocket;
namespace walqt {
using HttpResponder = std::function<void(int status, const QByteArray &jsonBody)>;
class HttpServer : public QObject {
    Q_OBJECT
public:
    explicit HttpServer(QString socketPath, QObject *parent = nullptr);
    bool listen();   // true on success
signals:
    void requestReceived(walqt::HttpRequest req, walqt::HttpResponder responder);
private slots:
    void onNewConnection();
    void onReadyRead();
    void onDisconnected();
private:
    QString socketPath_;
    QLocalServer server_;
    struct Conn { class HttpParser *parser; QByteArray buf; };
    QHash<QLocalSocket*, Conn*> conns_;
    void writeResponse(QLocalSocket *s, int status, const QByteArray &body);
};
}
```

- [ ] **Step 2: Implement** in `http_server.cpp`:
  - `listen()`: `QFile::remove(socketPath_)`; `server_.listen(socketPath_)`. After success, `QFile::setPermissions(socketPath_, QFile::ReadOwner | QFile::WriteOwner)` (mode 0600).
  - `onNewConnection()`: while `server_.hasPendingConnections()`: get socket, create `Conn{ new HttpParser, {} }`, connect `readyRead`/`disconnected`.
  - `onReadyRead()`: append `socket->readAll()` to `conn->buf`, loop calling `parser->consume(conn->buf)`. On `Done`: build a `HttpResponder` lambda that captures `socket` (use `QPointer<QLocalSocket>` to survive disconnect) and calls `writeResponse`. Emit `requestReceived` (queued connection — receiver runs on main thread anyway, but be explicit). Drop consumed bytes from `conn->buf`, reset parser, loop. On `BadRequest`/`TooLarge` → `writeResponse(socket, 400, ...)` and close.
  - `writeResponse()`: build the headers per spec §4 with `X-API-Version: 0` mandatory. Call `socket->write(...)`, `socket->flush()`. Don't auto-close — Go client may reuse, but for v1 you may close after each response (simpler; matches HTTP/1.0 fallback). **Choose: close after write.** Document the choice in a one-line comment.

- [ ] **Step 3: Add sources** to `src/CMakeLists.txt`. Build.

- [ ] **Step 4: Smoke wiring** — temporarily add to `main.cpp`:

```cpp
#include "http/http_server.h"
#include "util/socket_path.h"
#include <QCoreApplication>
int main(int argc, char *argv[]) {
    QCoreApplication a(argc, argv);
    walqt::HttpServer s(walqt::socketPath());
    QObject::connect(&s, &walqt::HttpServer::requestReceived,
        [](walqt::HttpRequest r, walqt::HttpResponder respond){
            respond(200, R"({"ok":true,"echo":")" + r.path.toUtf8() + R"("})");
        });
    if (!s.listen()) return 1;
    return a.exec();
}
```

- [ ] **Step 5: Manual verify**

```bash
cmake --build build -j && ./build/wal-qt &
PID=$!; sleep 0.3
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" http://localhost/health
# Expected: {"ok":true,"echo":"/health"}
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" -X POST \
    -H 'Content-Type: application/json' --data '{"a":1}' http://localhost/wallpaper/load
# Expected: {"ok":true,"echo":"/wallpaper/load"}
kill $PID
```

- [ ] **Step 6: Revert the smoke `main.cpp`** back to the empty stub from Task 2 (it'll be rebuilt properly in Task 22). Commit:

```bash
git commit -am "feat(http): QLocalServer with HTTP/1.1 framing on unix socket"
```

---

# Phase 3 — Web sandbox primitives (TDD-heavy)

### Task 7: `target_resolver` — TDD with fixtures

Implements spec §9.3 (resolution order) and §6 (web manifest parsing).

**Files:**
- Create: `src/wallpaper/target_resolver.h`, `.cpp`
- Create: `tests/test_target_resolver.cpp`
- Create: `tests/fixtures/pkg_with_manifest/waypaper.json` + `index.html`
- Create: `tests/fixtures/pkg_html_only/index.html`
- Create: `tests/fixtures/pkg_directory_only/.gitkeep`

- [ ] **Step 1: Build the fixtures** (run from repo root):

```bash
mkdir -p tests/fixtures/pkg_with_manifest tests/fixtures/pkg_html_only tests/fixtures/pkg_directory_only
echo '<!doctype html><title>x</title>' > tests/fixtures/pkg_with_manifest/index.html
cat > tests/fixtures/pkg_with_manifest/waypaper.json <<'JSON'
{
  "entry": "index.html",
  "capabilities": {
    "network": true,
    "pointer_interactive": false,
    "audio_reactive": false,
    "autoplay": true
  },
  "wallpaper_config": { "color": "#fff" }
}
JSON
echo '<!doctype html>' > tests/fixtures/pkg_html_only/index.html
touch tests/fixtures/pkg_directory_only/.gitkeep
```

- [ ] **Step 2: Header** `src/wallpaper/target_resolver.h`:

```cpp
#pragma once
#include <QString>
#include <QJsonObject>
namespace walqt {
struct WebManifest {
    QString entry = "index.html";
    bool network = false;
    bool pointerInteractive = false;
    bool audioReactive = false;
    bool autoplay = true;
    QJsonObject wallpaperConfig;
};
struct ResolvedWebTarget {
    QString packageRoot;   // absolute, no trailing slash
    QString entryFile;     // absolute path to entry html
    WebManifest manifest;  // defaults if no manifest present
    bool hasManifest = false;
};
// Returns ResolvedWebTarget on success; throws nothing — on failure, packageRoot is empty.
ResolvedWebTarget resolveWebTarget(const QString &target);
WebManifest parseManifest(const QString &manifestPath);
}
```

- [ ] **Step 3: Test cases** in `tests/test_target_resolver.cpp` — pass the absolute fixture path via `QFINDTESTDATA` (configure `tests/CMakeLists.txt` to copy `fixtures/` next to the binary or pass `WALQT_FIXTURES_DIR` as a compile def). Choice: compile def.

  Add to `tests/CMakeLists.txt`:

```cmake
add_compile_definitions(WALQT_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")
walqt_add_test(test_target_resolver)
```

  Test body:

```cpp
#include <QtTest/QtTest>
#include "wallpaper/target_resolver.h"
using namespace walqt;
static QString fx(const char *sub) { return QString(WALQT_FIXTURES_DIR) + "/" + sub; }
class TestTargetResolver : public QObject { Q_OBJECT
private slots:
    void manifestPath() {
        auto r = resolveWebTarget(fx("pkg_with_manifest/waypaper.json"));
        QCOMPARE(r.packageRoot, fx("pkg_with_manifest"));
        QCOMPARE(r.entryFile,   fx("pkg_with_manifest/index.html"));
        QVERIFY(r.hasManifest);
        QCOMPARE(r.manifest.network, true);
        QCOMPARE(r.manifest.entry, QString("index.html"));
        QCOMPARE(r.manifest.wallpaperConfig.value("color").toString(), QString("#fff"));
    }
    void directoryWithManifest() {
        auto r = resolveWebTarget(fx("pkg_with_manifest"));
        QCOMPARE(r.entryFile, fx("pkg_with_manifest/index.html"));
        QVERIFY(r.hasManifest);
    }
    void directoryWithoutManifestFallsToIndexHtml() {
        auto r = resolveWebTarget(fx("pkg_html_only"));
        QCOMPARE(r.entryFile, fx("pkg_html_only/index.html"));
        QVERIFY(!r.hasManifest);
    }
    void htmlPathFindsManifestSibling() {
        auto r = resolveWebTarget(fx("pkg_with_manifest/index.html"));
        QVERIFY(r.hasManifest);
        QCOMPARE(r.packageRoot, fx("pkg_with_manifest"));
    }
    void emptyDirectoryFails() {
        auto r = resolveWebTarget(fx("pkg_directory_only"));
        QVERIFY(r.packageRoot.isEmpty());
    }
    void manifestEntryFieldRespected() {
        // synthesise a temp dir with custom entry
        QTemporaryDir d; QVERIFY(d.isValid());
        QFile e(d.filePath("custom.html")); e.open(QIODevice::WriteOnly); e.write("x");
        QFile m(d.filePath("waypaper.json")); m.open(QIODevice::WriteOnly);
        m.write(R"({"entry":"custom.html"})");
        m.close(); e.close();
        auto r = resolveWebTarget(d.path());
        QCOMPARE(r.entryFile, d.filePath("custom.html"));
    }
};
QTEST_GUILESS_MAIN(TestTargetResolver)
#include "test_target_resolver.moc"
```

- [ ] **Step 4: Stub cpp** returning empty `ResolvedWebTarget`. Build & run → FAIL all.

- [ ] **Step 5: Implement** following spec §9.3 + §6:
  - `parseManifest`: open file, `QJsonDocument::fromJson`, populate fields with `.toBool(default)` / `.toString(default)`. Honour the `entry` then `file` fallback (`obj["entry"].toString(obj["file"].toString("index.html"))`).
  - `resolveWebTarget`:
    1. `QFileInfo fi(target);`
    2. If `fi.fileName() == "waypaper.json" || fi.fileName() == "project.json"` → `packageRoot = fi.absolutePath()`; parse manifest; entry = `packageRoot + "/" + manifest.entry`. Validate entry exists.
    3. Else if `fi.isDir()` → look for `waypaper.json`, `project.json`, `index.html` in that order; if a manifest is found, parse + use its entry; if only index.html, no manifest.
    4. Else if `fi.suffix().toLower() == "html"` → `packageRoot = fi.absolutePath()`; walk up to 3 parent directories looking for `waypaper.json`; if found, parse; entry = the original path.
    5. Verify `entryFile` exists; otherwise return empty `ResolvedWebTarget{}`.

- [ ] **Step 6: Build & run, all PASS, commit**

```bash
git commit -am "feat(wallpaper): waypaper.json target resolution + manifest parser"
```

---

### Task 8: `scheme_handler` path sandboxing — TDD

The handler integrates with `QtWebEngine`, but the **path-sandbox decision** is a pure function we can test in isolation. Refactor accordingly.

**Files:**
- Create: `src/web/scheme_handler.h`, `src/web/scheme_handler.cpp`
- Create: `tests/test_scheme_handler_paths.cpp`
- Create: `tests/fixtures/malicious_path_traversal/` with a symlink

- [ ] **Step 1: Build the malicious fixture**

```bash
mkdir -p tests/fixtures/malicious_path_traversal
echo 'safe' > tests/fixtures/malicious_path_traversal/safe.txt
ln -sf /etc/passwd tests/fixtures/malicious_path_traversal/escape.txt
```

(Verify: `readlink tests/fixtures/malicious_path_traversal/escape.txt` → `/etc/passwd`.)

- [ ] **Step 2: Header** that exposes the pure resolver:

```cpp
#pragma once
#include <QWebEngineUrlSchemeHandler>
#include <QString>
namespace walqt {
// Pure: returns absolute resolved path on success, or empty QString on rejection.
// Returns empty for: nonexistent, traversal escaping packageRoot, symlink escape.
QString resolveSchemePath(const QString &packageRoot, const QString &urlPath);

class WaypaperHtmlSchemeHandler : public QWebEngineUrlSchemeHandler {
    Q_OBJECT
public:
    using QWebEngineUrlSchemeHandler::QWebEngineUrlSchemeHandler;
    void setPackageRoot(const QString &root);
    void requestStarted(QWebEngineUrlRequestJob *job) override;
private:
    QString packageRoot_;
};
}
```

- [ ] **Step 3: Test cases** for `resolveSchemePath`:

```cpp
#include <QtTest/QtTest>
#include "web/scheme_handler.h"
using namespace walqt;
static QString fx(const char *s){ return QString(WALQT_FIXTURES_DIR)+"/"+s; }
class TestSchemePaths : public QObject { Q_OBJECT
private slots:
    void resolvesSafeFile() {
        auto p = resolveSchemePath(fx("malicious_path_traversal"), "safe.txt");
        QVERIFY(p.endsWith("/malicious_path_traversal/safe.txt"));
    }
    void rejectsSymlinkEscape() {
        auto p = resolveSchemePath(fx("malicious_path_traversal"), "escape.txt");
        QVERIFY2(p.isEmpty(), "symlink to /etc/passwd must be rejected");
    }
    void rejectsDotDotTraversal() {
        QVERIFY(resolveSchemePath(fx("pkg_with_manifest"), "../pkg_html_only/index.html").isEmpty());
    }
    void rejectsAbsolutePath() {
        QVERIFY(resolveSchemePath(fx("pkg_with_manifest"), "/etc/passwd").isEmpty());
    }
    void rejectsNonexistent() {
        QVERIFY(resolveSchemePath(fx("pkg_with_manifest"), "nope.html").isEmpty());
    }
    void allowsRootIndexHtml() {
        QVERIFY(!resolveSchemePath(fx("pkg_with_manifest"), "index.html").isEmpty());
    }
    void handlesPercentEncoding() {
        // %2E = '.' — recombined this is "index.html"
        auto p = resolveSchemePath(fx("pkg_with_manifest"), "index%2Ehtml");
        QVERIFY(!p.isEmpty());
    }
};
QTEST_GUILESS_MAIN(TestSchemePaths)
#include "test_scheme_handler_paths.moc"
```

Register in `tests/CMakeLists.txt`. Add `web/scheme_handler.cpp` to `src/CMakeLists.txt`.

- [ ] **Step 4: Stub** returning `QString{}`. Build, run → most FAIL.

- [ ] **Step 5: Implement `resolveSchemePath`** verbatim per spec §22.5 — using `QFileInfo::canonicalFilePath()` (NOT `absoluteFilePath`):

```cpp
QString walqt::resolveSchemePath(const QString &packageRoot, const QString &rawUrlPath) {
    if (packageRoot.isEmpty()) return {};
    QString decoded = QUrl::fromPercentEncoding(rawUrlPath.toUtf8());
    if (decoded.startsWith('/')) decoded = decoded.mid(1);
    QString rootCanon = QFileInfo(packageRoot).canonicalFilePath();
    if (rootCanon.isEmpty()) return {};
    QString candidate = QDir(packageRoot).absoluteFilePath(decoded);
    QString resolved  = QFileInfo(candidate).canonicalFilePath();
    if (resolved.isEmpty()) return {};
    if (resolved != rootCanon && !resolved.startsWith(rootCanon + '/')) return {};
    return resolved;
}
```

- [ ] **Step 6: Implement `WaypaperHtmlSchemeHandler::requestStarted`** following spec §9.2 + §22.5: call `resolveSchemePath(packageRoot_, job->requestUrl().path())`. On empty → `job->fail(QWebEngineUrlRequestJob::RequestDenied);`. On success: `QFile *f = new QFile(resolved, job); if (!f->open(...)) { job->fail(UrlNotFound); return; } job->reply(walqt::mimeForPath(resolved), f);`.

- [ ] **Step 7: Build, all PASS, commit**

```bash
git commit -am "feat(web): waypaperhtml scheme handler with canonicalised path sandbox"
```

---

### Task 9: `network_interceptor` — TDD

**Files:**
- Create: `src/web/network_interceptor.h`, `.cpp`
- Create: `tests/test_network_interceptor.cpp`

The class derives from `QWebEngineUrlRequestInterceptor`, but the decision is a pure predicate on `(scheme, host, networkEnabled, allowlist)`. Expose that as a free function for testability.

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <QWebEngineUrlRequestInterceptor>
#include <QStringList>
namespace walqt {
bool shouldBlock(const QString &scheme, const QString &host,
                 bool networkEnabled, const QStringList &allowlist);

class NetworkInterceptor : public QWebEngineUrlRequestInterceptor {
    Q_OBJECT
public:
    using QWebEngineUrlRequestInterceptor::QWebEngineUrlRequestInterceptor;
    void setNetworkEnabled(bool e) { enabled_ = e; }
    void setAllowlist(const QStringList &h) { allowlist_ = h; }
    void interceptRequest(QWebEngineUrlRequestInfo &info) override;
private:
    bool enabled_ = false;
    QStringList allowlist_;
};
}
```

- [ ] **Step 2: Tests**

```cpp
#include <QtTest/QtTest>
#include "web/network_interceptor.h"
using namespace walqt;
class TestInterceptor : public QObject { Q_OBJECT
private slots:
    void allowsLocalSchemesAlways() {
        for (auto s : {"waypaperhtml","file","qrc","data","blob"})
            QVERIFY(!shouldBlock(s, "anyhost", false, {}));
    }
    void blocksRemoteWhenDisabled() {
        QVERIFY(shouldBlock("https", "example.com", false, {}));
    }
    void allowsRemoteWhenEnabled() {
        QVERIFY(!shouldBlock("https", "example.com", true, {}));
    }
    void respectsAllowlistCaseInsensitively() {
        QStringList allow{"api.example.com"};
        QVERIFY(!shouldBlock("https", "API.Example.COM", false, allow));
        QVERIFY( shouldBlock("https", "evil.com",         false, allow));
    }
};
QTEST_GUILESS_MAIN(TestInterceptor)
#include "test_network_interceptor.moc"
```

Register; add `web/network_interceptor.cpp` to lib.

- [ ] **Step 3: Stub returning `true`. Build, FAIL.**

- [ ] **Step 4: Implement** per spec §22.4:

```cpp
bool walqt::shouldBlock(const QString &scheme, const QString &host,
                        bool enabled, const QStringList &allow) {
    static const QSet<QString> local{"waypaperhtml","file","qrc","data","blob"};
    if (local.contains(scheme)) return false;
    if (enabled) return false;
    for (const auto &h : allow)
        if (h.compare(host, Qt::CaseInsensitive) == 0) return false;
    return true;
}
void walqt::NetworkInterceptor::interceptRequest(QWebEngineUrlRequestInfo &info) {
    if (shouldBlock(info.requestUrl().scheme(),
                    info.requestUrl().host(),
                    enabled_, allowlist_))
        info.block(true);
}
```

- [ ] **Step 5: PASS, commit**

```bash
git commit -am "feat(web): url request interceptor with local-scheme allowlist"
```

---

### Task 10: CSP injector helper

**Files:**
- Create: `src/web/csp_injector.h`, `.cpp`

No new tests — function is a string builder; the JS string is verified at runtime via §22.6. Keep this minimal.

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <QWebEngineScript>
#include <QString>
namespace walqt {
QWebEngineScript buildCspInjectionScript(const QString &cspPolicy);
QString defaultCspPolicy();
}
```

- [ ] **Step 2: Implementation** — copy the user-script pattern from spec §22.6 (`QWebEngineScript::DocumentCreation`, `MainWorld`, name `"walCspInject"`). `defaultCspPolicy()` returns the exact policy string from §22.6.

- [ ] **Step 3: Add to lib, commit**

```bash
git commit -am "feat(web): default CSP meta-tag injection script builder"
```

---

# Phase 4 — Wallpaper plumbing

### Task 11: `WallpaperBridge` (QWebChannel object)

**Files:**
- Create: `src/wallpaper/wallpaper_bridge.h`, `.cpp`

No standalone unit test — exercised end-to-end in Phase 6 manual verification.

- [ ] **Step 1: Header** verbatim from spec §8.1 with one addition — emit `transitionAck(int monitorId, bool ok, QString err)` from `transitionResult()` so the controller can hook it:

```cpp
#pragma once
#include <QObject>
#include <QString>
namespace walqt {
class WallpaperBridge : public QObject {
    Q_OBJECT
public:
    explicit WallpaperBridge(int monitorId, QObject *parent = nullptr);
    int monitorId() const { return monitorId_; }
public slots:
    Q_INVOKABLE void transitionResult(const QString &json);
    Q_INVOKABLE void log(const QString &level, const QString &message);
signals:
    void loadWallpaper(const QString &json);
    void setParallax(const QString &json);
    void setParallaxMove(const QString &json);
    void setPlaybackPolicy(const QString &json);
    void pushWallpaperConfig(const QString &json);
    void pushCapabilities(const QString &json);
    void transitionAck(int monitorId, bool ok, const QString &err);
private:
    int monitorId_;
};
}
```

- [ ] **Step 2: Implementation** — body of `transitionResult` parses `QJsonDocument::fromJson`, extracts `ok` and `error`, emits `transitionAck(monitorId_, ok, err)`. `log` calls `qInfo()/qWarning()/qCritical()` based on `level`. Constructor stores `monitorId_`.

- [ ] **Step 3: Add to lib, commit**

```bash
git commit -am "feat(wallpaper): QWebChannel bridge object"
```

---

### Task 12: `PendingLoad` aggregator — TDD

Used by `WallpaperController` to delay HTTP responses until N monitor acks arrive (spec §16).

**Files:**
- Create: `src/wallpaper/pending_load.h`, `.cpp`
- Create: `tests/test_pending_load.cpp`

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <QString>
#include <functional>
#include <memory>
namespace walqt {
using LoadResponder = std::function<void(int status, const QByteArray &body)>;
class PendingLoad : public std::enable_shared_from_this<PendingLoad> {
public:
    PendingLoad(int expected, LoadResponder respond);
    void ack(bool ok, const QString &err);   // monitor reported transition done
    void timeout();                           // 30s elapsed
    bool finished() const { return done_; }
private:
    int remaining_;
    bool anyFailed_ = false;
    QString firstError_;
    LoadResponder respond_;
    bool done_ = false;
    void finish();
};
}
```

- [ ] **Step 2: Tests**

```cpp
#include <QtTest/QtTest>
#include "wallpaper/pending_load.h"
using namespace walqt;
class TestPending : public QObject { Q_OBJECT
private slots:
    void singleAckSucceeds() {
        int status = 0; QByteArray body;
        auto p = std::make_shared<PendingLoad>(1,
            [&](int s, const QByteArray &b){ status = s; body = b; });
        p->ack(true, {});
        QCOMPARE(status, 200);
        QVERIFY(body.contains("\"ok\":true"));
    }
    void waitsForAllAcks() {
        int calls = 0;
        auto p = std::make_shared<PendingLoad>(2,
            [&](int,const QByteArray&){ ++calls; });
        p->ack(true, {}); QCOMPARE(calls, 0);
        p->ack(true, {}); QCOMPARE(calls, 1);
    }
    void anyFailureMakes500() {
        int status = 0; QByteArray body;
        auto p = std::make_shared<PendingLoad>(2,
            [&](int s, const QByteArray &b){ status = s; body = b; });
        p->ack(false, "decode-fail"); p->ack(true, {});
        QCOMPARE(status, 500);
        QVERIFY(body.contains("decode-fail"));
    }
    void timeoutSends504OnceOnly() {
        int calls = 0; int status = 0;
        auto p = std::make_shared<PendingLoad>(2,
            [&](int s, const QByteArray&){ ++calls; status = s; });
        p->timeout();
        QCOMPARE(calls, 1); QCOMPARE(status, 504);
        p->ack(true, {}); // late ack ignored
        QCOMPARE(calls, 1);
    }
};
QTEST_GUILESS_MAIN(TestPending)
#include "test_pending_load.moc"
```

Register; add to lib. Stub returns nothing → tests FAIL.

- [ ] **Step 3: Implement.**
  - Constructor stores `expected`, `respond`.
  - `ack`: if `done_` return. If `!ok` and `firstError_.isEmpty()` set `anyFailed_=true; firstError_=err`. `--remaining_`; if `remaining_ == 0` → `finish()`.
  - `timeout`: if `done_` return; `anyFailed_=true; firstError_="timeout"; finish();` and inside `finish()` use status 504 if error == "timeout".
  - `finish()`: set `done_=true`; if `!anyFailed_` → `respond_(200, R"({"ok":true})")`. Else build body `{"ok":false,"error":"..."}`. Status: 504 if `firstError_=="timeout"`, else 500.

- [ ] **Step 4: PASS, commit**

```bash
git commit -am "feat(wallpaper): pending-load aggregator with timeout"
```

---

### Task 13: `WallpaperWindow` — LayerShellQt + QWebEngineView

**Files:**
- Create: `src/wallpaper/wallpaper_window.h`, `.cpp`

Manual verification only (no headless test of compositor placement).

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <QWidget>
#include <QJsonObject>
#include <functional>
class QWebEngineView;
class QWebChannel;
class QScreen;
namespace walqt {
class WallpaperBridge;
class WaypaperHtmlSchemeHandler;
class NetworkInterceptor;

class WallpaperWindow : public QWidget {
    Q_OBJECT
public:
    WallpaperWindow(QScreen *screen, int monitorIndex,
                    WaypaperHtmlSchemeHandler *schemeHandler,
                    NetworkInterceptor *interceptor,
                    QWidget *parent = nullptr);

    QString screenName() const;
    int monitorIndex() const { return monitorIndex_; }
    QString currentTarget() const { return currentTarget_; }
    QString currentKind()   const { return currentKind_; }

    // Returns immediately. For image/video, ack arrives via the bridge.
    void loadContent(const QJsonObject &req,
                     std::function<void(bool ok, QString err)> done);

    void setParallax(const QJsonObject &req);
    void setParallaxMove(const QJsonObject &req);
    void setPlaybackPolicy(const QJsonObject &req);
    void pushWallpaperConfig(const QJsonObject &req);
    void pushCapabilities(const QJsonObject &req);

    WallpaperBridge *bridge() const { return bridge_; }

private:
    int monitorIndex_;
    QWebEngineView *view_ = nullptr;
    WallpaperBridge *bridge_ = nullptr;
    QWebChannel *channel_ = nullptr;
    WaypaperHtmlSchemeHandler *schemeHandler_;
    NetworkInterceptor *interceptor_;
    QString currentTarget_;
    QString currentKind_;
    std::function<void(bool, QString)> pendingDone_;

    void setupLayerShell(QScreen *screen);
    void installBridgeAndUserScripts();
    void loadRendererShell();    // navigates to qrc:/renderer/index.html
    void loadWebPackage(const QJsonObject &req);
    void loadImageOrVideo(const QJsonObject &req);
};
}
```

- [ ] **Step 2: Implementation**:
  - Constructor: build the layout exactly per spec §3.2 — `setWindowFlags(Qt::Window)`, `QVBoxLayout` zero-margin, `view_ = new QWebEngineView(this)`, then call `setupLayerShell(screen)` then `installBridgeAndUserScripts()` then `loadRendererShell()` then `show()` (NOT `showFullScreen()`).
  - `setupLayerShell`: spec §3.2 verbatim — `winId()` first to force native window, `windowHandle()->setScreen(screen)`, `LayerShellQt::Window::get(win)` then set layer/anchors/exclusiveZone/keyboardInteractivity/scope `wayland-utauri-monitor-<idx>`.
  - `installBridgeAndUserScripts`: spec §8.2 verbatim — read `:/qtwebchannel/qwebchannel.js` from Qt resources, build the init JS, register `walBridge`, attach via `view_->page()->setWebChannel(channel_)`. Then also insert the CSP injector script from Task 10.
  - Connect `bridge_->transitionAck` → lambda that captures `this` and calls `pendingDone_` if set.
  - `loadContent`: dispatch by `kind`:
    - `"web"` → `loadWebPackage(req)` then immediately call `done(true, {})` (spec §8.3).
    - `"image"` / `"video"` → store `pendingDone_ = done`; emit `bridge_->loadWallpaper(QJsonDocument(req).toJson(QJsonDocument::Compact))`.
  - `loadWebPackage`: call `walqt::resolveWebTarget(req["target"].toString())`; if root empty → `done(false, "unresolved target")`. Else `schemeHandler_->setPackageRoot(root)`; load `QUrl("waypaperhtml://pkg/" + manifest.entry)`; toggle interceptor `setNetworkEnabled(manifest.network && globalNetworkEnabled_)` — pass `globalNetworkEnabled_` as a setter (Task 14) **— for now just use `manifest.network`** with a `// TODO(Task 14): combine with global setting` comment is forbidden; instead add a `setGlobalNetworkEnabled(bool)` setter on the window now and store the AND in a private field.
  - `loadImageOrVideo`: update `currentTarget_/currentKind_` on ack, not preemptively.

- [ ] **Step 3: Add to `src/CMakeLists.txt`. Build (will not work end-to-end yet without Tasks 14-22 — CMake should still link).**

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(wallpaper): per-screen layer-shell window hosting QWebEngineView"
```

---

# Phase 5 — Controller and routing

### Task 14: `WallpaperController` — route dispatch

**Files:**
- Create: `src/wallpaper/wallpaper_controller.h`, `.cpp`

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <QObject>
#include <QMap>
#include <QJsonObject>
#include "http/http_server.h"
class QScreen;
namespace walqt {
class WallpaperWindow;
class WaypaperHtmlSchemeHandler;
class NetworkInterceptor;

class WallpaperController : public QObject {
    Q_OBJECT
public:
    WallpaperController(WaypaperHtmlSchemeHandler *sh,
                        NetworkInterceptor *ni,
                        QObject *parent = nullptr);
    void init();                        // builds windows for all current screens
public slots:
    // Connected to HttpServer::requestReceived (queued).
    void handleRequest(walqt::HttpRequest req, walqt::HttpResponder respond);

private slots:
    void onScreenAdded(QScreen *s);
    void onScreenRemoved(QScreen *s);

private:
    WaypaperHtmlSchemeHandler *schemeHandler_;
    NetworkInterceptor *interceptor_;
    QMap<QString, WallpaperWindow*> windows_;   // QScreen::name() → window
    bool networkEnabled_ = false;

    void route(const QString &method, const QString &path,
               const QJsonObject &body, HttpResponder respond);

    QJsonObject statusJson() const;
    QList<WallpaperWindow*> resolveTargets(const QJsonObject &req) const;
    void handleLoad     (const QJsonObject &req, HttpResponder respond);
    void handleParallax (const QJsonObject &req, HttpResponder respond);
    void handleParallaxMove(const QJsonObject &req, HttpResponder respond);
    void handleNetwork  (const QJsonObject &req, HttpResponder respond);
    void handleConfig   (const QJsonObject &req, HttpResponder respond);
    void handleCaps     (const QJsonObject &req, HttpResponder respond);
    void handlePlayback (const QJsonObject &req, HttpResponder respond);
};
}
```

- [ ] **Step 2: Implement** following spec §§5–7, §16.
  - `handleRequest`: parse body if present (`QJsonDocument::fromJson(req.body)`); if `Content-Type` was JSON and body fails to parse → `respond(400, R"({"error":"bad json"})")` and return. Otherwise call `route`.
  - `route`: switch on `(method, path)`:

| Method | Path | Handler |
|---|---|---|
| `GET`  | `/health`                | `respond(200, R"({"ok":true})")` |
| `GET`  | `/wallpaper/status`      | `respond(200, QJsonDocument(statusJson()).toJson(QJsonDocument::Compact))` |
| `POST` | `/wallpaper/load`        | `handleLoad(body, respond)` |
| `POST` | `/wallpaper/parallax`    | `handleParallax(body, respond)` |
| `POST` | `/wallpaper/parallax-move` | `handleParallaxMove(body, respond)` |
| `POST` | `/settings/network`      | `handleNetwork(body, respond)` |
| `POST` | `/wallpaper/config`      | `handleConfig(body, respond)` |
| `POST` | `/wallpaper/capabilities`| `handleCaps(body, respond)` |
| `POST` | `/wallpaper/playback`    | `handlePlayback(body, respond)` |
| else | else | `respond(404, R"({"error":"not found"})")` |

  - `init`: iterate `QGuiApplication::screens()` calling `onScreenAdded`. Connect `screenAdded`/`screenRemoved` to the slots. Each new window gets `monitorIndex_ = windows_.size()` at insertion time and is keyed on `screen->name()` (spec §12).
  - `resolveTargets`: spec §6 — if `req` has `targets` (array), iterate and pick by `name`; else apply to all `windows_`.
  - `handleLoad`: spec §16 — if `wait_for_completion == false` → respond 202 immediately and dispatch fire-and-forget; else build a `std::shared_ptr<PendingLoad>` with `expected=targets.size()`, call `loadContent` with a lambda capturing the `pending` shared_ptr that calls `pending->ack(...)`. Then `QTimer::singleShot(30000, this, [pending]{ pending->timeout(); });`.
  - `handleParallax`: optional `monitor` field selects single window; otherwise broadcast. Same pattern for `parallax-move`.
  - `handleNetwork`: parse `enabled` bool, store on `networkEnabled_`, push to every window via a `setGlobalNetworkEnabled(bool)` (you must add this setter to `WallpaperWindow` in Task 13 — check it's there; if not, add it now and re-commit Task 13 amendment in this commit). Reply 200.
  - `handleConfig` / `handleCaps` / `handlePlayback`: pick the window matching `source_target` (compare with `currentTarget_`); emit the corresponding bridge signal; reply 200. If no window matches reply 200 with `{"ok":true,"applied":0}` — the daemon doesn't treat this as an error.
  - `statusJson`: build `{"monitors": [...]}` per spec §17 with `id`, `name`, `current_target`, `kind`, `visible: true`.

- [ ] **Step 3: Add to lib. Commit**

```bash
git commit -am "feat(wallpaper): controller wiring routes to monitor windows with wait_for_completion"
```

---

# Phase 6 — Singleton + main

### Task 15: `SingleInstance` lock

**Files:**
- Create: `src/app/single_instance.h`, `.cpp`

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <QLockFile>
#include <memory>
namespace walqt {
class SingleInstance {
public:
    bool acquire();   // false if another instance holds the lock
private:
    std::unique_ptr<QLockFile> lock_;
};
}
```

- [ ] **Step 2: Implement** per spec §13:

```cpp
#include "app/single_instance.h"
#include "util/socket_path.h"
bool walqt::SingleInstance::acquire() {
    lock_ = std::make_unique<QLockFile>(walqt::lockPath());
    lock_->setStaleLockTime(0);
    return lock_->tryLock(100);
}
```

- [ ] **Step 3: Add to lib, commit**

```bash
git commit -am "feat(app): single-instance lock via QLockFile"
```

---

### Task 16: `App` class — screen topology + wiring

**Files:**
- Create: `src/app/app.h`, `.cpp`

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <QObject>
namespace walqt {
class WallpaperController;
class HttpServer;
class WaypaperHtmlSchemeHandler;
class NetworkInterceptor;
class App : public QObject {
    Q_OBJECT
public:
    App(WaypaperHtmlSchemeHandler *sh, NetworkInterceptor *ni, QObject *parent=nullptr);
    bool start();
private:
    WallpaperController *controller_;
    HttpServer *server_;
};
}
```

- [ ] **Step 2: Implement**: in `start()`:
  - `controller_ = new WallpaperController(sh, ni, this); controller_->init();`
  - `server_ = new HttpServer(walqt::socketPath(), this);`
  - `connect(server_, &HttpServer::requestReceived, controller_, &WallpaperController::handleRequest, Qt::QueuedConnection);`
  - `return server_->listen();`

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(app): screen topology owner wiring controller and http server"
```

---

### Task 17: Real `main.cpp` (replace stub)

**Files:**
- Modify: `src/main.cpp`

- [ ] **Step 1: Replace contents** with the full sequence from spec §14:

```cpp
#include <QApplication>
#include <QLockFile>
#include <QWebEngineUrlScheme>
#include <QWebEngineProfile>

#include "app/app.h"
#include "app/single_instance.h"
#include "web/scheme_handler.h"
#include "web/network_interceptor.h"

int main(int argc, char *argv[]) {
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-accelerated-video-decode");
    qputenv("QT_QPA_PLATFORM", qgetenv("QT_QPA_PLATFORM").isEmpty()
                                   ? QByteArray("wayland")
                                   : qgetenv("QT_QPA_PLATFORM"));

    QWebEngineUrlScheme scheme("waypaperhtml");
    scheme.setFlags(QWebEngineUrlScheme::SecureScheme |
                    QWebEngineUrlScheme::LocalScheme |
                    QWebEngineUrlScheme::LocalAccessAllowed |
                    QWebEngineUrlScheme::CorsEnabled);
    QWebEngineUrlScheme::registerScheme(scheme);

    QApplication app(argc, argv);
    app.setApplicationName("wal-qt");
    app.setApplicationVersion("0.1");

    walqt::SingleInstance lock;
    if (!lock.acquire()) {
        qCritical("Another wal-qt instance is already running");
        return 1;
    }

    auto *interceptor   = new walqt::NetworkInterceptor(&app);
    QWebEngineProfile::defaultProfile()->setUrlRequestInterceptor(interceptor);
    auto *schemeHandler = new walqt::WaypaperHtmlSchemeHandler(&app);
    QWebEngineProfile::defaultProfile()->installUrlSchemeHandler("waypaperhtml", schemeHandler);

    walqt::App walapp(schemeHandler, interceptor);
    if (!walapp.start()) {
        qCritical("Failed to bind control socket");
        return 1;
    }
    return app.exec();
}
```

- [ ] **Step 2: Build**

```bash
cmake --build build -j
```

Expected: clean build of `wal-qt`. Tests still pass: `ctest --test-dir build --output-on-failure`.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(app): main.cpp wires Chromium flags, scheme, lock, profile, app"
```

---

# Phase 7 — Renderer port

The TS renderer is mostly a copy of `wal-utauri/src/renderer/` with three Tauri-touching files swapped to QWebChannel.

### Task 18: Bootstrap renderer subproject

**Files:**
- Create: `renderer/package.json`, `renderer/tsconfig.json`, `renderer/vite.config.ts`, `renderer/vitest.config.ts`, `renderer/index.html`, `renderer/src/styles.css`

- [ ] **Step 1: Copy upstream config as a starting point**

```bash
cp /home/obsy/dev/waypaper/wal-utauri/package.json     renderer/package.json
cp /home/obsy/dev/waypaper/wal-utauri/tsconfig.json    renderer/tsconfig.json
cp /home/obsy/dev/waypaper/wal-utauri/vite.config.ts   renderer/vite.config.ts
cp /home/obsy/dev/waypaper/wal-utauri/vitest.config.ts renderer/vitest.config.ts
cp /home/obsy/dev/waypaper/wal-utauri/index.html       renderer/index.html
cp /home/obsy/dev/waypaper/wal-utauri/src/styles.css   renderer/src/styles.css
```

- [ ] **Step 2: Edit `renderer/package.json`**:
  - `"name"` → `"wal-qt-renderer"`.
  - Drop every `@tauri-apps/*` dep and the `tauri` script.
  - Drop `check:rust` and `check:all:strict`'s rust portion (replace with TS-only equivalent).
  - Keep: `gsap`, `vite`, `vitest`, `typescript`, `oxlint`, `oxfmt`.
  - Drop the `gen:api` / `check:api-drift` scripts (the Go daemon contract is informally pinned; we don't regenerate from it here).

- [ ] **Step 3: Edit `renderer/vite.config.ts`** — set `base: './'` and `build.outDir: 'dist'`. Remove any Tauri-specific server settings.

- [ ] **Step 4: Install + sanity build**

```bash
cd renderer && npm install && npm run build
```

Expected: produces `renderer/dist/index.html`. (Will fail because we haven't ported `main.ts` yet — proceed; deliberate FAIL is acceptable here, we'll fix in Tasks 19-21.)

- [ ] **Step 5: Commit (config only)**

```bash
cd .. && git add renderer/ && git commit -m "chore(renderer): bootstrap vite/vitest config, drop tauri deps"
```

---

### Task 19: Copy unchanged renderer modules

**Files:**
- Create: `renderer/src/renderer/` — many files

- [ ] **Step 1: Copy everything except the three files we'll rewrite + the obsolete shim**

```bash
mkdir -p renderer/src/renderer/transition
cp /home/obsy/dev/waypaper/wal-utauri/src/renderer/{guards,image,parallax,state,types,video,videoLoop,webglObjectFit,webglTextureSizing,webglWorkerProbe}.ts renderer/src/renderer/
cp /home/obsy/dev/waypaper/wal-utauri/src/renderer/transition/intent.ts renderer/src/renderer/transition/
# tests too — they should still pass after the type/import surgery in Task 21
cp /home/obsy/dev/waypaper/wal-utauri/src/renderer/{logger.test,urlUtils.test,videoLoop.test,webglObjectFit.test,webglTextureSizing.test}.ts renderer/src/renderer/
```

- [ ] **Step 2: Confirm `tauriInvokeOriginFix.ts` is NOT copied** (spec §15 says delete).

- [ ] **Step 3: Verify nothing else imports from `@tauri-apps/api`** in the copied files:

```bash
grep -RIn "@tauri-apps" renderer/src/ || echo "clean"
```

If any matches surface in copied files (other than `logger.ts`, `urlUtils.ts`, `main.ts`, `loadPipeline.ts`), STOP and report — those need rewrite.

- [ ] **Step 4: Commit**

```bash
git add renderer/src && git commit -m "chore(renderer): port unchanged modules from wal-utauri"
```

---

### Task 20: Rewrite Tauri-touching modules

**Files:**
- Create: `renderer/src/renderer/logger.ts`
- Create: `renderer/src/renderer/urlUtils.ts`
- Create: `renderer/src/renderer/loadPipeline.ts`
- Create: `renderer/src/main.ts`
- Create: `renderer/src/renderer/walBridge.d.ts` — shared global typing

- [ ] **Step 1: Type the bridge** in `renderer/src/renderer/walBridge.d.ts` — copy the `Window._walBridge` declaration verbatim from spec §15 (`main.ts` AFTER block).

- [ ] **Step 2: `logger.ts`** — copy spec §15 AFTER block verbatim.

- [ ] **Step 3: `urlUtils.ts`** — copy spec §15 AFTER block verbatim.

- [ ] **Step 4: `loadPipeline.ts`** — start from `/home/obsy/dev/waypaper/wal-utauri/src/renderer/loadPipeline.ts`; rewrite every `await emit(...)` and every `invoke(...)` per spec §15. Concretely:

```bash
cp /home/obsy/dev/waypaper/wal-utauri/src/renderer/loadPipeline.ts renderer/src/renderer/loadPipeline.ts
```

Then open the file and replace each `await emit("wallpaper:transition-result", { ok, engine, monitor_id })` line with `window._walBridge?.transitionResult(JSON.stringify({ ok, engine, monitor_id }))`. Remove the `import { emit } from "@tauri-apps/api/event"` line.

- [ ] **Step 5: `main.ts`** — start from `/home/obsy/dev/waypaper/wal-utauri/src/main.ts`; replace the Tauri event bootstrap with the QWebChannel pattern from spec §15 AFTER block. Wire **all six** signals listed in `WallpaperBridge`:

```ts
document.addEventListener("walBridgeReady", () => {
    const b = window._walBridge!;
    b.loadWallpaper.connect((j: string) => handleLoad(JSON.parse(j)));
    b.setParallax.connect((j: string) => handleParallax(JSON.parse(j)));
    b.setParallaxMove.connect((j: string) => handleParallaxMove(JSON.parse(j)));
    b.setPlaybackPolicy.connect((j: string) => handlePlaybackPolicy(JSON.parse(j)));
    b.pushWallpaperConfig.connect((j: string) => handleConfigPush(JSON.parse(j)));
    b.pushCapabilities.connect((j: string) => handleCapsPush(JSON.parse(j)));
});
```

If the upstream `main.ts` lacks one of these handlers (`handleParallaxMove`, etc.), add a no-op stub with a one-line comment — they'll be filled by Phase 8 polish. **No `TODO:` markers** — write `// no-op until renderer pipeline lands the move feature`.

- [ ] **Step 6: Run renderer typecheck + tests**

```bash
cd renderer && npm run typecheck && npm test
cd ..
```

Expected: tsc clean; vitest green. If a copied test breaks because it imported `@tauri-apps`, port it now.

- [ ] **Step 7: Build the renderer**

```bash
cd renderer && npm run build
```

Expected: `renderer/dist/index.html` produced.

- [ ] **Step 8: Commit**

```bash
git add renderer/ && git commit -m "feat(renderer): replace tauri APIs with QWebChannel bridge"
```

---

### Task 21: Embed renderer as Qt resource

**Files:**
- Create: `src/renderer.qrc.in` (template) — generated `renderer.qrc` listing every file under `renderer/dist/`
- Create: `scripts/gen-renderer-qrc.sh`
- Modify: `CMakeLists.txt` — add custom command + AUTORCC handling
- Modify: `src/wallpaper/wallpaper_window.cpp` — `loadRendererShell` navigates to `qrc:/renderer/index.html`

- [ ] **Step 1: Write the generator** `scripts/gen-renderer-qrc.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
DIST="$1"; OUT="$2"
{
  echo '<RCC><qresource prefix="/renderer">'
  (cd "$DIST" && find . -type f | sed 's|^\./||' | sort | while read -r f; do
      printf '  <file alias="%s">%s/%s</file>\n' "$f" "$DIST" "$f"
  done)
  echo '</qresource></RCC>'
} > "$OUT"
```

`chmod +x scripts/gen-renderer-qrc.sh`.

- [ ] **Step 2: CMake glue** — append to root `CMakeLists.txt`:

```cmake
set(RENDERER_DIST ${CMAKE_SOURCE_DIR}/renderer/dist)
set(RENDERER_QRC  ${CMAKE_BINARY_DIR}/renderer.qrc)

add_custom_command(
    OUTPUT  ${RENDERER_QRC}
    COMMAND ${CMAKE_SOURCE_DIR}/scripts/gen-renderer-qrc.sh ${RENDERER_DIST} ${RENDERER_QRC}
    DEPENDS ${RENDERER_DIST}/index.html
    COMMENT "Generating renderer.qrc"
)
add_custom_target(renderer_qrc DEPENDS ${RENDERER_QRC})

target_sources(wal-qt PRIVATE ${RENDERER_QRC})
add_dependencies(wal-qt renderer_qrc)
```

- [ ] **Step 3: Implement `WallpaperWindow::loadRendererShell()`**:

```cpp
view_->load(QUrl("qrc:/renderer/index.html"));
```

- [ ] **Step 4: Build**

```bash
cd renderer && npm run build && cd ..
cmake --build build -j
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-renderer-qrc.sh CMakeLists.txt src/wallpaper/wallpaper_window.cpp && \
git commit -m "build: embed renderer dist as qrc resource"
```

---

# Phase 8 — End-to-end manual verification

### Task 22: Compositor smoke test

This is a **manual** task — no code changes unless something breaks. Runs against Hyprland (per spec §20).

- [ ] **Step 1: Ensure no other waypaper backend is running**

```bash
pkill -f wal-utauri || true; pkill -f wal-qt || true
rm -f "$XDG_RUNTIME_DIR/wayland-utauri.sock" "$XDG_RUNTIME_DIR/wayland-utauri.lock"
```

- [ ] **Step 2: Start `wal-qt`**

```bash
QT_QPA_PLATFORM=wayland ./build/wal-qt &
WALPID=$!
sleep 1
```

- [ ] **Step 3: Verify layer surface placement**

```bash
hyprctl layers -j | python3 -c "import json,sys; d=json.load(sys.stdin); \
[print(o, [s['namespace'] for s in data['levels'].get('0',[])]) for o,data in d.items()]"
```

Expected: every output lists `wayland-utauri-monitor-N`. If empty: re-check spec §3.1 (`QT_WAYLAND_SHELL_INTEGRATION` MUST NOT be set globally) and spec §3.2 (`show()` not `showFullScreen()`).

- [ ] **Step 4: Health probe via the Go-daemon contract**

```bash
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" -i http://localhost/health
```

Expected: `HTTP/1.1 200 OK`, header `X-API-Version: 0`, body `{"ok":true}`.

- [ ] **Step 5: Load an image (synchronous wait)**

```bash
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"kind":"image","target":"/home/obsy/dev/waypaper/wal-utauri/test_wallpapers/sample.jpg","wait_for_completion":true,"transition":"fade","duration_ms":300}' \
    -i http://localhost/wallpaper/load
```

(If `sample.jpg` doesn't exist, point to any local JPG.) Expected: HTTP 200 once the wallpaper is visible. Look at the screen.

- [ ] **Step 6: Status query**

```bash
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" http://localhost/wallpaper/status | python3 -m json.tool
```

Expected: monitors array with the loaded target listed.

- [ ] **Step 7: HTML wallpaper from the malicious-traversal fixture (negative test)**

```bash
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"kind\":\"web\",\"target\":\"$(pwd)/tests/fixtures/malicious_path_traversal\",\"wait_for_completion\":true}" \
    -i http://localhost/wallpaper/load
```

Expected: 404 or 500 (no `index.html` in that fixture; resolver rejects). Then attempt to fetch the symlink via the page (use a wallpaper that has an `<img src="escape.txt">`) — the request must be denied.

- [ ] **Step 8: Stop the binary**

```bash
kill $WALPID
```

- [ ] **Step 9: Run all unit tests one more time**

```bash
ctest --test-dir build --output-on-failure
```

Expected: green.

- [ ] **Step 10: If anything failed**, capture the failure, fix in a focused commit referencing the spec section that was violated, then re-run from Step 1. **Do not skip failures.**

- [ ] **Step 11: Commit any verification fixes** (if needed) and tag a milestone:

```bash
git tag v0.1.0-alpha
```

---

# Phase 9 — Integration with the Go daemon

### Task 23: Confirm Go daemon spawns wal-qt

This validates the contract end-to-end.

- [ ] **Step 1: Locate the daemon's backend config defaults**

Read `/home/obsy/dev/waypaper/waypaper-engine/daemon/internal/backend/waylandutauri/config.go`. Note the default `binary_path` (likely `wal-utauri`) and `socket_path`.

- [ ] **Step 2: Override via the daemon config** — open (or create) the user's `waypaper-engine` config and set:

```toml
[backend.waylandutauri]
binary_path = "/home/obsy/dev/waypaper/wal-qt/build/wal-qt"
```

(If the engine config lives elsewhere, ask the user for the path; do not guess.)

- [ ] **Step 3: Run the engine** in dev mode (per `/home/obsy/dev/waypaper/CLAUDE.md`):

```bash
cd /home/obsy/dev/waypaper/waypaper-engine && npm run dev
```

- [ ] **Step 4: Trigger a wallpaper change from the Electron UI.** Watch:
  - the wallpaper actually changes on the screen,
  - `pgrep -af wal-qt` shows our binary,
  - `hyprctl layers` still shows the layer namespaces,
  - the daemon logs no `X-API-Version` mismatches or HTTP errors.

- [ ] **Step 5: Document the result** in `README.md` under a "Verified compositors / engines" section. Commit.

```bash
git add README.md && git commit -m "docs: record wal-qt verified end-to-end with waypaper-engine on Hyprland"
```

---

# Phase 10 — Loose ends explicitly deferred

### Task 24: Pointer-interactive capability (stretch — leave default off)

Per spec §11, default to non-interactive. Add a `setPointerInteractive(bool)` method on `WallpaperWindow` that calls `setMask(QRegion())` for non-interactive and `clearMask()` for interactive. Do **not** wire it into the controller for v1; commit as opt-in only.

```bash
git commit -am "feat(wallpaper): pointer-interactive setter (off by default)"
```

### Task 25: Audio-reactive capture stub (explicit TODO is allowed *here*)

Per spec §15 last paragraph: `POST /wallpaper/capabilities` with `audio_reactive: true` should be accepted but not start the capture thread in v1.

- [ ] **Step 1:** In `WallpaperController::handleCaps`, detect `audio_reactive: true`; log a one-line `qInfo("audio_reactive requested but capture is not implemented in v0.1");` and respond 200 normally.
- [ ] **Step 2:** Add a single tracking comment in `wallpaper_controller.cpp`: `// audio-reactive capture: deferred, see wal-qt.md §15`.
- [ ] **Step 3:** Commit.

```bash
git commit -am "feat(wallpaper): accept audio_reactive caps; capture deferred"
```

---

# Self-review checklist (run before declaring done)

- [ ] Every spec section in `wal-qt.md` is referenced by at least one task. Cross-check: §0–§22 → mapping below.
  - §3.2 layer-shell setup → Task 13.
  - §3.3 video flag → Task 17.
  - §4 HTTP server → Tasks 5–6.
  - §5 routes → Task 14.
  - §6 LoadBody → Task 14 + Task 13 dispatch.
  - §7 controller → Task 14.
  - §8 QWebChannel → Tasks 11, 13.
  - §9 scheme handler + manifest → Tasks 7, 8.
  - §10 network interceptor → Task 9.
  - §11 input passthrough → Task 24.
  - §12 monitor topology → Task 14 (`init`/`onScreenAdded`).
  - §13 single instance → Task 15.
  - §14 main.cpp → Task 17.
  - §15 renderer port → Tasks 18–21.
  - §16 wait_for_completion → Tasks 12, 14.
  - §17 status → Task 14 (`statusJson`).
  - §18 Go-side context → unchanged; no task.
  - §19 file structure → matches "File structure" section above.
  - §20 compositor compat → Task 22.
  - §21 build/run → Task 22.
  - §22 security → Tasks 8 (path), 9 (network), 10 (CSP).

- [ ] No `TODO`, `FIXME`, "implement later", or unfilled code blocks except the explicit deferred stub in Task 25.

- [ ] Type/method consistency:
  - `WallpaperBridge::transitionResult` (slot from JS) vs `transitionAck` (signal to controller) — distinct intentionally.
  - `WallpaperWindow::loadContent(req, done)` signature appears in Tasks 13 and 14 with identical parameter list.
  - `HttpResponder = std::function<void(int, const QByteArray&)>` consistent across http_server, controller, pending_load.
  - `walqt::resolveWebTarget`, `walqt::resolveSchemePath`, `walqt::shouldBlock` are the only public free functions exposed for unit testing.

- [ ] Renderer port: every Tauri import in original wal-utauri renderer is accounted for (`@tauri-apps/api/core` `invoke`, `@tauri-apps/api/event` `listen`/`emit`). Confirmed via `grep -RIn "@tauri-apps" renderer/src` returning empty.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-wal-qt-bootstrap.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via `superpowers:executing-plans` with checkpoints.

Which approach?
