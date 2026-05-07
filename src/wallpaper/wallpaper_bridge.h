#pragma once
#include <QObject>
#include <QString>
namespace walqt {
class WallpaperBridge : public QObject {
    Q_OBJECT
public:
    explicit WallpaperBridge(int monitorId, QObject *parent = nullptr);
    int monitorId() const { return monitorId_; }

public slots:
    Q_INVOKABLE void transitionResult(const QString &json);
    Q_INVOKABLE void log(const QString &level, const QString &message);

signals:
    // Emitted by C++ → received by JS via channel.objects.walBridge.<name>.connect(fn)
    void loadWallpaper(const QString &json);
    void setParallax(const QString &json);
    void setParallaxMove(const QString &json);
    void setPlaybackPolicy(const QString &json);
    void pushWallpaperConfig(const QString &json);
    void pushCapabilities(const QString &json);

    // C++-only: emitted from transitionResult() so the controller can ack the HTTP responder.
    void transitionAck(int monitorId, bool ok, const QString &err);

private:
    int monitorId_;
};
}
