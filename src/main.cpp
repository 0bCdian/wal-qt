#include <QApplication>
#include <QByteArray>
#include <QWebEngineUrlScheme>
#include <QWebEngineProfile>

#include <LayerShellQt/Shell>

#include "app/app.h"
#include "app/single_instance.h"
#include "web/scheme_handler.h"
#include "web/network_interceptor.h"

int main(int argc, char *argv[]) {
    // Chromium flags MUST be set before QApplication is constructed.
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-accelerated-video-decode");

    // Default to wayland platform if not already set externally.
    if (qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
        qputenv("QT_QPA_PLATFORM", "wayland");

    // Install LayerShellQt as the Wayland shell integration BEFORE QApplication.
    // Without this, QWindow surfaces go through xdg-toplevel and ignore per-window
    // LayerShellQt::Window::get() configuration — the windows appear as floating
    // top-levels instead of background-layer surfaces. Marked deprecated upstream
    // ("not needed since Qt 6.5") but still load-bearing in practice — the PoC at
    // ../test-poc-qt/main.cpp confirms; without it wallpapers render as toplevels.
    QT_WARNING_PUSH
    QT_WARNING_DISABLE_DEPRECATED
    LayerShellQt::Shell::useLayerShell();
    QT_WARNING_POP

    // Register custom URL scheme BEFORE QApplication.
    QWebEngineUrlScheme scheme("waypaperhtml");
    scheme.setFlags(QWebEngineUrlScheme::SecureScheme |
                    QWebEngineUrlScheme::LocalScheme |
                    QWebEngineUrlScheme::LocalAccessAllowed |
                    QWebEngineUrlScheme::CorsEnabled);
    QWebEngineUrlScheme::registerScheme(scheme);

    QApplication app(argc, argv);
    app.setApplicationName("wal-qt");
    app.setApplicationVersion("0.1");

    walqt::SingleInstance lock;
    if (!lock.acquire()) {
        qCritical("Another wal-qt instance is already running");
        return 1;
    }

    auto *interceptor = new walqt::NetworkInterceptor(&app);
    QWebEngineProfile::defaultProfile()->setUrlRequestInterceptor(interceptor);

    auto *schemeHandler = new walqt::WaypaperHtmlSchemeHandler(&app);
    QWebEngineProfile::defaultProfile()
        ->installUrlSchemeHandler("waypaperhtml", schemeHandler);

    walqt::App walapp(schemeHandler, interceptor);
    if (!walapp.start()) {
        qCritical("Failed to bind control socket");
        return 1;
    }

    return app.exec();
}
