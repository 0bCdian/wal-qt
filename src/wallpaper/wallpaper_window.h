#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QString>
#include <QVector>

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
    bool audioReactive() const { return audioReactive_; }
    QString currentTarget() const { return currentTarget_; }
    QString currentKind()   const { return currentKind_; }

    void setGlobalNetworkEnabled(bool enabled);

    // Fire-and-forget. Dispatches the request to the renderer (or navigates to a web package);
    // supersede is handled inside the renderer via a generation counter.
    void loadContent(const QJsonObject &req);

    void setParallax(const QJsonObject &req);
    void setParallaxMove(const QJsonObject &req);
    void setPlaybackPolicy(const QJsonObject &req);
    void pushWallpaperConfig(const QJsonObject &req);
    void pushCapabilities(const QJsonObject &req);
    void dispatchAudio(const QVector<float> &bands, float rms, float peak);
    void applyImagePresentation(const QString &imageFitMode, const QString &imageRendering,
                                const QString &fillColor);

    WallpaperBridge *bridge() const { return bridge_; }

    // Stretch (Task 24): pointer-interactive toggle. Default off in v1.
    void setPointerInteractive(bool interactive);

signals:
    void audioReactiveChanged(int monitorIndex, bool active);

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
    bool currentManifestNetwork_ = false;
    bool globalNetworkEnabled_ = false;
    bool keyboard_ = false;
    bool audioReactive_ = false;

    struct ParallaxState {
        bool enabled = false;
        float zoom = 1.2f;
        float stepPercent = 5.0f;
        int animationMs = 600;
        float easing[4] = {0.215f, 0.610f, 0.355f, 1.0f};
        int resetMs = 400;
        float offsetX = 0.0f;
        float offsetY = 0.0f;
    };
    ParallaxState parallaxState_;

    // Set when an image/video load arrives while the view is on a web package URL.
    // Emitted to the bridge once the qrc renderer has reconnected (rendererConnected).
    QString pendingShellLoadJson_;

    void setupLayerShell(QScreen *screen);
    void installBridgeAndUserScripts();
    void loadRendererShell();   // navigates to qrc:/renderer/index.html (Task 21 wires the resource)
    void loadWebPackage(const QJsonObject &req);
    void loadImageOrVideo(const QJsonObject &req);
    void applyEffectiveNetworkPolicy();
    void setKeyboardInteractivity(bool interactive);
    void runJsDispatch(const QString &eventType, const QJsonObject &payload);
    void dispatchParallaxState(bool wrappedX, bool wrappedY);
};
}
