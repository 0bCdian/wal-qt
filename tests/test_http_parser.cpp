#include <QtTest/QtTest>
#include "http/http_parser.h"
using namespace walqt;
class TestHttpParser : public QObject { Q_OBJECT
private slots:
    void getNoBody() {
        HttpParser p;
        QCOMPARE(p.consume("GET /health HTTP/1.1\r\nHost: x\r\n\r\n"), ParseStatus::Done);
        QCOMPARE(p.request().method, QString("GET"));
        QCOMPARE(p.request().path,   QString("/health"));
        QCOMPARE(p.request().body.size(), 0);
    }
    void postWithJsonBody() {
        QByteArray b = "POST /wallpaper/load HTTP/1.1\r\n"
                       "Content-Type: application/json\r\n"
                       "Content-Length: 13\r\n\r\n"
                       "{\"ok\":true}\r\n";
        HttpParser p;
        QCOMPARE(p.consume(b), ParseStatus::Done);
        QCOMPARE(p.request().path, QString("/wallpaper/load"));
        QCOMPARE(p.request().body, QByteArray("{\"ok\":true}\r\n"));
    }
    void splitAcrossChunks() {
        HttpParser p;
        QCOMPARE(p.consume("POST /x HTTP/1.1\r\nContent-Length: 5"),
                 ParseStatus::NeedMore);
        QCOMPARE(p.consume("\r\n\r\nhel"), ParseStatus::NeedMore);
        QCOMPARE(p.consume("lo"), ParseStatus::Done);
        QCOMPARE(p.request().body, QByteArray("hello"));
    }
    void missingContentLengthOnPostMeansZero() {
        HttpParser p;
        QCOMPARE(p.consume("POST /x HTTP/1.1\r\n\r\n"), ParseStatus::Done);
        QCOMPARE(p.request().body.size(), 0);
    }
    void rejectsHugeHeader() {
        HttpParser p;
        QByteArray big(HttpParser::kMaxHeaderBytes + 1, 'A');
        QCOMPARE(p.consume(big), ParseStatus::TooLarge);
    }
    void rejectsHugeBody() {
        HttpParser p;
        QByteArray h = "POST /x HTTP/1.1\r\nContent-Length: 999999999\r\n\r\n";
        QCOMPARE(p.consume(h), ParseStatus::TooLarge);
    }
    void rejectsMalformedRequestLine() {
        HttpParser p;
        QCOMPARE(p.consume("GARBAGE\r\n\r\n"), ParseStatus::BadRequest);
    }
    void caseInsensitiveHeader() {
        HttpParser p;
        QByteArray b = "POST /x HTTP/1.1\r\ncoNTent-LENgth: 2\r\n\r\nhi";
        QCOMPARE(p.consume(b), ParseStatus::Done);
        QCOMPARE(p.request().body, QByteArray("hi"));
    }
};
QTEST_GUILESS_MAIN(TestHttpParser)
#include "test_http_parser.moc"
