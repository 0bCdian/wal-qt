#include "wallpaper/monitor_selector.h"

#include "wallpaper/wallpaper_window.h"

#include <QJsonArray>

namespace walqt {

MonitorSelector MonitorSelector::all()
{
    return {Kind::All, {}, {}};
}
MonitorSelector MonitorSelector::byNames(QStringList n)
{
    return {Kind::ByNames, std::move(n), {}};
}
MonitorSelector MonitorSelector::byCurrentSource(QString s)
{
    return {Kind::ByCurrentSource, {}, std::move(s)};
}

bool MonitorSelector::operator==(const MonitorSelector &o) const
{
    return kind == o.kind && names == o.names && source == o.source;
}

MonitorSelector decodeLoadSelector(const QJsonObject &req)
{
    const auto v = req.value(QStringLiteral("targets"));
    if (!v.isArray())
        return MonitorSelector::all();

    QStringList names;
    for (const auto &entry : v.toArray()) {
        if (!entry.isObject())
            continue;
        const QString n = entry.toObject().value(QStringLiteral("name")).toString();
        if (!n.isEmpty())
            names.append(n);
    }
    if (names.isEmpty())
        return MonitorSelector::all();
    return MonitorSelector::byNames(std::move(names));
}

MonitorSelector decodeParallaxSelector(const QJsonObject &req)
{
    const QString n = req.value(QStringLiteral("name")).toString();
    if (!n.isEmpty())
        return MonitorSelector::byNames({n});
    return decodeLoadSelector(req);
}

MonitorSelector decodeBySourceSelector(const QJsonObject &req)
{
    return MonitorSelector::byCurrentSource(
        req.value(QStringLiteral("source_target")).toString());
}

QList<int> resolveIndices(const MonitorSelector &sel,
                          const QList<MonitorView> &monitors)
{
    QList<int> out;
    switch (sel.kind) {
    case MonitorSelector::Kind::All:
        out.reserve(monitors.size());
        for (int i = 0; i < monitors.size(); ++i)
            out.append(i);
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
        if (sel.source.isEmpty())
            return out;
        for (int i = 0; i < monitors.size(); ++i) {
            if (monitors[i].currentSource == sel.source)
                out.append(i);
        }
        return out;
    }
    return out;
}

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
        snapshot.append({it.key(), w ? w->currentTarget() : QString()});
        ordered.append(w);
    }

    QList<WallpaperWindow*> result;
    for (int i : resolveIndices(sel, snapshot))
        result.append(ordered[i]);
    return result;
}

} // namespace walqt
