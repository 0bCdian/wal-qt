#include "wallpaper/wallpaper_controller.h"
#include "wallpaper/monitor_selector.h"
#include "wallpaper/wallpaper_window.h"
#include "audio/audio_capture.h"
#include "web/scheme_handler.h"
#include "web/network_interceptor.h"
#include "web/local_file_scheme_handler.h"

#include <QGuiApplication>
#include <QScreen>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>
#include <QRegularExpression>

namespace walqt {

WallpaperController::WallpaperController(WaypaperHtmlSchemeHandler *sh,
                                         NetworkInterceptor *ni,
                                         QObject *parent)
    : QObject(parent)
    , schemeHandler_(sh)
    , interceptor_(ni)
{
    connect(qApp, &QGuiApplication::screenAdded,
            this, &WallpaperController::onScreenAdded);
    connect(qApp, &QGuiApplication::screenRemoved,
            this, &WallpaperController::onScreenRemoved);
}

WallpaperController::~WallpaperController()
{
    if (audioCap_) {
        audioCap_->stop();
        delete audioCap_;
        audioCap_ = nullptr;
    }
    if (localFileHandler_) {
        if (QWebEngineProfile *p = QWebEngineProfile::defaultProfile())
            p->removeUrlSchemeHandler(localFileHandler_);
        delete localFileHandler_;
        localFileHandler_ = nullptr;
    }
}

void WallpaperController::init()
{
    QWebEngineProfile *profile = QWebEngineProfile::defaultProfile();
    QWebEngineSettings *ws = profile->settings();
    // Renderer shell is qrc:/…; gallery paths are file:///… from the daemon. Chromium blocks
    // file URLs from non-file top-level origins unless this is enabled (images + fetch/WebGL paths).
    ws->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, true);
    profile->setUrlRequestInterceptor(interceptor_);
    profile->installUrlSchemeHandler(QByteArrayLiteral("waypaperhtml"), schemeHandler_);

    if (!localFileHandler_) {
        localFileHandler_ = new LocalFileSchemeHandler(nullptr);
        profile->installUrlSchemeHandler(QByteArrayLiteral("walfile"), localFileHandler_);
    }

    for (QScreen *s : QGuiApplication::screens())
        onScreenAdded(s);
}

void WallpaperController::onScreenAdded(QScreen *s)
{
    const QString name = s->name();
    if (windows_.contains(name))
        return;

    auto *w = new WallpaperWindow(s, nextMonitorIndex_++,
                                  schemeHandler_, interceptor_);
    w->setGlobalNetworkEnabled(networkEnabled_);
    connect(w, &WallpaperWindow::audioReactiveChanged,
            this, [this](int, bool) { updateAudioCapture(); });
    windows_[name] = w;
}

void WallpaperController::onScreenRemoved(QScreen *s)
{
    const QString name = s->name();
    if (auto *w = windows_.take(name))
        w->deleteLater();
}

// ---------------------------------------------------------------------------
// handleRequest — entry point wired to HttpServer::requestReceived
// ---------------------------------------------------------------------------
void WallpaperController::handleRequest(walqt::HttpRequest req,
                                        walqt::HttpResponder respond)
{
    QJsonObject body;
    if (!req.body.isEmpty()) {
        auto doc = QJsonDocument::fromJson(req.body);
        if (!doc.isNull() && doc.isObject()) {
            body = doc.object();
        } else {
            respond(400, R"({"error":"bad json"})");
            return;
        }
    }
    route(req.method, req.path, body, respond);
}

// ---------------------------------------------------------------------------
// route — dispatch table
// ---------------------------------------------------------------------------
void WallpaperController::route(const QString &method, const QString &path,
                                const QJsonObject &body, HttpResponder respond)
{
    if (method == "GET"  && path == "/health") {
        // waypaper-engine daemon/internal/backend/walqt/client.go checkHealth
        QJsonObject h;
        h["ok"] = true;
        h["service"] = QStringLiteral("wal-qt");
        h["api_version"] = QStringLiteral("0");
        respond(200, QJsonDocument(h).toJson(QJsonDocument::Compact));
        return;
    }
    if (method == "GET"  && path == "/wallpaper/status") { respond(200, QJsonDocument(statusJson()).toJson(QJsonDocument::Compact)); return; }
    if (method == "POST" && path == "/wallpaper/load")          { handleLoad(body, respond);         return; }
    if (method == "POST" && path == "/wallpaper/parallax")      { handleParallax(body, respond);     return; }
    if (method == "POST" && path == "/wallpaper/parallax-move") { handleParallaxMove(body, respond); return; }
    if (method == "POST" && path == "/settings/network")        { handleNetwork(body, respond);      return; }
    if (method == "POST" && path == "/settings/image-presentation") { handleImagePresentation(body, respond); return; }
    if (method == "POST" && path == "/wallpaper/config")         { handleConfig(body, respond);       return; }
    if (method == "POST" && path == "/wallpaper/wallpaper-config") { handleConfig(body, respond);     return; }
    if (method == "POST" && path == "/wallpaper/capabilities")   { handleCaps(body, respond);         return; }
    if (method == "POST" && path == "/wallpaper/web-capabilities") { handleCaps(body, respond);       return; }
    if (method == "POST" && path == "/wallpaper/playback")      { handlePlayback(body, respond);     return; }
    respond(404, R"({"error":"not found"})");
}

