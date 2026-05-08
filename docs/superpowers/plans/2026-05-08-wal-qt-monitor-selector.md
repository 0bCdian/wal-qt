# wal-qt MonitorSelector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three ad-hoc target-resolution patterns in `WallpaperController` (`resolveTargets`, `resolveParallaxTargets`, `source_target` filter loops) with a single typed `MonitorSelector` value plus pure decoder/resolve functions, fully unit-tested.

**Architecture:** Introduce `src/wallpaper/monitor_selector.{h,cpp}` containing a tagged-struct `MonitorSelector` (cases: `All`, `ByNames`, `ByCurrentSource`), three pure decoder functions (one per existing endpoint shape), one pure `resolveIndices` function operating on a POD `MonitorView` snapshot, and a thin convenience overload `resolve()` that adapts the controller's `QMap<QString, WallpaperWindow*>` to the pure form. Refactor `WallpaperController` handlers to use it. No HTTP layer change. No public API change. No behavioural change — pure structural refactor backed by tests.

**Tech Stack:** C++17, Qt 6.11 (`QtCore`, `QtTest`), CMake, `QtTest`-style table-driven unit tests.

**Scope check:** This is **step 1 of 6** in the broader wal-qt deepening refactor. Subsequent steps (Source type, rename to `WallpaperHost`, QHttpServer migration, `WallpaperWindow` split, web-handler hoisting) get their own plans.

**Domain language:** see `wal-qt/docs/CONTEXT.md` — terms `MonitorSelector`, `MonitorView`, `Source` are defined there. Use them exactly.

**Important context for the engineer (reading order):**
1. `wal-qt/docs/CONTEXT.md` — the domain glossary. **Read first.**
2. `wal-qt/src/wallpaper/wallpaper_controller.h` — what we're refactoring.
3. `wal-qt/src/wallpaper/wallpaper_controller.cpp` lines 140–164, 169–197, 202–219, 251–306 — the existing patterns being replaced.
4. `wal-qt/tests/test_target_resolver.cpp` — the test style of this codebase. Match it.

**C++ conventions in this codebase (the engineer may be coming from Go/TS):**
- Headers (`.h`) declare; source (`.cpp`) implements. Forward-declare classes in headers when only a pointer is used.
- All wal-qt code lives in `namespace walqt { ... }`.
- Uses `QStringLiteral("...")` for compile-time `QString` literals — keep this pattern.
- Tests are `QObject` subclasses with `private slots:` containing test methods, using `QCOMPARE` / `QVERIFY` (similar to assertions in `*testing.T` / Vitest).
- `auto` is fine and idiomatic.
- The build system is CMake. New `.cpp` files must be added to `src/CMakeLists.txt`. New tests must be added to `tests/CMakeLists.txt`.

**Build & test commands (run from `wal-qt/` directory):**

```sh
cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j
ctest --test-dir build --output-on-failure
```

Incremental rebuild after edits: `cmake --build build -j`. Run a single test: `ctest --test-dir build --output-on-failure -R test_monitor_selector`.

---

## File Structure

**Create:**
- `src/wallpaper/monitor_selector.h` — types + free function declarations
- `src/wallpaper/monitor_selector.cpp` — implementations
- `tests/test_monitor_selector.cpp` — unit tests

**Modify:**
- `src/CMakeLists.txt` — register `monitor_selector.cpp`
- `tests/CMakeLists.txt` — register `test_monitor_selector`
- `src/wallpaper/wallpaper_controller.h` — remove `resolveTargets` / `resolveParallaxTargets` private method declarations
- `src/wallpaper/wallpaper_controller.cpp` — replace ad-hoc selection with calls into new module; delete dead helpers

---

## Task 1: Skeleton — header, empty implementation, CMake wiring, empty test executable

This task introduces the new module's stub files and a passing-but-empty test executable, so subsequent TDD tasks have a green starting point. **No logic yet.**

