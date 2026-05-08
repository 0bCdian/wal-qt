#pragma once
#include <QString>
#include <QJsonObject>
namespace walqt {
struct WebManifest {
    QString entry = "index.html";
    bool network = false;
    bool pointerInteractive = false;
    bool audioReactive = false;
    bool keyboard = false;
    bool autoplay = true;
    QJsonObject wallpaperConfig;
};
struct ResolvedWebTarget {
    QString packageRoot;   // absolute, no trailing slash
    QString entryFile;     // absolute path to entry html
    WebManifest manifest;  // defaults if no manifest present
    bool hasManifest = false;
};
ResolvedWebTarget resolveWebTarget(const QString &target);
WebManifest parseManifest(const QString &manifestPath);
}
