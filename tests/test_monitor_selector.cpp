#include <QtTest/QtTest>
#include <QJsonArray>
#include <QJsonObject>

#include "wallpaper/monitor_selector.h"

using namespace walqt;

class TestMonitorSelector : public QObject {
    Q_OBJECT
private slots:
    void smoke()
    {
        QCOMPARE(MonitorSelector::all().kind, MonitorSelector::Kind::All);
    }

    // --- decodeLoadSelector ---

    void load_missingTargets_returnsAll()
    {
        QJsonObject req;
        QCOMPARE(decodeLoadSelector(req), MonitorSelector::all());
    }

    void load_emptyTargets_returnsAll()
    {
        QJsonObject req{{"targets", QJsonArray{}}};
        QCOMPARE(decodeLoadSelector(req), MonitorSelector::all());
    }

    void load_targetsArray_returnsByNamesInOrder()
    {
        QJsonObject req{
            {"targets",
             QJsonArray{
                 QJsonObject{{"name", "HDMI-A-1"}},
                 QJsonObject{{"name", "DP-1"}},
             }}};
        const auto sel = decodeLoadSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"HDMI-A-1", "DP-1"}));
    }

    void load_targetsWithoutName_skipsEntry()
    {
        QJsonObject req{
            {"targets",
             QJsonArray{
                 QJsonObject{{"name", "HDMI-A-1"}},
                 QJsonObject{},             // no name
                 QJsonObject{{"name", ""}}, // empty name
                 QJsonObject{{"name", "DP-1"}},
             }}};
        const auto sel = decodeLoadSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"HDMI-A-1", "DP-1"}));
    }

    void load_targetsWrongType_returnsAll()
    {
        QJsonObject req{{"targets", "HDMI-A-1"}}; // not an array
        QCOMPARE(decodeLoadSelector(req), MonitorSelector::all());
    }

    // --- decodeParallaxSelector ---

    void parallax_singleName_returnsByNames()
    {
        QJsonObject req{{"name", "HDMI-A-1"}};
        const auto sel = decodeParallaxSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"HDMI-A-1"}));
    }

    void parallax_emptyName_fallsBackToLoad()
    {
        QJsonObject req{{"name", ""},
                         {"targets",
                          QJsonArray{
                              QJsonObject{{"name", "DP-1"}},
                          }}};
        const auto sel = decodeParallaxSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByNames);
        QCOMPARE(sel.names, (QStringList{"DP-1"}));
    }

    void parallax_missingName_andMissingTargets_returnsAll()
    {
        QJsonObject req;
        QCOMPARE(decodeParallaxSelector(req), MonitorSelector::all());
    }

    void parallax_nameWrongType_fallsBackToLoad()
    {
        QJsonObject req{{"name", 42}};
        QCOMPARE(decodeParallaxSelector(req), MonitorSelector::all());
    }

    // --- decodeBySourceSelector ---

    void bySource_present_returnsByCurrentSource()
    {
        QJsonObject req{{"source_target", "/path/to/wp.jpg"}};
        const auto sel = decodeBySourceSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByCurrentSource);
        QCOMPARE(sel.source, QStringLiteral("/path/to/wp.jpg"));
    }

    void bySource_missing_returnsByCurrentSourceEmpty()
    {
        QJsonObject req;
        const auto sel = decodeBySourceSelector(req);
        QCOMPARE(sel.kind, MonitorSelector::Kind::ByCurrentSource);
        QCOMPARE(sel.source, QString());
    }

    // --- resolveIndices ---

    void resolve_all_returnsAllIndicesInOrder()
    {
        QList<MonitorView> ms{
            {"HDMI-A-1", ""},
            {"DP-1", "/x.jpg"},
            {"eDP-1", ""},
        };
        QCOMPARE(resolveIndices(MonitorSelector::all(), ms),
                  (QList<int>{0, 1, 2}));
    }

    void resolve_all_emptyMonitors_returnsEmpty()
    {
        QCOMPARE(resolveIndices(MonitorSelector::all(), {}), QList<int>{});
    }

    void resolve_byNames_picksRequestedInRequestedOrder()
    {
        QList<MonitorView> ms{
            {"HDMI-A-1", ""},
            {"DP-1", ""},
            {"eDP-1", ""},
        };
        const auto sel = MonitorSelector::byNames({"DP-1", "HDMI-A-1"});
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{1, 0}));
    }

    void resolve_byNames_unknownNameSkipped()
    {
        QList<MonitorView> ms{{"HDMI-A-1", ""}};
        const auto sel = MonitorSelector::byNames({"NOPE", "HDMI-A-1"});
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{0}));
    }

    void resolve_byNames_duplicateNamesProduceDuplicateIndices()
    {
        QList<MonitorView> ms{{"HDMI-A-1", ""}};
        const auto sel = MonitorSelector::byNames({"HDMI-A-1", "HDMI-A-1"});
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{0, 0}));
    }

    void resolve_byCurrentSource_matchesByEquality()
    {
        QList<MonitorView> ms{
            {"HDMI-A-1", "/a.jpg"},
            {"DP-1", "/b.jpg"},
            {"eDP-1", "/a.jpg"},
        };
        const auto sel = MonitorSelector::byCurrentSource("/a.jpg");
        QCOMPARE(resolveIndices(sel, ms), (QList<int>{0, 2}));
    }

    void resolve_byCurrentSource_emptyStringMatchesNothing()
    {
        QList<MonitorView> ms{
            {"HDMI-A-1", ""},
            {"DP-1", "/b.jpg"},
        };
        const auto sel = MonitorSelector::byCurrentSource("");
        QCOMPARE(resolveIndices(sel, ms), QList<int>{});
    }
};

QTEST_GUILESS_MAIN(TestMonitorSelector)
#include "test_monitor_selector.moc"
