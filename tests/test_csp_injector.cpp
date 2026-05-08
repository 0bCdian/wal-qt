#include <QtTest/QtTest>
#include "web/csp_injector.h"

class TestCsp : public QObject {
    Q_OBJECT
private slots:
    void policyAllowsLocalSchemesAndLocksFrames() {
        const QString p = walqt::defaultCspPolicy();
        QVERIFY(p.contains("walfile:"));
        QVERIFY(p.contains("connect-src"));
        QVERIFY(p.contains("frame-src 'none'"));
        QVERIFY(!p.contains("connect-src 'none'"));
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