**Files:**
- Create: `src/wallpaper/monitor_selector.h`
- Create: `src/wallpaper/monitor_selector.cpp`
- Create: `tests/test_monitor_selector.cpp`
- Modify: `src/CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

- [ ] **Step 1: Create `src/wallpaper/monitor_selector.h` with declarations only**

Exact contents:

```cpp
#pragma once

#include <QJsonObject>
#include <QList>
#include <QMap>
#include <QString>
#include <QStringList>

namespace walqt {

class WallpaperWindow;

// MonitorSelector — which monitor(s) a verb applies to.
// Tagged-struct sum type (Go-style): `kind` selects which field is meaningful.
struct MonitorSelector {
    enum class Kind { All, ByNames, ByCurrentSource };
    Kind kind = Kind::All;
    QStringList names;   // populated when kind == ByNames
    QString source;      // populated when kind == ByCurrentSource

    static MonitorSelector all();
    static MonitorSelector byNames(QStringList n);
    static MonitorSelector byCurrentSource(QString s);

    bool operator==(const MonitorSelector &o) const;
};

// MonitorView — pure-data snapshot of one monitor for selector resolution.
// Decouples `resolveIndices` from `WallpaperWindow` so it stays trivially testable.
struct MonitorView {
    QString name;
    QString currentSource;  // empty if nothing currently displayed
};

// --- Decoders (pure functions; one per endpoint family) ---

// /wallpaper/load:
//   { targets: [{name: "..."}, ...] } -> ByNames
//   missing/empty                     -> All
MonitorSelector decodeLoadSelector(const QJsonObject &req);

// /wallpaper/parallax, /wallpaper/parallax-move:
//   { name: "..." }                   -> ByNames([name])
//   else falls back to load-selector shape
MonitorSelector decodeParallaxSelector(const QJsonObject &req);

// /wallpaper/config, /wallpaper/capabilities, /wallpaper/playback:
//   { source_target: "..." }          -> ByCurrentSource
//   missing/empty                     -> ByCurrentSource("") (matches no monitors)
MonitorSelector decodeBySourceSelector(const QJsonObject &req);

// --- Resolution (pure, on POD snapshot) ---

// Returns indices into `monitors` (in input order) that match the selector.
QList<int> resolveIndices(const MonitorSelector &sel,
                          const QList<MonitorView> &monitors);

// --- Convenience overload for the controller ---

// Adapts the controller's `windows_` map into a MonitorView snapshot, calls
// resolveIndices, and returns the selected window pointers in deterministic
// order (the QMap's key order, which is alphabetical).
QList<WallpaperWindow*> resolve(const MonitorSelector &sel,
                                const QMap<QString, WallpaperWindow*> &windows);

} // namespace walqt
```

- [ ] **Step 2: Create `src/wallpaper/monitor_selector.cpp` with empty stubs**

Exact contents (each function returns a default value so the project still links):

```cpp
#include "wallpaper/monitor_selector.h"

#include "wallpaper/wallpaper_window.h"

namespace walqt {

MonitorSelector MonitorSelector::all()                          { return {Kind::All, {}, {}}; }
MonitorSelector MonitorSelector::byNames(QStringList n)         { return {Kind::ByNames, std::move(n), {}}; }
MonitorSelector MonitorSelector::byCurrentSource(QString s)     { return {Kind::ByCurrentSource, {}, std::move(s)}; }

bool MonitorSelector::operator==(const MonitorSelector &o) const {
    return kind == o.kind && names == o.names && source == o.source;
}

MonitorSelector decodeLoadSelector(const QJsonObject &)         { return MonitorSelector::all(); }
MonitorSelector decodeParallaxSelector(const QJsonObject &)     { return MonitorSelector::all(); }
MonitorSelector decodeBySourceSelector(const QJsonObject &)     { return MonitorSelector::byCurrentSource(QString()); }

QList<int> resolveIndices(const MonitorSelector &, const QList<MonitorView> &) { return {}; }

QList<WallpaperWindow*> resolve(const MonitorSelector &,
                                const QMap<QString, WallpaperWindow*> &) {
    return {};
}

} // namespace walqt
```

- [ ] **Step 3: Add the new source file to `src/CMakeLists.txt`**

Append at the end of `src/CMakeLists.txt`:

```cmake
target_sources(wal_qt_lib PRIVATE
    wallpaper/monitor_selector.h
    wallpaper/monitor_selector.cpp
)
```

- [ ] **Step 4: Create `tests/test_monitor_selector.cpp` as a passing skeleton**

Exact contents:

```cpp
#include <QtTest/QtTest>
#include <QJsonArray>
#include <QJsonObject>

