#include "http_server.h"
#include "http_parser.h"
#include <QLocalSocket>
#include <QFile>
#include <QPointer>

namespace walqt {

static const char *reasonPhrase(int status)
{
    switch (status) {
    case 200: return "OK";
    case 202: return "Accepted";
    case 400: return "Bad Request";
    case 404: return "Not Found";
    case 500: return "Internal Server Error";
    case 504: return "Gateway Timeout";
    default:  return "";
    }
}

HttpServer::HttpServer(QString socketPath, QObject *parent)
    : QObject(parent)
    , socketPath_(std::move(socketPath))
    , server_(this)
{
    qRegisterMetaType<HttpRequest>();
    qRegisterMetaType<HttpResponder>();

    connect(&server_, &QLocalServer::newConnection, this, &HttpServer::onNewConnection);
}

HttpServer::~HttpServer()
{
    server_.close();
    qDeleteAll(conns_);
    conns_.clear();
    QFile::remove(socketPath_);
}

bool HttpServer::listen()
{
    QFile::remove(socketPath_);
    if (!server_.listen(socketPath_)) {
        return false;
    }
    QFile::setPermissions(socketPath_,
        QFile::ReadOwner | QFile::WriteOwner);
    return true;
}

void HttpServer::onNewConnection()
{
    while (server_.hasPendingConnections()) {
        QLocalSocket *socket = server_.nextPendingConnection();
        auto *conn = new Conn{new HttpParser(), {}};
        conns_.insert(socket, conn);

        connect(socket, &QLocalSocket::readyRead,      this, &HttpServer::onReadyRead);
        connect(socket, &QLocalSocket::disconnected,   this, &HttpServer::onDisconnected);
    }
}

void HttpServer::onReadyRead()
{
    auto *socket = qobject_cast<QLocalSocket *>(sender());
    if (!socket) return;

    auto it = conns_.find(socket);
    if (it == conns_.end()) return;
    Conn *conn = it.value();

    conn->buf.append(socket->readAll());

    for (;;) {
        auto status = conn->parser->consume(conn->buf);

        if (status == ParseStatus::Done) {
            // Drop consumed bytes from buffer
            conn->buf.remove(0, conn->parser->bytesConsumed());

            HttpRequest req = conn->parser->request();
            conn->parser->reset();

            QPointer<QLocalSocket> safeSocket(socket);
            HttpResponder responder = [this, safeSocket](int httpStatus, const QByteArray &jsonBody) {
                if (!safeSocket) return;
                writeResponse(safeSocket, httpStatus, jsonBody);
                safeSocket->disconnectFromServer();
            };

            emit requestReceived(req, responder);
            break; // no keep-alive; connection will close
        }
        else if (status == ParseStatus::NeedMore) {
            break;
        }
        else {
            // BadRequest or TooLarge
            writeResponse(socket, 400, R"({"error":"bad request"})");
            socket->disconnectFromServer();
            break;
        }
    }
}

void HttpServer::onDisconnected()
{
    auto *socket = qobject_cast<QLocalSocket *>(sender());
    if (!socket) return;

    auto it = conns_.find(socket);
    if (it != conns_.end()) {
        Conn *conn = it.value();
        delete conn->parser;
        delete conn;
        conns_.erase(it);
    }
    socket->deleteLater();
}

void HttpServer::writeResponse(QLocalSocket *s, int status, const QByteArray &body)
{
    const char *reason = reasonPhrase(status);
    QByteArray response;
    response.reserve(128 + body.size());
    response += "HTTP/1.1 ";
    response += QByteArray::number(status);
    response += ' ';
    response += reason;
    response += "\r\n";
    response += "Content-Type: application/json\r\n";
    response += "X-API-Version: 0\r\n";
    response += "Content-Length: ";
    response += QByteArray::number(body.size());
    response += "\r\n";
    response += "Connection: close\r\n";
    response += "\r\n";
    response += body;

    s->write(response);
    s->flush();
}

} // namespace walqt