// ---------------------------------------------------------------------------
// handleLoad — spec §16
// ---------------------------------------------------------------------------
void WallpaperController::handleLoad(const QJsonObject &req, HttpResponder respond)
{
    auto targets = resolve(decodeLoadSelector(req), windows_);
    if (targets.isEmpty()) {
        respond(404, R"({"error":"no matching monitors"})");
        return;
    }

    // Fire-and-forget. The renderer handles supersede via a generation counter, so the
    // daemon always gets an immediate accepted-ack — no completion handshake to mis-correlate
    // when a new request arrives mid-transition. (`wait_for_completion` is accepted for
    // backwards compatibility with the OpenAPI but is now a no-op.)
    respond(202, R"({"ok":true,"accepted":true})");
    for (auto *w : targets)
        w->loadContent(req);
}

// ---------------------------------------------------------------------------
// handleParallax
// ---------------------------------------------------------------------------
void WallpaperController::handleParallax(const QJsonObject &req, HttpResponder respond)
{
    for (auto *w : resolve(decodeParallaxSelector(req), windows_))
        w->setParallax(req);
    respond(200, R"({"ok":true})");
}

// ---------------------------------------------------------------------------
// handleParallaxMove
// ---------------------------------------------------------------------------
void WallpaperController::handleParallaxMove(const QJsonObject &req, HttpResponder respond)
{
    for (auto *w : resolve(decodeParallaxSelector(req), windows_))
        w->setParallaxMove(req);
    respond(200, R"({"ok":true})");
}

// ---------------------------------------------------------------------------
// handleNetwork — spec §22.4
// ---------------------------------------------------------------------------
void WallpaperController::handleNetwork(const QJsonObject &req, HttpResponder respond)
{
    const bool allow = req.contains(QStringLiteral("allow_network_wallpapers"))
                           ? req.value(QStringLiteral("allow_network_wallpapers")).toBool()
                           : req.value(QStringLiteral("enabled")).toBool();
    networkEnabled_ = allow;
    for (auto *w : windows_)
        w->setGlobalNetworkEnabled(networkEnabled_);
    respond(200, R"({"ok":true})");
}

void WallpaperController::handleImagePresentation(const QJsonObject &req, HttpResponder respond)
{
    QString fit = req.value(QStringLiteral("image_fit_mode")).toString();
    if (fit.isEmpty())
        fit = QStringLiteral("cover");
    QString rend = req.value(QStringLiteral("image_rendering")).toString();
    if (rend.isEmpty())
        rend = QStringLiteral("auto");
    QString fillColor = req.value(QStringLiteral("fill_color")).toString().trimmed();
    if (fillColor.startsWith(QLatin1Char('#')))
        fillColor = fillColor.mid(1);
    static const QRegularExpression hexRe(QStringLiteral("^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"));
    if (!hexRe.match(fillColor).hasMatch())
        fillColor = QStringLiteral("000000ff");
    for (auto *w : windows_.values())
        w->applyImagePresentation(fit, rend, fillColor);
    respond(200, R"({"ok":true})");
}

