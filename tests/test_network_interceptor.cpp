#include <QtTest/QtTest>
#include "web/network_interceptor.h"
using namespace walqt;
class TestInterceptor : public QObject { Q_OBJECT
private slots:
    void allowsLocalSchemesAlways() {
        for (const char *s : {"waypaperhtml","file","qrc","data","blob"})
            QVERIFY(!shouldBlock(QString::fromLatin1(s), "anyhost", false, {}));
    }
    void blocksRemoteWhenDisabled() {
        QVERIFY(shouldBlock("https", "example.com", false, {}));
    }
    void allowsRemoteWhenEnabled() {
        QVERIFY(!shouldBlock("https", "example.com", true, {}));
    }
    void respectsAllowlistCaseInsensitively() {
        QStringList allow{"api.example.com"};
        QVERIFY(!shouldBlock("https", "API.Example.COM", false, allow));
        QVERIFY( shouldBlock("https", "evil.com",         false, allow));
    }
};
QTEST_GUILESS_MAIN(TestInterceptor)
#include "test_network_interceptor.moc"