#include "wallpaper/monitor_selector.h"

using namespace walqt;

class TestMonitorSelector : public QObject {
    Q_OBJECT
private slots:
    void smoke() {
        auto s = MonitorSelector::all();
        QCOMPARE(s.kind, MonitorSelector::Kind::All);
    }
};

QTEST_GUILESS_MAIN(TestMonitorSelector)
#include "test_monitor_selector.moc"
```

`QTEST_GUILESS_MAIN` runs without a `QGuiApplication` — appropriate for pure-logic tests with no widgets.

- [ ] **Step 5: Register the test in `tests/CMakeLists.txt`**

Add this line alongside the other `walqt_add_test` calls:

```cmake
walqt_add_test(test_monitor_selector)
```

- [ ] **Step 6: Build and run the new test**

Run:

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: build succeeds; `test_monitor_selector` runs and passes (`PASS   : TestMonitorSelector::smoke()`).

If `cmake -B build` has not been run yet in this clone, run that first.

- [ ] **Step 7: Commit**

```sh
git add src/wallpaper/monitor_selector.h src/wallpaper/monitor_selector.cpp \
        src/CMakeLists.txt tests/test_monitor_selector.cpp tests/CMakeLists.txt
git commit -m "wallpaper: add MonitorSelector skeleton (no behaviour yet)"
```

---

## Task 2: TDD `decodeLoadSelector`

The current behaviour to preserve (from `wallpaper_controller.cpp:140–153`): if `req["targets"]` is a non-empty array of `{name}` objects, return those names; otherwise (missing field, empty array, or wrong type), return `All`.

**Files:**
- Modify: `tests/test_monitor_selector.cpp`
- Modify: `src/wallpaper/monitor_selector.cpp`

- [ ] **Step 1: Write failing tests for `decodeLoadSelector`**

Replace the `private slots:` block in `tests/test_monitor_selector.cpp` with:

```cpp
private slots:
    void smoke() {
        QCOMPARE(MonitorSelector::all().kind, MonitorSelector::Kind::All);
    }

    // --- decodeLoadSelector ---

    void load_missingTargets_returnsAll() {
        QJsonObject req;
        QCOMPARE(decodeLoadSelector(req), MonitorSelector::all());
    }

    void load_emptyTargets_returnsAll() {
        QJsonObject req{ {"targets", QJsonArray{}} };
        QCOMPARE(decodeLoadSelector(req), MonitorSelector::all());
    }

    void load_targetsArray_returnsByNamesInOrder() {
        QJsonObject req{
            {"targets", QJsonArray{
                QJsonObject{{"name", "HDMI-A-1"}},
                QJsonObject{{"name", "DP-1"}},
            }}
        };
        const auto sel = decodeLoadSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"HDMI-A-1", "DP-1"}));
    }

    void load_targetsWithoutName_skipsEntry() {
        QJsonObject req{
            {"targets", QJsonArray{
                QJsonObject{{"name", "HDMI-A-1"}},
                QJsonObject{},                                 // no name
                QJsonObject{{"name", ""}},                     // empty name
                QJsonObject{{"name", "DP-1"}},
            }}
        };
        const auto sel = decodeLoadSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"HDMI-A-1", "DP-1"}));
    }

    void load_targetsWrongType_returnsAll() {
        QJsonObject req{ {"targets", "HDMI-A-1"} };  // not an array
        QCOMPARE(decodeLoadSelector(req), MonitorSelector::all());
    }
