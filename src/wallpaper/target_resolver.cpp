#include "target_resolver.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>

namespace walqt {

WebManifest parseManifest(const QString &manifestPath)
{
    WebManifest m;
    QFile f(manifestPath);
    if (!f.open(QIODevice::ReadOnly))
        return m;

    auto obj = QJsonDocument::fromJson(f.readAll()).object();

    m.entry = obj["entry"].toString(obj["file"].toString("index.html"));

    auto caps = obj["capabilities"].toObject();
    m.network           = caps["network"].toBool(false);
    m.pointerInteractive = caps["pointer_interactive"].toBool(false);
    m.audioReactive     = caps["audio_reactive"].toBool(false);
    m.keyboard          = caps["keyboard"].toBool(false);
    m.autoplay          = caps["autoplay"].toBool(true);

    m.wallpaperConfig = obj["wallpaper_config"].toObject();

    return m;
}

ResolvedWebTarget resolveWebTarget(const QString &target)
{
    QFileInfo fi(target);
    if (!fi.exists())
        return {};

    ResolvedWebTarget r;

    // Case 1: explicit manifest file (waypaper.json or project.json)
    if (fi.fileName() == "waypaper.json" || fi.fileName() == "project.json") {
        r.packageRoot = fi.absolutePath();
        r.manifest = parseManifest(fi.absoluteFilePath());
        r.hasManifest = true;
        r.entryFile = r.packageRoot + "/" + r.manifest.entry;
        if (!QFileInfo(r.entryFile).exists())
            return {};
        return r;
    }

    // Case 2: directory
    if (fi.isDir()) {
        r.packageRoot = fi.absoluteFilePath();

        QString manifestFile;
        if (QFileInfo(r.packageRoot + "/waypaper.json").exists())
            manifestFile = r.packageRoot + "/waypaper.json";
        else if (QFileInfo(r.packageRoot + "/project.json").exists())
            manifestFile = r.packageRoot + "/project.json";

        if (!manifestFile.isEmpty()) {
            r.manifest = parseManifest(manifestFile);
            r.hasManifest = true;
            r.entryFile = r.packageRoot + "/" + r.manifest.entry;
            if (!QFileInfo(r.entryFile).exists())
                return {};
            return r;
        }

        // Fallback: index.html
        QString indexHtml = r.packageRoot + "/index.html";
        if (QFileInfo(indexHtml).exists()) {
            r.entryFile = indexHtml;
            r.hasManifest = false;
            return r;
        }

        return {};
    }

    // Case 3: HTML file
    if (fi.suffix().toLower() == "html") {
        r.entryFile = fi.absoluteFilePath();
        r.packageRoot = fi.absolutePath();

        // Walk up at most 3 levels looking for waypaper.json
        QDir d(r.packageRoot);
        for (int i = 0; i < 4; ++i) {
            if (d.exists("waypaper.json")) {
                r.manifest = parseManifest(d.absoluteFilePath("waypaper.json"));
                r.hasManifest = true;
                break;
            }
            if (!d.cdUp())
                break;
        }

        return r;
    }

    return {};
}

} // namespace walqt
