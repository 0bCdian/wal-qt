#include <QtTest/QtTest>
#include "wallpaper/target_resolver.h"
using namespace walqt;
static QString fx(const char *sub) { return QString(WALQT_FIXTURES_DIR) + "/" + sub; }
class TestTargetResolver : public QObject { Q_OBJECT
private slots:
    void manifestPath() {
        auto r = resolveWebTarget(fx("pkg_with_manifest/waypaper.json"));
        QCOMPARE(r.packageRoot, fx("pkg_with_manifest"));
        QCOMPARE(r.entryFile,   fx("pkg_with_manifest/index.html"));
        QVERIFY(r.hasManifest);
        QCOMPARE(r.manifest.network, true);
        QCOMPARE(r.manifest.entry, QString("index.html"));
        QCOMPARE(r.manifest.wallpaperConfig.value("color").toString(), QString("#fff"));
    }
    void directoryWithManifest() {
        auto r = resolveWebTarget(fx("pkg_with_manifest"));
        QCOMPARE(r.entryFile, fx("pkg_with_manifest/index.html"));
        QVERIFY(r.hasManifest);
    }
    void directoryWithoutManifestFallsToIndexHtml() {
        auto r = resolveWebTarget(fx("pkg_html_only"));
        QCOMPARE(r.entryFile, fx("pkg_html_only/index.html"));
        QVERIFY(!r.hasManifest);
    }
    void htmlPathFindsManifestSibling() {
        auto r = resolveWebTarget(fx("pkg_with_manifest/index.html"));
        QVERIFY(r.hasManifest);
        QCOMPARE(r.packageRoot, fx("pkg_with_manifest"));
    }
    void emptyDirectoryFails() {
        auto r = resolveWebTarget(fx("pkg_directory_only"));
        QVERIFY(r.packageRoot.isEmpty());
    }
    void manifestEntryFieldRespected() {
        QTemporaryDir d; QVERIFY(d.isValid());
        QFile e(d.filePath("custom.html")); QVERIFY(e.open(QIODevice::WriteOnly)); e.write("x"); e.close();
        QFile m(d.filePath("waypaper.json")); QVERIFY(m.open(QIODevice::WriteOnly));
        m.write(R"({"entry":"custom.html"})"); m.close();
        auto r = resolveWebTarget(d.path());
        QCOMPARE(r.entryFile, d.filePath("custom.html"));
    }
};
QTEST_GUILESS_MAIN(TestTargetResolver)
#include "test_target_resolver.moc"