```

- [ ] **Step 2: Build and run tests, confirm new tests fail**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: `load_targetsArray_returnsByNamesInOrder` and `load_targetsWithoutName_skipsEntry` fail (they expect `ByNames`, the stub returns `All`). `load_*_returnsAll` tests pass coincidentally.

- [ ] **Step 3: Implement `decodeLoadSelector`**

In `src/wallpaper/monitor_selector.cpp`, replace the existing `decodeLoadSelector` stub with:

```cpp
MonitorSelector decodeLoadSelector(const QJsonObject &req)
{
    const auto v = req.value(QStringLiteral("targets"));
    if (!v.isArray())
        return MonitorSelector::all();

    QStringList names;
    for (const auto &entry : v.toArray()) {
        if (!entry.isObject()) continue;
        const QString n = entry.toObject().value(QStringLiteral("name")).toString();
        if (!n.isEmpty()) names.append(n);
    }
    if (names.isEmpty())
        return MonitorSelector::all();
    return MonitorSelector::byNames(std::move(names));
}
```

Add `#include <QJsonArray>` to the top of `monitor_selector.cpp` if not already present.

- [ ] **Step 4: Build and run tests, confirm green**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: all `load_*` tests pass.

- [ ] **Step 5: Commit**

```sh
git add tests/test_monitor_selector.cpp src/wallpaper/monitor_selector.cpp
git commit -m "wallpaper: implement decodeLoadSelector"
```

---

## Task 3: TDD `decodeParallaxSelector`

The current behaviour to preserve (from `wallpaper_controller.cpp:155–164`): if `req["name"]` is a non-empty string, return `ByNames([name])`; otherwise fall back to load-selector behaviour.

**Files:**
- Modify: `tests/test_monitor_selector.cpp`
- Modify: `src/wallpaper/monitor_selector.cpp`

- [ ] **Step 1: Append failing tests**

Add inside the `private slots:` block in `tests/test_monitor_selector.cpp`:

```cpp
    // --- decodeParallaxSelector ---

    void parallax_singleName_returnsByNames() {
        QJsonObject req{ {"name", "HDMI-A-1"} };
        const auto sel = decodeParallaxSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"HDMI-A-1"}));
    }

    void parallax_emptyName_fallsBackToLoad() {
        QJsonObject req{ {"name", ""}, {"targets", QJsonArray{
            QJsonObject{{"name", "DP-1"}}
        }} };
        const auto sel = decodeParallaxSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"DP-1"}));
    }

    void parallax_missingName_andMissingTargets_returnsAll() {
        QJsonObject req;
        QCOMPARE(decodeParallaxSelector(req), MonitorSelector::all());
    }

    void parallax_nameWrongType_fallsBackToLoad() {
        QJsonObject req{ {"name", 42} };
        QCOMPARE(decodeParallaxSelector(req), MonitorSelector::all());
    }
```

- [ ] **Step 2: Build and run tests, confirm new tests fail**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: `parallax_singleName_returnsByNames` and `parallax_emptyName_fallsBackToLoad` fail.

- [ ] **Step 3: Implement `decodeParallaxSelector`**

Replace the stub in `monitor_selector.cpp`:

```cpp
MonitorSelector decodeParallaxSelector(const QJsonObject &req)
{
    const QString n = req.value(QStringLiteral("name")).toString();
    if (!n.isEmpty())
        return MonitorSelector::byNames({n});
    return decodeLoadSelector(req);
}
```

- [ ] **Step 4: Build and run tests, confirm green**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: all parallax tests pass.

- [ ] **Step 5: Commit**

```sh
git add tests/test_monitor_selector.cpp src/wallpaper/monitor_selector.cpp
git commit -m "wallpaper: implement decodeParallaxSelector"
```

---

## Task 4: TDD `decodeBySourceSelector`

Behaviour to preserve (from `wallpaper_controller.cpp:251–306`): unconditionally read `req["source_target"]` as a string and produce `ByCurrentSource(value)`. Empty / missing → `ByCurrentSource("")` (which will match no monitors at resolve time).

