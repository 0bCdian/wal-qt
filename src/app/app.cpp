#include "app/app.h"
#include "wallpaper/wallpaper_controller.h"
#include "http/http_server.h"
#include "util/socket_path.h"

walqt::App::App(WaypaperHtmlSchemeHandler *sh, NetworkInterceptor *ni, QObject *parent)
    : QObject(parent), schemeHandler_(sh), interceptor_(ni) {}

bool walqt::App::start() {
    controller_ = new WallpaperController(schemeHandler_, interceptor_, this);
    controller_->init();

    server_ = new HttpServer(walqt::socketPath(), this);
    connect(server_, &HttpServer::requestReceived,
            controller_, &WallpaperController::handleRequest,
            Qt::QueuedConnection);
    return server_->listen();
}
