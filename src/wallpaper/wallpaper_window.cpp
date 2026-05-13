#include "wallpaper/wallpaper_window.h"
#include "wallpaper/wallpaper_bridge.h"
#include "wallpaper/load_request_merge.h"
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
#include <QJsonArray>
#include <QJsonDocument>
#include <QUrl>
#include <QUrlQuery>
#include <QRegion>

#include <LayerShellQt/Window>

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
    setWindowFlags(Qt::Window);

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);

    view_ = new QWebEngineView(this);
    view_->page()->setBackgroundColor(Qt::black);
    layout->addWidget(view_);

    installBridgeAndUserScripts();
    loadRendererShell();

    setupLayerShell(screen);

    // Default click-through (spec §11) — pointer events pass through to surfaces below.
    setPointerInteractive(false);

    if (screen)
        setGeometry(screen->geometry());

    show();
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
    ls->setScope(QStringLiteral("wal-qt-monitor-%1").arg(monitorIndex_));
}

void walqt::WallpaperWindow::installBridgeAndUserScripts() {
    bridge_ = new WallpaperBridge(monitorIndex_, this);
    channel_ = new QWebChannel(view_->page());
    channel_->registerObject(QStringLiteral("walBridge"), bridge_);
    view_->page()->setWebChannel(channel_);
    connect(bridge_, &WallpaperBridge::transitionAck,
            this, &WallpaperWindow::onTransitionAck);
    // When the qrc renderer has reconnected, flush any image/video load that arrived
    // while we were navigated away to a web package.
    connect(bridge_, &WallpaperBridge::rendererConnected,
            this, [this](int) {
                if (!pendingShellLoadJson_.isEmpty()) {
                    QString json = pendingShellLoadJson_;
                    pendingShellLoadJson_.clear();
                    emit bridge_->loadWallpaper(json);
                }
            });

    // Interaction guards: block context menu, text select, native drag on ALL pages
    // (both qrc renderer and web wallpaper packages).
    // NOTE: document.head and document.documentElement are null at DocumentCreation —
    // window event listeners can be wired immediately but style injection must wait for
    // DOMContentLoaded.
    static const char GUARD_JS[] = R"js(
(function(){
    var sup=function(e){e.preventDefault();};
    window.addEventListener('contextmenu',sup,{capture:true});
    window.addEventListener('auxclick',sup,{capture:true});
    window.addEventListener('dragstart',sup,{capture:true});
    window.addEventListener('selectstart',sup,{capture:true});
    var css='*,*::before,*::after{user-select:none!important;cursor:default!important;-webkit-user-select:none!important;}';
    document.addEventListener('DOMContentLoaded',function(){
        if(document.getElementById('__waypaper-guard'))return;
        var root=document.head||document.documentElement;
        if(!root)return;
        var s=document.createElement('style');s.id='__waypaper-guard';s.textContent=css;
        root.insertBefore(s,root.firstChild||null);
    },{capture:true,once:true});
})();
)js";
    QWebEngineScript guardScript;
    guardScript.setName(QStringLiteral("walInteractionGuard"));
    guardScript.setSourceCode(QString::fromLatin1(GUARD_JS));
    guardScript.setInjectionPoint(QWebEngineScript::DocumentCreation);
    guardScript.setWorldId(QWebEngineScript::MainWorld);
    guardScript.setRunsOnSubFrames(true);
    view_->page()->scripts().insert(guardScript);

    // Inject qwebchannel.js + bootstrap (spec §8.2).
    QFile qwc(QStringLiteral(":/qtwebchannel/qwebchannel.js"));
    QString qwcSrc;
    if (qwc.open(QIODevice::ReadOnly))
        qwcSrc = QString::fromUtf8(qwc.readAll());
    else
        qWarning("WallpaperWindow: failed to read :/qtwebchannel/qwebchannel.js");