**Files:**
- Modify: `tests/test_monitor_selector.cpp`
- Modify: `src/wallpaper/monitor_selector.cpp`

- [ ] **Step 1: Append failing tests**

Add inside the `private slots:` block:

```cpp
    // --- decodeBySourceSelector ---

    void bySource_present_returnsByCurrentSource() {
        QJsonObject req{ {"source_target", "/path/to/wp.jpg"} };
        const auto sel = decodeBySourceSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByCurrentSource);
        QCOMPARE(sel.source, QStringLiteral("/path/to/wp.jpg"));
    }

    void bySource_missing_returnsByCurrentSourceEmpty() {
        QJsonObject req;
        const auto sel = decodeBySourceSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByCurrentSource);
        QCOMPARE(sel.source, QString());
    }
```

- [ ] **Step 2: Build and run tests, confirm fail**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: `bySource_present_returnsByCurrentSource` fails (stub already returns `ByCurrentSource("")` for the missing case, so that one passes).

- [ ] **Step 3: Implement `decodeBySourceSelector`**

Replace the stub:

```cpp
MonitorSelector decodeBySourceSelector(const QJsonObject &req)
{
    return MonitorSelector::byCurrentSource(
        req.value(QStringLiteral("source_target")).toString());
}
```

- [ ] **Step 4: Build and run tests, confirm green**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: all decoder tests pass.

- [ ] **Step 5: Commit**

```sh
git add tests/test_monitor_selector.cpp src/wallpaper/monitor_selector.cpp
git commit -m "wallpaper: implement decodeBySourceSelector"
```

---

## Task 5: TDD `resolveIndices`

