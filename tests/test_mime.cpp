#include <QtTest/QtTest>
#include "util/mime.h"
class TestMime : public QObject { Q_OBJECT
private slots:
    void knownTypes_data() {
        QTest::addColumn<QString>("path"); QTest::addColumn<QByteArray>("mime");
        QTest::newRow("html") << "x.html" << QByteArray("text/html");
        QTest::newRow("js")   << "x.js"   << QByteArray("application/javascript");
        QTest::newRow("css")  << "a/b.css"<< QByteArray("text/css");
        QTest::newRow("json") << "m.json" << QByteArray("application/json");
        QTest::newRow("png")  << "i.png"  << QByteArray("image/png");
        QTest::newRow("jpg")  << "i.jpg"  << QByteArray("image/jpeg");
        QTest::newRow("jpeg") << "i.jpeg" << QByteArray("image/jpeg");
        QTest::newRow("mp4")  << "v.mp4"  << QByteArray("video/mp4");
        QTest::newRow("webm") << "v.webm" << QByteArray("video/webm");
        QTest::newRow("wasm") << "m.wasm" << QByteArray("application/wasm");
        QTest::newRow("unk")  << "x.zzz"  << QByteArray("application/octet-stream");
    }
    void knownTypes() { QFETCH(QString,path); QFETCH(QByteArray,mime);
        QCOMPARE(walqt::mimeForPath(path), mime); }
};
QTEST_GUILESS_MAIN(TestMime)
#include "test_mime.moc"
