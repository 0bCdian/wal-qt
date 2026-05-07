#include "wallpaper/wallpaper_bridge.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>

walqt::WallpaperBridge::WallpaperBridge(int monitorId, QObject *parent)
    : QObject(parent), monitorId_(monitorId) {}

void walqt::WallpaperBridge::transitionResult(const QString &json) {
    QJsonObject result = QJsonDocument::fromJson(json.toUtf8()).object();
    bool ok = result.value("ok").toBool(true);
    QString err = result.value("error").toString();
    emit transitionAck(monitorId_, ok, err);
}

void walqt::WallpaperBridge::log(const QString &level, const QString &message) {
    QString tag = QStringLiteral("[walBridge:m%1] ").arg(monitorId_);
    QString lvl = level.toLower();
    if (lvl == "warn" || lvl == "warning")
        qWarning("%s%s", qUtf8Printable(tag), qUtf8Printable(message));
    else if (lvl == "error" || lvl == "err")
        qCritical("%s%s", qUtf8Printable(tag), qUtf8Printable(message));
    else
        qInfo("%s%s", qUtf8Printable(tag), qUtf8Printable(message));
}
