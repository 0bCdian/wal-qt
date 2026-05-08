#include "web/network_interceptor.h"
#include <QSet>
#include <QWebEngineUrlRequestInfo>

bool walqt::shouldBlock(const QString &scheme, const QString &host,
                        bool enabled, const QStringList &allow) {
    static const QSet<QString> local{"waypaperhtml","walfile","file","qrc","data","blob"};
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
