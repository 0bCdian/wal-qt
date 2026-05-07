#include <QtTest/QtTest>
#include "web/csp_injector.h"

class TestCsp : public QObject {
    Q_OBJECT
private slots:
    void policyContainsConnectNone() {
        QVERIFY(walqt::defaultCspPolicy().contains("connect-src 'none'"));
    }
    void scriptIsDocumentCreationMainWorld() {
        auto s = walqt::buildCspInjectionScript("default-src 'none'");
        QCOMPARE(s.injectionPoint(), QWebEngineScript::DocumentCreation);
        QCOMPARE(s.worldId(), (quint32)QWebEngineScript::MainWorld);
        QVERIFY(s.sourceCode().contains("default-src 'none'"));
        QVERIFY(!s.runsOnSubFrames());
    }
};

QTEST_GUILESS_MAIN(TestCsp)
#include "test_csp_injector.moc"
