#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QString>
#include <functional>

class QWebEngineView;
class QWebChannel;
class QScreen;

namespace walqt {
class WallpaperBridge;
class WaypaperHtmlSchemeHandler;
class NetworkInterceptor;

class WallpaperWindow : public QWidget {
    Q_OBJECT
public:
    WallpaperWindow(QScreen *screen,
                    int monitorIndex,
                    WaypaperHtmlSchemeHandler *schemeHandler,
                    NetworkInterceptor *interceptor,
                    QWidget *parent = nullptr);

    QString screenName() const;
    int monitorIndex() const { return monitorIndex_; }
    QString currentTarget() const { return currentTarget_; }
    QString currentKind()   const { return currentKind_; }

    void setGlobalNetworkEnabled(bool enabled);

    // Returns immediately. For image/video, ack arrives via the bridge.
    void loadContent(const QJsonObject &req,
                     std::function<void(bool ok, QString err)> done);

    void setParallax(const QJsonObject &req);
    void setParallaxMove(const QJsonObject &req);
    void setPlaybackPolicy(const QJsonObject &req);
    void pushWallpaperConfig(const QJsonObject &req);
    void pushCapabilities(const QJsonObject &req);

    WallpaperBridge *bridge() const { return bridge_; }

    // Stretch (Task 24): pointer-interactive toggle. Default off in v1.
    void setPointerInteractive(bool interactive);

private slots:
    void onTransitionAck(int monitorId, bool ok, const QString &err);

private:
    int monitorIndex_;
    QString screenName_;
    QWebEngineView *view_ = nullptr;
    WallpaperBridge *bridge_ = nullptr;
    QWebChannel *channel_ = nullptr;
    WaypaperHtmlSchemeHandler *schemeHandler_;
    NetworkInterceptor *interceptor_;

    QString currentTarget_;
    QString currentKind_;
    QString pendingTarget_;
    QString pendingKind_;
    bool currentManifestNetwork_ = false;
    bool globalNetworkEnabled_ = false;

    std::function<void(bool, QString)> pendingDone_;

    void setupLayerShell(QScreen *screen);
    void installBridgeAndUserScripts();
    void loadRendererShell();   // navigates to qrc:/renderer/index.html (Task 21 wires the resource)
    void loadWebPackage(const QJsonObject &req,
                        std::function<void(bool, QString)> done);
    void loadImageOrVideo(const QJsonObject &req);
    void applyEffectiveNetworkPolicy();
};
}
