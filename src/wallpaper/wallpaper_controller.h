#pragma once
#include <QObject>
#include <QMap>
#include <QJsonObject>
#include "http/http_server.h"   // for HttpRequest, HttpResponder

class QScreen;

namespace walqt {
class WallpaperWindow;
class WaypaperHtmlSchemeHandler;
class NetworkInterceptor;

class WallpaperController : public QObject {
    Q_OBJECT
public:
    WallpaperController(WaypaperHtmlSchemeHandler *sh,
                        NetworkInterceptor *ni,
                        QObject *parent = nullptr);
    ~WallpaperController() override;

    void init();   // builds windows for all current screens

public slots:
    // Connected to HttpServer::requestReceived (queued connection on main thread).
    void handleRequest(walqt::HttpRequest req, walqt::HttpResponder respond);

private slots:
    void onScreenAdded(QScreen *s);
    void onScreenRemoved(QScreen *s);

private:
    WaypaperHtmlSchemeHandler *schemeHandler_;
    NetworkInterceptor *interceptor_;
    QMap<QString, WallpaperWindow*> windows_;
    int nextMonitorIndex_ = 0;
    bool networkEnabled_ = false;

    void route(const QString &method, const QString &path,
               const QJsonObject &body, HttpResponder respond);

    QJsonObject statusJson() const;
    QList<WallpaperWindow*> resolveTargets(const QJsonObject &req) const;

    void handleLoad        (const QJsonObject &req, HttpResponder respond);
    void handleParallax    (const QJsonObject &req, HttpResponder respond);
    void handleParallaxMove(const QJsonObject &req, HttpResponder respond);
    void handleNetwork     (const QJsonObject &req, HttpResponder respond);
    void handleConfig      (const QJsonObject &req, HttpResponder respond);
    void handleCaps        (const QJsonObject &req, HttpResponder respond);
    void handlePlayback    (const QJsonObject &req, HttpResponder respond);
};
}
