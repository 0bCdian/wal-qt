#include <QtTest/QtTest>
#include "util/socket_path.h"

class TestSocketPath : public QObject {
    Q_OBJECT
private slots:
    void prefersXdgRuntimeDir() {
        qputenv("XDG_RUNTIME_DIR", "/run/user/1000");
        QCOMPARE(walqt::socketPath(), QString("/run/user/1000/wal-qt.sock"));
        QCOMPARE(walqt::lockPath(),   QString("/run/user/1000/wal-qt-host.lock"));
    }
    void fallsBackToTmp() {
        qunsetenv("XDG_RUNTIME_DIR");
        QVERIFY(walqt::socketPath().endsWith("/wal-qt.sock"));
    }
};
QTEST_GUILESS_MAIN(TestSocketPath)
#include "test_socket_path.moc"
