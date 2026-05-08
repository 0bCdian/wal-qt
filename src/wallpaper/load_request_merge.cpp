#include "wallpaper/load_request_merge.h"

#include <QJsonArray>

namespace walqt {

QJsonObject mergeLoadRequestTargetForScreen(const QJsonObject &req, const QString &screenName)
{
    const QJsonValue tv = req.value(QStringLiteral("targets"));
    if (!tv.isArray() || screenName.isEmpty())
        return req;

    QString targetPath;
    QString rowKind;
    for (const QJsonValue &e : tv.toArray()) {
        if (!e.isObject())
            continue;
        const QJsonObject row = e.toObject();
        if (row.value(QStringLiteral("name")).toString() != screenName)
            continue;
        targetPath = row.value(QStringLiteral("target")).toString();
        rowKind = row.value(QStringLiteral("kind")).toString();
        break;
    }
    if (targetPath.isEmpty())
        return req;

    QJsonObject out = req;
    out.insert(QStringLiteral("target"), targetPath);
    if (!rowKind.isEmpty())
        out.insert(QStringLiteral("kind"), rowKind);
    return out;
}

} // namespace walqt
