#include "web/chromium_env.h"

#include <QByteArray>

namespace walqt {

namespace {

const char kEnvTuning[] = "WAL_QT_WEBENGINE_TUNING";
const char kEnvExperimentalSingleProcess[] = "WAL_QT_EXPERIMENTAL_SINGLE_PROCESS";
const char kEnvNoSandbox[] = "WAL_QT_WEBENGINE_NO_SANDBOX";

bool webEngineTuningEnabledFromEnv()
{
    const QByteArray v = qgetenv(kEnvTuning).trimmed();
    return v.compare("1", Qt::CaseInsensitive) == 0
        || v.compare("true", Qt::CaseInsensitive) == 0
        || v.compare("yes", Qt::CaseInsensitive) == 0;
}

bool experimentalSingleProcessFromEnv()
{
    const QByteArray v = qgetenv(kEnvExperimentalSingleProcess).trimmed();
    return v.compare("1", Qt::CaseInsensitive) == 0
        || v.compare("true", Qt::CaseInsensitive) == 0
        || v.compare("yes", Qt::CaseInsensitive) == 0;
}

bool webEngineNoSandboxFromEnv()
{
    const QByteArray v = qgetenv(kEnvNoSandbox).trimmed();
    return v.compare("1", Qt::CaseInsensitive) == 0
        || v.compare("true", Qt::CaseInsensitive) == 0
        || v.compare("yes", Qt::CaseInsensitive) == 0;
}

} // namespace

QString baselineChromiumFlags(ChromiumBaselineOptions options)
{
    // Defaults favor stability on Wayland/GPU stacks. Heavier trims (Vulkan off, PaintHolding
    // off, 64MB heaps, lite-mode, --disable-accelerated-video-decode, GPU shader cache off),
    // caused jank/regressions for users — prepend those via QTWEBENGINE_CHROMIUM_FLAGS if desired.
    QString flags = QStringLiteral(
        "--renderer-process-limit=1 "
        "--process-per-site "
        "--disable-site-isolation-trials "
        "--disable-gpu-memory-buffer-video-frames "
        "--disable-dev-shm-usage "
        "--js-flags=--max-old-space-size=128 --expose-gc "
        "--disable-features=Translate,MediaRouter,OptimizationHints,WebRTC,PrintPreview,"
        "SitePerProcess,IsolateOrigins "
        "--disable-extensions "
        "--disable-speech-api "
        "--disable-notifications ");

    if (options.experimentalSingleProcess) {
        // Qt WebEngine logs ERROR (not fatal) that the V8/Mojo proxy resolver cannot run in
        // single-process mode; Chromium still applies proxy config without that factory.
        flags += QStringLiteral("--single-process ");
    }

    if (options.noSandbox)
        flags += QStringLiteral("--no-sandbox ");

    return flags.trimmed();
}

QString composeChromiumFlags(const QString &existing, ChromiumBaselineOptions options)
{
    const QString trimmed = existing.trimmed();
    const QString add = baselineChromiumFlags(options);
    if (trimmed.isEmpty())
        return add;
    return trimmed + QLatin1Char(' ') + add;
}

void applyChromiumEnvironment()
{
    if (!webEngineTuningEnabledFromEnv())
        return;

    const ChromiumBaselineOptions opts{
        .experimentalSingleProcess = experimentalSingleProcessFromEnv(),
        .noSandbox = webEngineNoSandboxFromEnv(),
    };
    const QString existing =
        QString::fromUtf8(qgetenv("QTWEBENGINE_CHROMIUM_FLAGS"));
    const QString merged = composeChromiumFlags(existing, opts);
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", merged.toUtf8());
}

} // namespace walqt
