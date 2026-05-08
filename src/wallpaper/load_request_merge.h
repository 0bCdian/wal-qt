#pragma once

#include <QJsonObject>
#include <QString>

namespace walqt {

/**
 * waypaper-engine sends `targets: [{name, target, kind?}, ...]` for individual mode and
 * extend (split) loads; root `target` is only set for clone/extend single-image. Merge the
 * row matching `screenName` into root `target` / `kind` so each WallpaperWindow can load.
 */
[[nodiscard]] QJsonObject mergeLoadRequestTargetForScreen(const QJsonObject &req,
                                                          const QString &screenName);

} // namespace walqt