QString initSrc = QStringLiteral(R"js(
        window.__walqtUseWalfileScheme = true;

        // Wallpaper Engine API stubs. WE wallpapers call these unconditionally at startup;
        // without no-op stubs the script crashes with "X is not a function" before any
        // capability negotiation.
        if (typeof window.wallpaperRegisterAudioListener !== 'function')
            window.wallpaperRegisterAudioListener = function(cb) { window.__wpAudioUserCb = (typeof cb === 'function' ? cb : null); };
        if (typeof window.wallpaperRegisterMediaPropertiesListener !== 'function')
            window.wallpaperRegisterMediaPropertiesListener = function() {};
        if (typeof window.wallpaperRegisterMediaPlaybackListener !== 'function')
            window.wallpaperRegisterMediaPlaybackListener = function() {};
        if (typeof window.wallpaperRegisterMediaTimelineListener !== 'function')
            window.wallpaperRegisterMediaTimelineListener = function() {};
        if (typeof window.wallpaperRequestRandomFileForProperty !== 'function')
            window.wallpaperRequestRandomFileForProperty = function() {};
        if (typeof window.wallpaperPropertyListener !== 'object' || window.wallpaperPropertyListener === null)
            window.wallpaperPropertyListener = {};

        // Audio dispatch helper: called by C++ bridge to push audio bands to the page.
        // Converts float[0..1] bands → Uint8Array and calls registered WE listener + postMessage.
        window.__wpAudioDispatchWE = function(bands, rms, peak) {
            var u8 = new Uint8Array(bands.length);
            for (var i = 0; i < bands.length; i++) u8[i] = Math.round(bands[i] * 255);
            var cb = window.__wpAudioUserCb;
            if (cb) { try { cb(u8); } catch(e) {} }
            try {
                window.postMessage({type:'waypaper:audio-reactive', bands:bands, peak:peak, rms:rms}, '*');
            } catch(e) {}
        };

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

    // Bootstrap waypaper config from ?__waypaper_cfg=<base64-json> URL query param.
    // Sets window.__WAYPAPER_CONFIG and dispatches 'waypaper:config' at DOMContentLoaded.
    static const char WAYPAPER_CFG_BOOTSTRAP_JS[] = R"js(
(function(){
  try {
    var q = (typeof location !== 'undefined' && location.search) ? location.search.replace(/^\?/, '') : '';
    var params = new URLSearchParams(q);
    var enc = params.get('__waypaper_cfg');
    if (enc) {
      var json = atob(enc);
      window.__WAYPAPER_CONFIG = JSON.parse(json);
    } else {
      window.__WAYPAPER_CONFIG = window.__WAYPAPER_CONFIG || {};
    }
    function dispatchCfg() {
      try {
        window.dispatchEvent(new CustomEvent('waypaper:config', { detail: window.__WAYPAPER_CONFIG || {} }));
      } catch(_e) {}
    }
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', dispatchCfg, { once: true });
    } else {
      dispatchCfg();
    }
  } catch(_e) {
    try { window.__WAYPAPER_CONFIG = window.__WAYPAPER_CONFIG || {}; } catch(_e2) {}
  }
})();
)js";
    QWebEngineScript cfgBootstrapScript;
    cfgBootstrapScript.setName(QStringLiteral("waypaperConfigBootstrap"));
    cfgBootstrapScript.setSourceCode(QString::fromLatin1(WAYPAPER_CFG_BOOTSTRAP_JS));
    cfgBootstrapScript.setInjectionPoint(QWebEngineScript::DocumentCreation);
    cfgBootstrapScript.setWorldId(QWebEngineScript::MainWorld);
    cfgBootstrapScript.setRunsOnSubFrames(false);
    view_->page()->scripts().insert(cfgBootstrapScript);

    // CSP injection (spec §22.6).
    view_->page()->scripts().insert(
        walqt::buildCspInjectionScript(walqt::defaultCspPolicy()));
}

