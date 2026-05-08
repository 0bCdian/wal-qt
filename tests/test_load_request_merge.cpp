#include "wallpaper/load_request_merge.h"

#include <QJsonArray>
#include <QJsonObject>
#include <QTest>

using walqt::mergeLoadRequestTargetForScreen;

class TestLoadRequestMerge : public QObject {
    Q_OBJECT
private slots:
    void passthrough_clone_style()
    {
        QJsonObject in;
        in[QStringLiteral("kind")] = QStringLiteral("image");
        in[QStringLiteral("target")] = QStringLiteral("/clone.png");

        QCOMPARE(mergeLoadRequestTargetForScreen(in, QStringLiteral("DP-1")), in);
    }

    void merges_matching_row_individual_payload()
    {
        QJsonObject row1;
        row1[QStringLiteral("name")] = QStringLiteral("DP-1");
        row1[QStringLiteral("target")] = QStringLiteral("/a.jpg");
        row1[QStringLiteral("kind")] = QStringLiteral("image");
        QJsonObject row2;
        row2[QStringLiteral("name")] = QStringLiteral("HDMI-A-1");
        row2[QStringLiteral("target")] = QStringLiteral("/b.jpg");
        row2[QStringLiteral("kind")] = QStringLiteral("image");

        QJsonArray arr;
        arr.append(row1);
        arr.append(row2);

        QJsonObject in;
        in[QStringLiteral("kind")] = QStringLiteral("image");
        in[QStringLiteral("targets")] = arr;

        const QJsonObject got = mergeLoadRequestTargetForScreen(in, QStringLiteral("HDMI-A-1"));

        QCOMPARE(got.value(QStringLiteral("target")).toString(), QStringLiteral("/b.jpg"));
        QCOMPARE(got.value(QStringLiteral("kind")).toString(), QStringLiteral("image"));
        QVERIFY(got.value(QStringLiteral("targets")).toArray().size() == 2);
    }

    void noop_when_screen_not_in_targets()
    {
        QJsonObject row;
        row[QStringLiteral("name")] = QStringLiteral("DP-1");
        row[QStringLiteral("target")] = QStringLiteral("/a.jpg");

        QJsonArray arr;
        arr.append(row);

        QJsonObject in;
        in[QStringLiteral("kind")] = QStringLiteral("image");
        in[QStringLiteral("targets")] = arr;

        const QJsonObject got = mergeLoadRequestTargetForScreen(in, QStringLiteral("OTHER"));

        QVERIFY(!got.contains(QStringLiteral("target")) ||
                got.value(QStringLiteral("target")).toString().isEmpty());
    }
};

QTEST_MAIN(TestLoadRequestMerge)
#include "test_load_request_merge.moc"
