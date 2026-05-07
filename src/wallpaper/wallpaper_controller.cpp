// audio-reactive capture: deferred, see wal-qt.md §15
#include "wallpaper_controller.h"
#include "wallpaper_window.h"
#include "pending_load.h"
#include "web/scheme_handler.h"
#include "web/network_interceptor.h"

#include <QGuiApplication>
#include <QScreen>
#include <QTimer>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>

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

WallpaperController::~WallpaperController() = default;

void WallpaperController::init()
{
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
    if (method == "GET"  && path == "/health")           { respond(200, R"({"ok":true})");                                          return; }
    if (method == "GET"  && path == "/wallpaper/status") { respond(200, QJsonDocument(statusJson()).toJson(QJsonDocument::Compact)); return; }
    if (method == "POST" && path == "/wallpaper/load")          { handleLoad(body, respond);         return; }
    if (method == "POST" && path == "/wallpaper/parallax")      { handleParallax(body, respond);     return; }
    if (method == "POST" && path == "/wallpaper/parallax-move") { handleParallaxMove(body, respond); return; }
    if (method == "POST" && path == "/settings/network")        { handleNetwork(body, respond);      return; }
    if (method == "POST" && path == "/wallpaper/config")        { handleConfig(body, respond);       return; }
    if (method == "POST" && path == "/wallpaper/capabilities")  { handleCaps(body, respond);         return; }
    if (method == "POST" && path == "/wallpaper/playback")      { handlePlayback(body, respond);     return; }
    respond(404, R"({"error":"not found"})");
}

// ---------------------------------------------------------------------------
// resolveTargets — spec §6
// ---------------------------------------------------------------------------
QList<WallpaperWindow*> WallpaperController::resolveTargets(const QJsonObject &req) const
{
    if (req.contains("targets") && req["targets"].isArray()) {
        QList<WallpaperWindow*> result;
        const QJsonArray arr = req["targets"].toArray();
        for (const QJsonValue &v : arr) {
            const QString name = v.toObject().value("name").toString();
            if (auto *w = windows_.value(name, nullptr))
                result.append(w);
        }
        return result;
    }
    return windows_.values();
}

// ---------------------------------------------------------------------------
// handleLoad — spec §16
// ---------------------------------------------------------------------------
void WallpaperController::handleLoad(const QJsonObject &req, HttpResponder respond)
{
    auto targets = resolveTargets(req);
    if (targets.isEmpty()) {
        respond(404, R"({"error":"no matching monitors"})");
        return;
    }

    bool wait = req.value("wait_for_completion").toBool(false);

    if (!wait) {
        respond(202, R"({"ok":true})");
        for (auto *w : targets)
            w->loadContent(req, nullptr);
        return;
    }

    auto pending = std::make_shared<PendingLoad>(
        targets.size(),
        [respond](int s, const QByteArray &b) { respond(s, b); });

    for (auto *w : targets) {
        w->loadContent(req, [pending](bool ok, QString err) {
            pending->ack(ok, err);
        });
    }

    QTimer::singleShot(30000, this, [pending] { pending->timeout(); });
}

// ---------------------------------------------------------------------------
// handleParallax
// ---------------------------------------------------------------------------
void WallpaperController::handleParallax(const QJsonObject &req, HttpResponder respond)
{
    auto targets = resolveTargets(req);
    for (auto *w : targets)
        w->setParallax(req);
    respond(200, R"({"ok":true})");
}

// ---------------------------------------------------------------------------
// handleParallaxMove
// ---------------------------------------------------------------------------
void WallpaperController::handleParallaxMove(const QJsonObject &req, HttpResponder respond)
{
    auto targets = resolveTargets(req);
    for (auto *w : targets)
        w->setParallaxMove(req);
    respond(200, R"({"ok":true})");
}

// ---------------------------------------------------------------------------
// handleNetwork — spec §22.4
// ---------------------------------------------------------------------------
void WallpaperController::handleNetwork(const QJsonObject &req, HttpResponder respond)
{
    networkEnabled_ = req.value("enabled").toBool(false);
    for (auto *w : windows_)
        w->setGlobalNetworkEnabled(networkEnabled_);
    respond(200, R"({"ok":true})");
}

// ---------------------------------------------------------------------------
// handleConfig
// ---------------------------------------------------------------------------
void WallpaperController::handleConfig(const QJsonObject &req, HttpResponder respond)
{
    const QString sourceTarget = req.value("source_target").toString();
    int applied = 0;
    for (auto *w : windows_) {
        if (w->currentTarget() == sourceTarget) {
            w->pushWallpaperConfig(req);
            ++applied;
        }
    }
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", applied}
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

// ---------------------------------------------------------------------------
// handleCaps
// ---------------------------------------------------------------------------
void WallpaperController::handleCaps(const QJsonObject &req, HttpResponder respond)
{
    // audio-reactive capture: deferred, see wal-qt.md §15
    if (req.value("capabilities").toObject().value("audio_reactive").toBool(false))
        qInfo("audio_reactive requested but capture is not implemented in v0.1");

    const QString sourceTarget = req.value("source_target").toString();
    int applied = 0;
    for (auto *w : windows_) {
        if (w->currentTarget() == sourceTarget) {
            w->pushCapabilities(req);
            ++applied;
        }
    }
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", applied}
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

// ---------------------------------------------------------------------------
// handlePlayback
// ---------------------------------------------------------------------------
void WallpaperController::handlePlayback(const QJsonObject &req, HttpResponder respond)
{
    const QString sourceTarget = req.value("source_target").toString();
    int applied = 0;
    for (auto *w : windows_) {
        if (w->currentTarget() == sourceTarget) {
            w->setPlaybackPolicy(req);
            ++applied;
        }
    }
    const QByteArray body = QJsonDocument(QJsonObject{
        {"ok", true},
        {"applied", applied}
    }).toJson(QJsonDocument::Compact);
    respond(200, body);
}

// ---------------------------------------------------------------------------
// statusJson — spec §17
// ---------------------------------------------------------------------------
QJsonObject WallpaperController::statusJson() const
{
    QJsonArray arr;
    int id = 0;
    for (auto *w : windows_) {
        arr.append(QJsonObject{
            {"id",             id++},
            {"name",           w->screenName()},
            {"current_target", w->currentTarget()},
            {"kind",           w->currentKind()},
            {"visible",        true}
        });
    }
    return QJsonObject{{"monitors", arr}};
}

} // namespace walqt
