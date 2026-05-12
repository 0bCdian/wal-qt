#pragma once

#include <QString>

namespace walqt {

// Baseline Chromium flags for lower RAM use (wal-qt wallpaper host).
// Duplicate keys across merged strings follow Chromium parsing (often last occurrence wins).

struct ChromiumBaselineOptions {
    bool experimentalSingleProcess = false;
    bool noSandbox = false;
};

QString baselineChromiumFlags(ChromiumBaselineOptions options);

// Prepend-preserving merge: existing (user / distro env) stays first;
// wal-qt baseline is appended. Testable without touching the environment.
QString composeChromiumFlags(const QString &existing, ChromiumBaselineOptions options);

// When WAL_QT_WEBENGINE_TUNING=1|true|yes: merges QTWEBENGINE_CHROMIUM_FLAGS (user prefix kept
// first) with wal-qt baseline; honors WAL_QT_EXPERIMENTAL_SINGLE_PROCESS and WAL_QT_WEBENGINE_NO_SANDBOX.
// With tuning **off** (default): leaves QTWEBENGINE_CHROMIUM_FLAGS unchanged — matches main-branch
// launch behavior/steady-state footprint before optional Chromium tweaking.
//
// Call before QApplication / WebEngine init.
// With single-process, Qt WebEngine may log ERROR "Cannot use V8 Proxy resolver in single
// process mode": expected; V8-backed PAC resolution is skipped; fixed/system proxy still applies.
//
// WAL_QT_WEBENGINE_NO_SANDBOX appends --no-sandbox only when tuning is enabled (testing only).
void applyChromiumEnvironment();

} // namespace walqt
