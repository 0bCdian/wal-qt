#pragma once
#include <QObject>
#include <QLocalServer>
#include <QHash>
#include <QPointer>
#include <functional>
#include "http_request.h"

class QLocalSocket;

namespace walqt {
class HttpParser;

using HttpResponder = std::function<void(int status, const QByteArray &jsonBody)>;

class HttpServer : public QObject {
    Q_OBJECT
public:
    explicit HttpServer(QString socketPath, QObject *parent = nullptr);
    ~HttpServer() override;
    bool listen();   // true on success

signals:
    void requestReceived(walqt::HttpRequest req, walqt::HttpResponder responder);

private slots:
    void onNewConnection();
    void onReadyRead();
    void onDisconnected();

private:
    struct Conn {
        HttpParser *parser;
        QByteArray buf;
    };
    QString socketPath_;
    QLocalServer server_;
    QHash<QLocalSocket*, Conn*> conns_;

    void writeResponse(QLocalSocket *s, int status, const QByteArray &body);
};
}

Q_DECLARE_METATYPE(walqt::HttpRequest)
Q_DECLARE_METATYPE(walqt::HttpResponder)
