#include <QtTest/QtTest>
#include "wallpaper/pending_load.h"
using namespace walqt;
class TestPending : public QObject { Q_OBJECT
private slots:
    void singleAckSucceeds() {
        int status = 0; QByteArray body;
        auto p = std::make_shared<PendingLoad>(1,
            [&](int s, const QByteArray &b){ status = s; body = b; });
        p->ack(true, {});
        QCOMPARE(status, 200);
        QVERIFY(body.contains("\"ok\":true"));
    }
    void waitsForAllAcks() {
        int calls = 0;
        auto p = std::make_shared<PendingLoad>(2,
            [&](int,const QByteArray&){ ++calls; });
        p->ack(true, {}); QCOMPARE(calls, 0);
        p->ack(true, {}); QCOMPARE(calls, 1);
    }
    void anyFailureMakes500() {
        int status = 0; QByteArray body;
        auto p = std::make_shared<PendingLoad>(2,
            [&](int s, const QByteArray &b){ status = s; body = b; });
        p->ack(false, "decode-fail"); p->ack(true, {});
        QCOMPARE(status, 500);
        QVERIFY(body.contains("decode-fail"));
    }
    void timeoutSends504OnceOnly() {
        int calls = 0; int status = 0;
        auto p = std::make_shared<PendingLoad>(2,
            [&](int s, const QByteArray&){ ++calls; status = s; });
        p->timeout();
        QCOMPARE(calls, 1); QCOMPARE(status, 504);
        p->ack(true, {});
        QCOMPARE(calls, 1);
    }
};
QTEST_GUILESS_MAIN(TestPending)
#include "test_pending_load.moc"
