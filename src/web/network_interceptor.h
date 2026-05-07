#pragma once
#include <QWebEngineUrlRequestInterceptor>
#include <QStringList>
#include <QString>
namespace walqt {
bool shouldBlock(const QString &scheme, const QString &host,
                 bool networkEnabled, const QStringList &allowlist);

class NetworkInterceptor : public QWebEngineUrlRequestInterceptor {
    Q_OBJECT
public:
    using QWebEngineUrlRequestInterceptor::QWebEngineUrlRequestInterceptor;
    void setNetworkEnabled(bool e) { enabled_ = e; }
    void setAllowlist(const QStringList &h) { allowlist_ = h; }
    void interceptRequest(QWebEngineUrlRequestInfo &info) override;
private:
    bool enabled_ = false;
    QStringList allowlist_;
};
}