void walqt::WallpaperWindow::loadRendererShell() {
    // Task 21 wires the renderer dist as a Qt resource. If the resource is
    // missing, Chromium shows a blank page — that's expected without a dist.
    // Pass monitor_id as a query param so resolveMonitorId() in the renderer
    // picks the right monitor index without needing Tauri context.
    QUrl url(QStringLiteral("qrc:/renderer/index.html"));
    QUrlQuery q;
    q.addQueryItem(QStringLiteral("monitor"), QString::number(monitorIndex_));
    url.setQuery(q);
    view_->load(url);
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
    const QJsonObject reqResolved = mergeLoadRequestTargetForScreen(req, screenName_);

    // Cancel any in-flight ack (the new request supersedes it).
    if (pendingDone_) {
        auto stale = std::move(pendingDone_);
        stale(false, QStringLiteral("superseded"));
    }

    QString kind = reqResolved.value("kind").toString();
    if (kind == "web") {
        loadWebPackage(reqResolved, std::move(done));
    } else if (kind == "image" || kind == "video") {
        pendingDone_ = std::move(done);
        loadImageOrVideo(reqResolved);
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

    // Apply manifest pointer_interactive. Image/video kinds always stay click-through;
    // only web packages opt in. Runtime overrides arrive via pushCapabilities().
    setPointerInteractive(resolved.manifest.pointerInteractive);
    setKeyboardInteractivity(resolved.manifest.keyboard);

    const bool newAudioReactive = resolved.manifest.audioReactive;
    if (audioReactive_ != newAudioReactive) {
        audioReactive_ = newAudioReactive;
        emit audioReactiveChanged(monitorIndex_, audioReactive_);
    }

    QUrl url(QStringLiteral("waypaperhtml://pkg/") + resolved.manifest.entry);
    const QJsonValue cfgVal = req.value(QStringLiteral("wallpaper_config_values"));
    if (cfgVal.isObject() && !cfgVal.toObject().isEmpty()) {
        const QByteArray cfgJson = QJsonDocument(cfgVal.toObject()).toJson(QJsonDocument::Compact);
        const QByteArray cfgB64 = cfgJson.toBase64(QByteArray::Base64Encoding);
        QUrlQuery q;
        q.addQueryItem(QStringLiteral("__waypaper_cfg"), QString::fromLatin1(cfgB64));
        url.setQuery(q);
    }
    view_->load(url);

    // Web kind: ack immediately (no JS transition handshake for navigation).
    if (done) done(true, {});
}

void walqt::WallpaperWindow::loadImageOrVideo(const QJsonObject &req) {
    // Image/video wallpapers are not audio-reactive and do not use keyboard.
    if (audioReactive_) {
        audioReactive_ = false;
        emit audioReactiveChanged(monitorIndex_, false);
    }
    if (keyboard_) setKeyboardInteractivity(false);

    // Stash pending target/kind before emitting so onTransitionAck can commit them.
    pendingTarget_ = req.value("target").toString();
    pendingKind_   = req.value("kind").toString();

    // Inject required renderer fields: monitor_id and a monotonic request_id.
    // The renderer's executeLoadRequest filters on monitor_id and routes accordingly.
    static int sRequestId = 0;
    QJsonObject enriched = req;
    enriched["monitor_id"]  = monitorIndex_;
    enriched["request_id"]  = ++sRequestId;
    // Ensure required numeric fields have defaults so the renderer type is satisfied.
    if (!enriched.contains("duration_ms"))
        enriched["duration_ms"] = 300;
    if (!enriched.contains("audio_enabled"))
        enriched["audio_enabled"] = false;

    QString json = QString::fromUtf8(QJsonDocument(enriched).toJson(QJsonDocument::Compact));

    if (currentKind_ == QStringLiteral("web")) {
        // The view is on a waypaperhtml:// page — the qrc renderer's bridge listeners
        // are gone. Stash the request, navigate back to the renderer shell, and let the
        // rendererConnected signal flush it once JS has reconnected to the bridge.
        pendingShellLoadJson_ = json;
        // Pointer events are not used during image/video transitions; reset to default.
        setPointerInteractive(false);
        currentKind_.clear();
        loadRendererShell();
        return;
    }

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
    parallaxState_.enabled = req.value(QStringLiteral("enabled")).toBool(false);
    parallaxState_.zoom = (float)req.value(QStringLiteral("zoom")).toDouble(1.2);
    parallaxState_.stepPercent = (float)req.value(QStringLiteral("step_percent")).toDouble(5.0);
    parallaxState_.animationMs = req.value(QStringLiteral("animation_ms")).toInt(600);
    parallaxState_.resetMs = req.value(QStringLiteral("reset_ms")).toInt(400);
    const QJsonArray ea = req.value(QStringLiteral("easing")).toArray();
    if (ea.size() == 4) {
        for (int i = 0; i < 4; ++i)
            parallaxState_.easing[i] = (float)ea[i].toDouble();
    }
    parallaxState_.offsetX = 0.0f;
    parallaxState_.offsetY = 0.0f;
    dispatchParallaxState(false, false);
}

void walqt::WallpaperWindow::setParallaxMove(const QJsonObject &req) {
    if (!parallaxState_.enabled)
        return;
    const QString dir = req.value(QStringLiteral("direction")).toString();
    const float delta = parallaxState_.stepPercent / 100.0f;
    float nx = parallaxState_.offsetX;
    float ny = parallaxState_.offsetY;
    if (dir == QStringLiteral("left"))       nx -= delta;
    else if (dir == QStringLiteral("right")) nx += delta;
    else if (dir == QStringLiteral("up"))    ny -= delta;
    else if (dir == QStringLiteral("down"))  ny += delta;
    bool wx = false, wy = false;
    constexpr float limit = 0.5f;
    if (nx >  limit) { nx = -limit; wx = true; }
    else if (nx < -limit) { nx =  limit; wx = true; }
    if (ny >  limit) { ny = -limit; wy = true; }
    else if (ny < -limit) { ny =  limit; wy = true; }
    parallaxState_.offsetX = nx;
    parallaxState_.offsetY = ny;
    dispatchParallaxState(wx, wy);
}

void walqt::WallpaperWindow::dispatchParallaxState(bool wrappedX, bool wrappedY) {
    QJsonObject payload;
    payload[QStringLiteral("monitor_id")] = monitorIndex_;
    payload[QStringLiteral("enabled")] = parallaxState_.enabled;
    payload[QStringLiteral("zoom")] = (double)parallaxState_.zoom;
    payload[QStringLiteral("offset_x")] = (double)parallaxState_.offsetX;
    payload[QStringLiteral("offset_y")] = (double)parallaxState_.offsetY;
    payload[QStringLiteral("animation_ms")] = parallaxState_.animationMs;
    payload[QStringLiteral("reset_ms")] = parallaxState_.resetMs;
    QJsonArray ea;
    for (int i = 0; i < 4; ++i)
        ea.append((double)parallaxState_.easing[i]);
    payload[QStringLiteral("easing")] = ea;
    payload[QStringLiteral("wrapped_x")] = wrappedX;
    payload[QStringLiteral("wrapped_y")] = wrappedY;

    if (currentKind_ == QStringLiteral("web")) {
        runJsDispatch(QStringLiteral("wallpaper:parallax"), payload);
    } else {
        emit bridge_->setParallax(QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact)));
    }
}
void walqt::WallpaperWindow::setPlaybackPolicy(const QJsonObject &req) {
    emit bridge_->setPlaybackPolicy(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
}
void walqt::WallpaperWindow::pushWallpaperConfig(const QJsonObject &req) {
    if (currentKind_ == QStringLiteral("web")) {
        // Dispatch 'waypaper:config' CustomEvent and set window.__WAYPAPER_CONFIG.
        // Mirrors wallpaper_config_eval_script in wal-utauri.
        const QJsonValue valuesVal = req.value(QStringLiteral("values"));
        const QJsonObject values = valuesVal.isObject() ? valuesVal.toObject() : QJsonObject{};
        const QString inner = QString::fromUtf8(
            QJsonDocument(values).toJson(QJsonDocument::Compact));
        // JSON-encode inner as a string literal so JSON.parse() receives a valid string argument.
        QJsonArray wrapper;
        wrapper.append(inner);
        const QByteArray wrapperBytes = QJsonDocument(wrapper).toJson(QJsonDocument::Compact);
        // wrapperBytes = ["..."] — extract just the string literal (strip outer [ and ]).
        const QString escaped = QString::fromUtf8(wrapperBytes.mid(1, wrapperBytes.size() - 2));
        const QString js = QStringLiteral(
            "try{var d=JSON.parse(%1);"
            "window.__WAYPAPER_CONFIG=d;"
            "window.dispatchEvent(new CustomEvent('waypaper:config',{detail:d}));"
            "}catch(_e){}"
        ).arg(escaped);
        view_->page()->runJavaScript(js);
    } else {
        emit bridge_->pushWallpaperConfig(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
    }
}
void walqt::WallpaperWindow::pushCapabilities(const QJsonObject &req) {
    // Runtime pointer-interactive and keyboard overrides (per-wallpaper toggle in the engine UI).
    const QJsonObject caps = req.value(QStringLiteral("capabilities")).toObject();
    if (caps.contains(QStringLiteral("pointer_interactive")))
        setPointerInteractive(caps.value(QStringLiteral("pointer_interactive")).toBool(false));
    if (caps.contains(QStringLiteral("keyboard")))
        setKeyboardInteractivity(caps.value(QStringLiteral("keyboard")).toBool(false));
    if (caps.contains(QStringLiteral("audio_reactive"))) {
        const bool ar = caps.value(QStringLiteral("audio_reactive")).toBool(false);
        if (audioReactive_ != ar) {
            audioReactive_ = ar;
            emit audioReactiveChanged(monitorIndex_, ar);
        }
    }

    emit bridge_->pushCapabilities(QString::fromUtf8(QJsonDocument(req).toJson(QJsonDocument::Compact)));
}

void walqt::WallpaperWindow::applyImagePresentation(const QString &imageFitMode,
                                                    const QString &imageRendering)
{
    QJsonObject o;
    o[QStringLiteral("monitor_id")] = monitorIndex_;
    o[QStringLiteral("image_fit_mode")] = imageFitMode;
    o[QStringLiteral("image_rendering")] = imageRendering;
    emit bridge_->imagePresentation(
        QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact)));
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

void walqt::WallpaperWindow::setKeyboardInteractivity(bool interactive) {
    keyboard_ = interactive;
    QWindow *win = windowHandle();
    if (!win) return;
    auto *ls = LayerShellQt::Window::get(win);
    if (!ls) return;
    ls->setKeyboardInteractivity(interactive
        ? LayerShellQt::Window::KeyboardInteractivityOnDemand
        : LayerShellQt::Window::KeyboardInteractivityNone);
}

void walqt::WallpaperWindow::runJsDispatch(const QString &eventType, const QJsonObject &payload) {
    QString json = QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact));
    QString js = QStringLiteral(
        "(function(){try{var d=%1;"
        "window.dispatchEvent(new CustomEvent('%2',{detail:d}));"
        "}catch(e){try{if(window._walBridge)window._walBridge.log('error','jsDispatch %2: '+String(e));}catch(_){}}})();"
    ).arg(json, eventType);
    view_->page()->runJavaScript(js);
}

void walqt::WallpaperWindow::dispatchAudio(const QVector<float> &bands, float rms, float peak) {
    if (!audioReactive_ || currentKind_.isEmpty()) return;
    QJsonArray arr;
    for (float v : bands) arr.append(static_cast<double>(v));
    QJsonObject obj;
    obj[QStringLiteral("bands")] = arr;
    obj[QStringLiteral("rms")]   = static_cast<double>(rms);
    obj[QStringLiteral("peak")]  = static_cast<double>(peak);
    QString json = QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
    QString js = QStringLiteral(
        "(function(){try{var d=%1;"
        "if(typeof window.__wpAudioDispatchWE==='function')"
        "window.__wpAudioDispatchWE(d.bands,d.rms,d.peak);"
        "}catch(e){}})();"
    ).arg(json);
    view_->page()->runJavaScript(js);
}