Pure function from `(MonitorSelector, QList<MonitorView>)` to a list of indices into the input `monitors` list, preserving input order. Behaviour:
- `All` → indices `[0..n)` in order.
- `ByNames` → for each requested name, in the order given, append the matching monitor's index if found. Unknown names are skipped silently. Duplicate names produce duplicate indices (preserves the existing behaviour: today's resolveTargets does the same).
- `ByCurrentSource("")` → empty (no monitor's currentSource matches an empty filter, by current behaviour).
- `ByCurrentSource(s)` (non-empty) → indices of all monitors whose `currentSource == s`, in input order.

**Files:**
- Modify: `tests/test_monitor_selector.cpp`
- Modify: `src/wallpaper/monitor_selector.cpp`

- [ ] **Step 1: Append failing tests**

Add inside the `private slots:` block:

```cpp
    // --- resolveIndices ---

    void resolve_all_returnsAllIndicesInOrder() {
        QList<MonitorView> ms{
            {"HDMI-A-1", ""}, {"DP-1", "/x.jpg"}, {"eDP-1", ""}
        };
        QCOMPARE(resolveIndices(MonitorSelector::all(), ms),
                 (QList<int>{0, 1, 2}));
    }

    void resolve_all_emptyMonitors_returnsEmpty() {
        QCOMPARE(resolveIndices(MonitorSelector::all(), {}), QList<int>{});
    }

    void resolve_byNames_picksRequestedInRequestedOrder() {
        QList<MonitorView> ms{
            {"HDMI-A-1", ""}, {"DP-1", ""}, {"eDP-1", ""}
        };
        const auto sel = MonitorSelector::byNames({"DP-1", "HDMI-A-1"});
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{1, 0}));
    }

    void resolve_byNames_unknownNameSkipped() {
        QList<MonitorView> ms{ {"HDMI-A-1", ""} };
        const auto sel = MonitorSelector::byNames({"NOPE", "HDMI-A-1"});
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{0}));
    }

    void resolve_byNames_duplicateNamesProduceDuplicateIndices() {
        QList<MonitorView> ms{ {"HDMI-A-1", ""} };
        const auto sel = MonitorSelector::byNames({"HDMI-A-1", "HDMI-A-1"});
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{0, 0}));
    }

    void resolve_byCurrentSource_matchesByEquality() {
        QList<MonitorView> ms{
            {"HDMI-A-1", "/a.jpg"},
            {"DP-1",     "/b.jpg"},
            {"eDP-1",    "/a.jpg"},
        };
        const auto sel = MonitorSelector::byCurrentSource("/a.jpg");
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{0, 2}));
    }

    void resolve_byCurrentSource_emptyStringMatchesNothing() {
        QList<MonitorView> ms{
            {"HDMI-A-1", ""}, {"DP-1", "/b.jpg"}
        };
        const auto sel = MonitorSelector::byCurrentSource("");
        QCOMPARE(resolveIndices(sel, ms), QList<int>{});
    }
```

- [ ] **Step 2: Build and run tests, confirm fail**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: all `resolve_*` tests fail (stub returns `{}`).

- [ ] **Step 3: Implement `resolveIndices`**

Replace the stub in `monitor_selector.cpp`:

```cpp
QList<int> resolveIndices(const MonitorSelector &sel,
                          const QList<MonitorView> &monitors)
{
    QList<int> out;
    switch (sel.kind) {
    case MonitorSelector::Kind::All:
        out.reserve(monitors.size());
        for (int i = 0; i < monitors.size(); ++i) out.append(i);
        return out;

    case MonitorSelector::Kind::ByNames:
        for (const QString &requested : sel.names) {
            for (int i = 0; i < monitors.size(); ++i) {
                if (monitors[i].name == requested) {
                    out.append(i);
                    break;
                }
            }
        }
        return out;

    case MonitorSelector::Kind::ByCurrentSource:
        if (sel.source.isEmpty()) return out;
        for (int i = 0; i < monitors.size(); ++i) {
            if (monitors[i].currentSource == sel.source)
                out.append(i);
        }
        return out;
    }
    return out;
}
```

- [ ] **Step 4: Build and run tests, confirm green**

```sh
cmake --build build -j && ctest --test-dir build --output-on-failure -R test_monitor_selector
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add tests/test_monitor_selector.cpp src/wallpaper/monitor_selector.cpp
git commit -m "wallpaper: implement resolveIndices"
```

---

## Task 6: Implement `resolve()` convenience overload

Adapter from controller's `QMap<QString, WallpaperWindow*>` to `MonitorView` snapshot + `resolveIndices`. Cannot easily unit-test in isolation (depends on `WallpaperWindow`), but its body is mechanical and exercised end-to-end by Task 7's controller refactor + the existing daemon smoke test in Task 8.

**Files:**
- Modify: `src/wallpaper/monitor_selector.cpp`

- [ ] **Step 1: Replace the `resolve` stub with the real implementation**

In `src/wallpaper/monitor_selector.cpp`, replace the `resolve` stub with:

```cpp
QList<WallpaperWindow*> resolve(const MonitorSelector &sel,
                                const QMap<QString, WallpaperWindow*> &windows)
{
    // QMap iterates in key order (alphabetical), giving deterministic order.
    QList<MonitorView> snapshot;
    QList<WallpaperWindow*> ordered;
    snapshot.reserve(windows.size());
    ordered.reserve(windows.size());

    for (auto it = windows.cbegin(); it != windows.cend(); ++it) {
        WallpaperWindow *w = it.value();
        snapshot.append({ it.key(), w ? w->currentTarget() : QString() });
        ordered.append(w);
    }

    QList<WallpaperWindow*> result;
    for (int i : resolveIndices(sel, snapshot))
        result.append(ordered[i]);
    return result;
}
```

`WallpaperWindow::currentTarget()` is the existing accessor (`wallpaper_window.h:29`); we still call it that here — the rename to `currentSource()` is a separate future task.

- [ ] **Step 2: Build, confirm everything still compiles**

```sh
cmake --build build -j
```

Expected: clean build. (No new tests yet — controller refactor in Task 7 exercises this code path through the existing daemon.)

- [ ] **Step 3: Commit**

```sh
git add src/wallpaper/monitor_selector.cpp
git commit -m "wallpaper: implement resolve() convenience overload"
```

---

## Task 7: Refactor `WallpaperController` to use the new module

Replace the three ad-hoc patterns in `wallpaper_controller.cpp` with `decode*` + `resolve` calls. Remove the now-dead `resolveTargets` and `resolveParallaxTargets` private helpers.

**Files:**
- Modify: `src/wallpaper/wallpaper_controller.h`
- Modify: `src/wallpaper/wallpaper_controller.cpp`

- [ ] **Step 1: Add the new include and remove dead method declarations from the header**

In `src/wallpaper/wallpaper_controller.h`:

1. Below the existing `#include "http/http_server.h"` line, add:
   ```cpp
   #include "wallpaper/monitor_selector.h"
   ```

2. Delete these two lines (currently lines 46–47):
   ```cpp
       QList<WallpaperWindow*> resolveTargets(const QJsonObject &req) const;
       QList<WallpaperWindow*> resolveParallaxTargets(const QJsonObject &req) const;
   ```

- [ ] **Step 2: Replace `handleLoad` body**

In `src/wallpaper/wallpaper_controller.cpp`, replace the body of `handleLoad` (currently lines 169–197) with:

```cpp
void WallpaperController::handleLoad(const QJsonObject &req, HttpResponder respond)
{
    auto targets = resolve(decodeLoadSelector(req), windows_);
    if (targets.isEmpty()) {
        respond(404, R"({"error":"no matching monitors"})");
        return;
    }

    bool wait = req.value("wait_for_completion").toBool(false);

    if (!wait) {
        respond(202, R"({"ok":true,"accepted":true})");
        for (auto *w : targets)
            w->loadContent(req, nullptr);
        return;
    }

    auto pending = std::make_shared<PendingLoad>(
        targets.size(),
        [respond](int s, const QByteArray &b) { respond(s, b); });

    for (auto *w : targets) {
        w->loadContent(req, [pending](bool ok, QString err) {
            pending->ack(ok, err);
        });
    }

    QTimer::singleShot(30000, this, [pending] { pending->timeout(); });
}
```

- [ ] **Step 3: Replace `handleParallax` and `handleParallaxMove` bodies**

Replace the bodies of `handleParallax` (currently lines 202–208) and `handleParallaxMove` (currently lines 213–219) with:

```cpp
void WallpaperController::handleParallax(const QJsonObject &req, HttpResponder respond)
{
    for (auto *w : resolve(decodeParallaxSelector(req), windows_))
        w->setParallax(req);
    respond(200, R"({"ok":true})");
}

void WallpaperController::handleParallaxMove(const QJsonObject &req, HttpResponder respond)
{
    for (auto *w : resolve(decodeParallaxSelector(req), windows_))
        w->setParallaxMove(req);
    respond(200, R"({"ok":true})");
}
```

- [ ] **Step 4: Replace `handleConfig`, `handleCaps`, `handlePlayback` bodies**

Replace the bodies of `handleConfig` (currently lines 251–266), `handleCaps` (currently lines 271–286), and `handlePlayback` (currently lines 291–306) with:

```cpp
void WallpaperController::handleConfig(const QJsonObject &req, HttpResponder respond)
{
    auto matches = resolve(decodeBySourceSelector(req), windows_);
    for (auto *w : matches)
        w->pushWallpaperConfig(req);
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", static_cast<int>(matches.size())}
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

void WallpaperController::handleCaps(const QJsonObject &req, HttpResponder respond)
{
    auto matches = resolve(decodeBySourceSelector(req), windows_);
    for (auto *w : matches)
        w->pushCapabilities(req);
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", static_cast<int>(matches.size())}
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

void WallpaperController::handlePlayback(const QJsonObject &req, HttpResponder respond)
{
    auto matches = resolve(decodeBySourceSelector(req), windows_);
    for (auto *w : matches)
        w->setPlaybackPolicy(req);
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", static_cast<int>(matches.size())}
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}
```

- [ ] **Step 5: Delete the now-dead `resolveTargets` and `resolveParallaxTargets` definitions**

In `src/wallpaper/wallpaper_controller.cpp`, delete lines 137–164 inclusive (the two helper function definitions and their banner comments). Do not remove anything else; the next non-removed line should be the `// --- handleLoad ---` banner.

- [ ] **Step 6: Build the whole project**

```sh
cmake --build build -j
```

Expected: clean build with no warnings or errors. If you see "unused function" or "undeclared identifier" errors, you missed a deletion in step 5 or a header change in step 1.

- [ ] **Step 7: Run the entire test suite**

```sh
ctest --test-dir build --output-on-failure
```

Expected: every existing test still passes, plus all `test_monitor_selector` cases.

- [ ] **Step 8: Commit**

```sh
git add src/wallpaper/wallpaper_controller.h src/wallpaper/wallpaper_controller.cpp
git commit -m "wallpaper: route handlers through MonitorSelector

Replaces resolveTargets / resolveParallaxTargets / inline source_target
filter loops with typed selector + pure resolve(). No behavioural change."
```

---

## Task 8: End-to-end smoke test

Build the binary and confirm the daemon still starts, serves `/health`, and reports status. We're not adding new behaviour, so the existing tests already prove correctness; this catches anything Qt-specific that unit tests miss (e.g. signal connections, build flags).

**Files:** none modified.

- [ ] **Step 1: Confirm a clean Release build**

```sh
cmake -B build-release -DCMAKE_BUILD_TYPE=Release
cmake --build build-release -j
```

Expected: clean build, produces `build-release/wal-qt`.

- [ ] **Step 2: Smoke-test `/health` over the Unix socket**

In one terminal:

```sh
# Make sure no stale instance is bound:
rm -f "$XDG_RUNTIME_DIR/wayland-utauri.sock" "$XDG_RUNTIME_DIR/wayland-utauri.lock" 2>/dev/null
./build-release/wal-qt &
WALQT_PID=$!
sleep 1
```

In the same shell:

```sh
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" http://localhost/health
```

Expected output (Compact JSON, exact keys/values):

```json
{"ok":true,"service":"wayland-utauri","api_version":"0"}
```

Then:

```sh
curl --unix-socket "$XDG_RUNTIME_DIR/wayland-utauri.sock" http://localhost/wallpaper/status
```

Expected: a JSON document containing `"ok":true`, `"api_version":"0"`, and a `"status"` object listing each connected monitor under `monitors`.

- [ ] **Step 3: Stop the daemon**

```sh
kill $WALQT_PID
wait $WALQT_PID 2>/dev/null
rm -f "$XDG_RUNTIME_DIR/wayland-utauri.sock" "$XDG_RUNTIME_DIR/wayland-utauri.lock"
```

- [ ] **Step 4: Final commit (only if the smoke test required any touch-ups)**

If steps 1–3 succeeded with no edits, skip this step. Otherwise commit any fixes:

```sh
git add -A
git commit -m "wallpaper: fix issue surfaced by post-MonitorSelector smoke test"
```

---

## Self-Review Notes

- **Spec coverage:** every behaviour in the original `resolveTargets` / `resolveParallaxTargets` / `source_target` filter loops is covered by a test in tasks 2–5; controller refactor in task 7 wires them up; smoke test in task 8 verifies end-to-end.
- **No placeholders:** every step contains complete code or an exact command.
- **Type consistency:** `MonitorSelector`, `MonitorView`, `decodeLoadSelector`, `decodeParallaxSelector`, `decodeBySourceSelector`, `resolveIndices`, `resolve` — all defined in Task 1, used identically thereafter. Convenience `resolve()` and pure `resolveIndices()` are deliberately distinct names.
- **Unchanged behaviour:** the refactor is structural only. The same JSON request fields produce the same window selections; status endpoint is untouched; HTTP routing is untouched; `WallpaperWindow` interface is untouched.
- **Migration path for next plan:** `MonitorView::currentSource` is the new name (matches `CONTEXT.md`), but the convenience `resolve()` still calls `WallpaperWindow::currentTarget()` because that's the existing accessor. Renaming `currentTarget()` → `currentSource()` is part of step 2 in the broader roadmap, not this plan.
