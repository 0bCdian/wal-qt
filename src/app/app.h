#pragma once
#include <QObject>
namespace walqt {
class WallpaperController;
class HttpServer;
class WaypaperHtmlSchemeHandler;
class NetworkInterceptor;
class App : public QObject {
    Q_OBJECT
public:
    App(WaypaperHtmlSchemeHandler *sh, NetworkInterceptor *ni, QObject *parent = nullptr);
    bool start();
private:
    WaypaperHtmlSchemeHandler *schemeHandler_;
    NetworkInterceptor *interceptor_;
    WallpaperController *controller_ = nullptr;
    HttpServer *server_ = nullptr;
};
}
