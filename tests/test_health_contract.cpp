#include <QtTest/QtTest>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>

#include "http/http_request.h"
#include "wallpaper/wallpaper_controller.h"
#include "web/network_interceptor.h"
#include "web/scheme_handler.h"

using namespace walqt;

class TestHealthContract : public QObject {
    Q_OBJECT
private slots:
    void health_matches_waypaper_engine()
    {
        int status = 0;
        QByteArray body;
        WaypaperHtmlSchemeHandler sh(nullptr);
        NetworkInterceptor ni(nullptr);
        WallpaperController c(&sh, &ni, nullptr);

        HttpRequest req;
        req.method = QStringLiteral("GET");
        req.path = QStringLiteral("/health");
        c.handleRequest(req, [&](int s, const QByteArray &b) {
            status = s;
            body = b;
        });

        QCOMPARE(status, 200);
        QJsonDocument doc = QJsonDocument::fromJson(body);
        QVERIFY(doc.isObject());
        QJsonObject o = doc.object();
        QVERIFY(o.value(QStringLiteral("ok")).toBool());
        QCOMPARE(o.value(QStringLiteral("service")).toString(),
                 QStringLiteral("wal-qt"));
        QCOMPARE(o.value(QStringLiteral("api_version")).toString(),
                 QStringLiteral("0"));
    }

    void status_matches_waypaper_status_response_shape()
    {
        int status = 0;
        QByteArray body;
        WaypaperHtmlSchemeHandler sh(nullptr);
        NetworkInterceptor ni(nullptr);
        WallpaperController c(&sh, &ni, nullptr);

        HttpRequest req;
        req.method = QStringLiteral("GET");
        req.path = QStringLiteral("/wallpaper/status");
        c.handleRequest(req, [&](int s, const QByteArray &b) {
            status = s;
            body = b;
        });

        QCOMPARE(status, 200);
        QJsonObject o = QJsonDocument::fromJson(body).object();
        QVERIFY(o.value(QStringLiteral("ok")).toBool());
        QCOMPARE(o.value(QStringLiteral("api_version")).toString(), QStringLiteral("0"));
        QJsonObject st = o.value(QStringLiteral("status")).toObject();
        QVERIFY(st.contains(QStringLiteral("topology")));
        QVERIFY(st.value(QStringLiteral("topology")).isArray());
        QVERIFY(st.contains(QStringLiteral("monitors")));
        QCOMPARE(st.value(QStringLiteral("monitor_count")).toInt(),
                 st.value(QStringLiteral("monitors")).toArray().size());
    }
};

int main(int argc, char **argv)
{
    QGuiApplication app(argc, argv);
    TestHealthContract t;
    return QTest::qExec(&t, argc, argv);
}

#include "test_health_contract.moc"
