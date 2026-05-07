#include <QtTest/QtTest>
#include "web/scheme_handler.h"
using namespace walqt;
static QString fx(const char *s){ return QString(WALQT_FIXTURES_DIR)+"/"+s; }
class TestSchemePaths : public QObject { Q_OBJECT
private slots:
    void resolvesSafeFile() {
        auto p = resolveSchemePath(fx("malicious_path_traversal"), "safe.txt");
        QVERIFY(p.endsWith("/malicious_path_traversal/safe.txt"));
    }
    void rejectsSymlinkEscape() {
        auto p = resolveSchemePath(fx("malicious_path_traversal"), "escape.txt");
        QVERIFY2(p.isEmpty(), "symlink to /etc/passwd must be rejected");
    }
    void rejectsDotDotTraversal() {
        QVERIFY(resolveSchemePath(fx("pkg_with_manifest"), "../pkg_html_only/index.html").isEmpty());
    }
    void rejectsAbsolutePath() {
        QVERIFY(resolveSchemePath(fx("pkg_with_manifest"), "/etc/passwd").isEmpty());
    }
    void rejectsNonexistent() {
        QVERIFY(resolveSchemePath(fx("pkg_with_manifest"), "nope.html").isEmpty());
    }
    void allowsRootIndexHtml() {
        QVERIFY(!resolveSchemePath(fx("pkg_with_manifest"), "index.html").isEmpty());
    }
    void handlesPercentEncoding() {
        // %2E = '.' — recombined this is "index.html"
        auto p = resolveSchemePath(fx("pkg_with_manifest"), "index%2Ehtml");
        QVERIFY(!p.isEmpty());
    }
};
QTEST_GUILESS_MAIN(TestSchemePaths)
#include "test_scheme_handler_paths.moc"
