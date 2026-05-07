#include "wallpaper/wallpaper_window.h"
#include "wallpaper/wallpaper_bridge.h"
#include "wallpaper/target_resolver.h"
#include "web/scheme_handler.h"
#include "web/network_interceptor.h"
#include "web/csp_injector.h"

#include <QVBoxLayout>
#include <QScreen>
#include <QWindow>
#include <QWebEngineView>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebChannel>
#include <QFile>
#include <QJsonDocument>
#include <QUrl>
#include <QRegion>

#include <LayerShellQt/Window>
#include <LayerShellQt/Shell>

walqt::WallpaperWindow::WallpaperWindow(QScreen *screen, int monitorIndex,
                                        WaypaperHtmlSchemeHandler *sh,
                                        NetworkInterceptor *ni,
                                        QWidget *parent)
    : QWidget(parent),
      monitorIndex_(monitorIndex),
      screenName_(screen ? screen->name() : QString()),
      schemeHandler_(sh),
      interceptor_(ni)
{
    setWindowFlags(Qt::Window);   // NOT FramelessWindowHint (X11 hint, harmful on Wayland)

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);

    view_ = new QWebEngineView(this);
    layout->addWidget(view_);

    setupLayerShell(screen);
    installBridgeAndUserScripts();
    loadRendererShell();

    // Default click-through (spec §11) — pointer events pass through to surfaces below.
    setPointerInteractive(false);

    show();   // NOT showFullScreen() — conflicts with layer-shell on Hyprland.
}

void walqt::WallpaperWindow::setupLayerShell(QScreen *screen) {
    // Force native QWaylandWindow creation BEFORE mapping (spec §3.2 step 1).
    winId();
    QWindow *win = windowHandle();
    if (!win) {
        qWarning("WallpaperWindow: no windowHandle() after winId()");
        return;
    }
    if (screen) win->setScreen(screen);

    auto *ls = LayerShellQt::Window::get(win);
    if (!ls) {
        qWarning("WallpaperWindow: LayerShellQt::Window::get returned null — compositor lacks zwlr_layer_shell_v1?");
        return;
    }
    ls->setLayer(LayerShellQt::Window::LayerBackground);
    ls->setAnchors(LayerShellQt::Window::Anchors(
          LayerShellQt::Window::AnchorTop
        | LayerShellQt::Window::AnchorBottom
        | LayerShellQt::Window::AnchorLeft
        | LayerShellQt::Window::AnchorRight));
    ls->setExclusiveZone(-1);   // -1 = stretch under panels
    ls->setKeyboardInteractivity(LayerShellQt::Window::KeyboardInteractivityNone);
    ls->setScope(QStringLiteral("wayland-utauri-monitor-%1").arg(monitorIndex_));
}

void walqt::WallpaperWindow::installBridgeAndUserScripts() {
    bridge_ = new WallpaperBridge(monitorIndex_, this);
    channel_ = new QWebChannel(view_->page());
    channel_->registerObject(QStringLiteral("walBridge"), bridge_);
    view_->page()->setWebChannel(channel_);
    connect(bridge_, &WallpaperBridge::transitionAck,
            this, &WallpaperWindow::onTransitionAck);

    // Inject qwebchannel.js + bootstrap (spec §8.2).
    QFile qwc(QStringLiteral(":/qtwebchannel/qwebchannel.js"));
    QString qwcSrc;
    if (qwc.open(QIODevice::ReadOnly))
        qwcSrc = QString::fromUtf8(qwc.readAll());
    else
        qWarning("WallpaperWindow: failed to read :/qtwebchannel/qwebchannel.js");

    QString initSrc = QStringLiteral(R"js(
        new QWebChannel(qt.webChannelTransport, function(channel) {
            window._walBridge = channel.objects.walBridge;
            window._walBridgeReady = true;
            document.dispatchEvent(new Event('walBridgeReady'));
        });
    )js");

    QWebEngineScript script;
    script.setName(QStringLiteral("walBridgeInit"));
    script.setSourceCode(qwcSrc + "\n" + initSrc);
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(QWebEngineScript::MainWorld);
    script.setRunsOnSubFrames(false);
    view_->page()->scripts().insert(script);

    // CSP injection (spec §22.6).
    view_->page()->scripts().insert(
        walqt::buildCspInjectionScript(walqt::defaultCspPolicy()));
}

