#include <QtTest/QtTest>

#include <QScopeGuard>

#include "web/chromium_env.h"

using walqt::ChromiumBaselineOptions;

class TestChromiumEnv : public QObject {
    Q_OBJECT
private slots:
    void baseline_default_shape()
    {
        const QString b = walqt::baselineChromiumFlags({});
        QVERIFY(b.contains(QStringLiteral("--renderer-process-limit=1")));
        QVERIFY(b.contains(QStringLiteral("--process-per-site")));
        QVERIFY(b.contains(QStringLiteral("--expose-gc")));
        QVERIFY(b.contains(QStringLiteral("--js-flags=")));
        QVERIFY(b.contains(QStringLiteral("max-old-space-size=128")));
        QVERIFY(b.contains(QStringLiteral("SitePerProcess")));
        QVERIFY(!b.contains(QStringLiteral("--disable-accelerated-video-decode")));
        QVERIFY(!b.contains(QStringLiteral("Vulkan")));
        QVERIFY(!b.contains(QStringLiteral("--single-process")));
        QVERIFY(!b.contains(QStringLiteral("--no-sandbox")));
    }

    void baseline_optionally_adds_single_process()
    {
        ChromiumBaselineOptions opt;
        opt.experimentalSingleProcess = true;
        const QString b = walqt::baselineChromiumFlags(opt);
        QVERIFY(b.contains(QStringLiteral("--single-process")));
        QVERIFY(!b.contains(QStringLiteral("--no-sandbox")));
    }

    void baseline_optionally_adds_no_sandbox()
    {
        ChromiumBaselineOptions opt;
        opt.noSandbox = true;
        const QString b = walqt::baselineChromiumFlags(opt);
        QVERIFY(b.contains(QStringLiteral("--no-sandbox")));
        QVERIFY(!b.contains(QStringLiteral("--single-process")));
    }

    void baseline_can_combine_single_process_and_no_sandbox()
    {
        ChromiumBaselineOptions opt;
        opt.experimentalSingleProcess = true;
        opt.noSandbox = true;
        const QString b = walqt::baselineChromiumFlags(opt);
        QVERIFY(b.contains(QStringLiteral("--single-process")));
        QVERIFY(b.contains(QStringLiteral("--no-sandbox")));
        const int sp = b.indexOf(QStringLiteral("--single-process"));
        const int ns = b.indexOf(QStringLiteral("--no-sandbox"));
        QVERIFY(sp >= 0 && ns > sp);
    }

    void compose_empty_existing()
    {
        const QString c = walqt::composeChromiumFlags(QString(), {});
        QCOMPARE(c, walqt::baselineChromiumFlags({}));
    }

    void compose_preserves_user_prefix()
    {
        const QString c =
            walqt::composeChromiumFlags(QStringLiteral("  --prior-flag  "), {});
        QCOMPARE(c, QStringLiteral("--prior-flag")
                      + QLatin1Char(' ')
                      + walqt::baselineChromiumFlags({}));
    }

    void compose_appends_single_process_when_requested()
    {
        ChromiumBaselineOptions opt;
        opt.experimentalSingleProcess = true;
        const QString c = walqt::composeChromiumFlags(QStringLiteral("x"), opt);
        QVERIFY(c.startsWith(QStringLiteral("x ")));
        QVERIFY(c.contains(QStringLiteral("--single-process")));
    }

    void apply_does_not_set_qtenv_when_tuning_off()
    {
        qunsetenv("WAL_QT_WEBENGINE_TUNING");
        qunsetenv("WAL_QT_EXPERIMENTAL_SINGLE_PROCESS");
        qunsetenv("WAL_QT_WEBENGINE_NO_SANDBOX");
        qunsetenv("QTWEBENGINE_CHROMIUM_FLAGS");

        walqt::applyChromiumEnvironment();

        QVERIFY(qEnvironmentVariableIsEmpty("QTWEBENGINE_CHROMIUM_FLAGS"));
    }

    void apply_merges_when_tuning_on()
    {
        const auto restore = [] {
            qunsetenv("WAL_QT_WEBENGINE_TUNING");
            qunsetenv("WAL_QT_EXPERIMENTAL_SINGLE_PROCESS");
            qunsetenv("WAL_QT_WEBENGINE_NO_SANDBOX");
            qunsetenv("QTWEBENGINE_CHROMIUM_FLAGS");
        };
        const QScopeGuard cleanup(restore);

        restore();
        qputenv("WAL_QT_WEBENGINE_TUNING", QByteArrayLiteral("1"));
        walqt::applyChromiumEnvironment();

        const QByteArray merged = qgetenv("QTWEBENGINE_CHROMIUM_FLAGS");
        QVERIFY(!merged.trimmed().isEmpty());
        QVERIFY(QString::fromUtf8(merged).contains(QStringLiteral("--renderer-process-limit=1")));
    }
};

QTEST_GUILESS_MAIN(TestChromiumEnv)
#include "test_chromium_env.moc"