// ---------------------------------------------------------------------------
// handleConfig
// ---------------------------------------------------------------------------
void WallpaperController::handleConfig(const QJsonObject &req, HttpResponder respond)
{
    auto matches = resolve(decodeBySourceSelector(req), windows_);
    for (auto *w : matches)
        w->pushWallpaperConfig(req);
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", static_cast<int>(matches.size())},
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

// ---------------------------------------------------------------------------
// handleCaps
// ---------------------------------------------------------------------------
void WallpaperController::handleCaps(const QJsonObject &req, HttpResponder respond)
{
    auto matches = resolve(decodeBySourceSelector(req), windows_);
    for (auto *w : matches)
        w->pushCapabilities(req);
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", static_cast<int>(matches.size())},
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

// ---------------------------------------------------------------------------
// handlePlayback
// ---------------------------------------------------------------------------
void WallpaperController::handlePlayback(const QJsonObject &req, HttpResponder respond)
{
    auto matches = resolve(decodeBySourceSelector(req), windows_);
    for (auto *w : matches)
        w->setPlaybackPolicy(req);
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", static_cast<int>(matches.size())},
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

// ---------------------------------------------------------------------------
// statusJson — matches wal-utauri control_api::build_status_response + WallpaperStatus
// (waypaper-engine decodes as walqt.statusResponse / wallpaperStatusPayload).
// ---------------------------------------------------------------------------
namespace {
QJsonObject defaultParallaxJson()
{
    return QJsonObject{
        {QStringLiteral("enabled"), false},
        {QStringLiteral("zoom"), 1.2},
        {QStringLiteral("offset_x"), 0},
        {QStringLiteral("offset_y"), 0},
        {QStringLiteral("step_percent"), 5},
        {QStringLiteral("animation_ms"), static_cast<qint64>(600)},
        {QStringLiteral("easing"), QJsonArray{0.215, 0.610, 0.355, 1.000}},
        {QStringLiteral("reset_ms"), static_cast<qint64>(400)},
    };
}
} // namespace

QJsonObject WallpaperController::statusJson() const
{
    QJsonArray topology;
    QJsonArray monitors;
    const QList<QScreen *> screens = QGuiApplication::screens();
    for (QScreen *sc : screens) {
        if (!sc)
            continue;
        const QRect g = sc->geometry();
        topology.append(QJsonObject{
            {QStringLiteral("name"), sc->name()},
            {QStringLiteral("x"), g.x()},
            {QStringLiteral("y"), g.y()},
            {QStringLiteral("width"), g.width()},
            {QStringLiteral("height"), g.height()},
        });

        WallpaperWindow *w = windows_.value(sc->name(), nullptr);
        QJsonObject mon{
            {QStringLiteral("name"), sc->name()},
            {QStringLiteral("visible"), true},
            {QStringLiteral("last_transition"), QStringLiteral("none")},
            {QStringLiteral("in_progress"), false},
            {QStringLiteral("parallax"), defaultParallaxJson()},
        };
        QString kind = QStringLiteral("image");
        QString cur;
        if (w) {
            kind = w->currentKind().isEmpty() ? QStringLiteral("image") : w->currentKind();
            cur = w->currentTarget();
        }
        mon[QStringLiteral("current_kind")] = kind;
        if (!cur.isEmpty())
            mon[QStringLiteral("current_target")] = cur;
        monitors.append(mon);
    }

    const QJsonObject sched{
        {QStringLiteral("mode"), QStringLiteral("latest_wins_bounded_queue")},
        {QStringLiteral("max_queue_size"), 8},
        {QStringLiteral("queued_requests"), 0},
    };
    const QJsonObject inner{
        {QStringLiteral("topology_policy"),
         QStringLiteral("dynamic_surface_reconcile_hotplug_enabled")},
        {QStringLiteral("monitor_count"), static_cast<int>(monitors.size())},
        {QStringLiteral("topology"), topology},
        {QStringLiteral("monitors"), monitors},
        {QStringLiteral("scheduler"), sched},
    };
    return QJsonObject{
        {QStringLiteral("ok"), true},
        {QStringLiteral("api_version"), QStringLiteral("0")},
        {QStringLiteral("status"), inner},
    };
}

// ---------------------------------------------------------------------------
// Audio capture management
// ---------------------------------------------------------------------------
void WallpaperController::updateAudioCapture()
{
    bool anyAudio = false;
    for (auto *w : windows_) {
        if (w->audioReactive()) { anyAudio = true; break; }
    }

    if (anyAudio && !audioCap_) {
        audioCap_ = new AudioCapture(this);
        connect(audioCap_, &AudioCapture::audioFrame,
                this,       &WallpaperController::onAudioFrame);
        audioCap_->start();
    } else if (!anyAudio && audioCap_) {
        audioCap_->stop();
        delete audioCap_;
        audioCap_ = nullptr;
    }
}

void WallpaperController::onAudioFrame(QVector<float> bands, float rms, float peak)
{
    for (auto *w : windows_)
        w->dispatchAudio(bands, rms, peak);
}

} // namespace walqt