void walqt::WallpaperWindow::loadRendererShell() {
    // Task 21 wires the renderer dist as a Qt resource. For now this URL
    // resolves only after Task 21 lands; if the resource is missing, Chromium
    // shows a blank page — that's expected at this stage.
    view_->load(QUrl(QStringLiteral("qrc:/renderer/index.html")));
}

QString walqt::WallpaperWindow::screenName() const { return screenName_; }

void walqt::WallpaperWindow::setGlobalNetworkEnabled(bool enabled) {
    globalNetworkEnabled_ = enabled;
    applyEffectiveNetworkPolicy();
}

void walqt::WallpaperWindow::applyEffectiveNetworkPolicy() {
    // Effective network = global setting AND the current package's manifest declared network.
    if (interceptor_)
        interceptor_->setNetworkEnabled(globalNetworkEnabled_ && currentManifestNetwork_);
}

void walqt::WallpaperWindow::loadContent(const QJsonObject &req,
                                         std::function<void(bool, QString)> done)
{
    // Cancel any in-flight ack (the new request supersedes it).
    if (pendingDone_) {
        auto stale = std::move(pendingDone_);
        stale(false, QStringLiteral("superseded"));
    }

    QString kind = req.value("kind").toString();
    if (kind == "web") {
        loadWebPackage(req, std::move(done));
    } else if (kind == "image" || kind == "video") {
        pendingDone_ = std::move(done);
        loadImageOrVideo(req);
    } else {
        if (done) done(false, QStringLiteral("unknown kind: ") + kind);
    }
}

void walqt::WallpaperWindow::loadWebPackage(const QJsonObject &req,
                                            std::function<void(bool, QString)> done)
{
    QString target = req.value("target").toString();
    auto resolved = walqt::resolveWebTarget(target);
    if (resolved.packageRoot.isEmpty()) {
        if (done) done(false, QStringLiteral("unresolved target: ") + target);
        return;
    }
    if (schemeHandler_) schemeHandler_->setPackageRoot(resolved.packageRoot);

    currentTarget_ = target;
    currentKind_   = QStringLiteral("web");
    currentManifestNetwork_ = resolved.manifest.network;
    applyEffectiveNetworkPolicy();

    QUrl url(QStringLiteral("waypaperhtml://pkg/") + resolved.manifest.entry);
    view_->load(url);

    // Web kind: ack immediately (no JS transition handshake for navigation).
    if (done) done(true, {});
}

void walqt::WallpaperWindow::loadImageOrVideo(const QJsonObject &req) {
    // Stash pending target/kind before emitting so onTransitionAck can commit them.
    pendingTarget_ = req.value("target").toString();
    pendingKind_   = req.value("kind").toString();

    QString json = QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact));
    emit bridge_->loadWallpaper(json);
}

void walqt::WallpaperWindow::onTransitionAck(int /*monitorId*/, bool ok, const QString &err) {
    if (ok) {
        currentTarget_ = pendingTarget_;
        currentKind_   = pendingKind_;
    }
    pendingTarget_.clear();
    pendingKind_.clear();

    if (pendingDone_) {
        auto cb = std::move(pendingDone_);
        cb(ok, err);
    }
}

void walqt::WallpaperWindow::setParallax(const QJsonObject &req) {
    emit bridge_->setParallax(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
}
void walqt::WallpaperWindow::setParallaxMove(const QJsonObject &req) {
    emit bridge_->setParallaxMove(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
}
void walqt::WallpaperWindow::setPlaybackPolicy(const QJsonObject &req) {
    emit bridge_->setPlaybackPolicy(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
}
void walqt::WallpaperWindow::pushWallpaperConfig(const QJsonObject &req) {
    emit bridge_->pushWallpaperConfig(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
}
void walqt::WallpaperWindow::pushCapabilities(const QJsonObject &req) {
    emit bridge_->pushCapabilities(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
}

void walqt::WallpaperWindow::setPointerInteractive(bool interactive) {
    if (interactive) {
        clearMask();
        if (view_) view_->setAttribute(Qt::WA_TransparentForMouseEvents, false);
    } else {
        // Empty region = pass all pointer events to surfaces below (spec §11).
        setMask(QRegion());
        if (view_) view_->setAttribute(Qt::WA_TransparentForMouseEvents, true);
    }
}
