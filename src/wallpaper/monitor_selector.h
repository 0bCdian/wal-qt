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
