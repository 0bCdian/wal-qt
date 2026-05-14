#include <QApplication>
#include <QByteArray>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QFile>
#include <QTextStream>
#include <QWebEngineUrlScheme>

#include "version.h"
#include "web/chromium_env.h"
#include "app/app.h"
#include "app/single_instance.h"
#include "web/scheme_handler.h"
#include "web/network_interceptor.h"

#if defined(Q_OS_UNIX) && !defined(Q_OS_MACOS)
static void ensureFontconfigEnv()
{
    // WebEngine / Chromium loads fontconfig for web text. An empty or invalid
    // FONTCONFIG_FILE yields: "Cannot load default config file: No such file: (null)"
    // (common when a parent process exports FONTCONFIG_FILE="").
    const QByteArray fc = qgetenv("FONTCONFIG_FILE");
    if (qEnvironmentVariableIsSet("FONTCONFIG_FILE")) {
        if (fc.trimmed().isEmpty() ||
            !QFile::exists(QString::fromLocal8Bit(fc))) {
            qunsetenv("FONTCONFIG_FILE");
        }
    }
    if (qEnvironmentVariableIsEmpty("FONTCONFIG_FILE")) {
        static const char *candidates[] = {
            "/etc/fonts/fonts.conf",
            "/usr/local/etc/fonts/fonts.conf",
        };
        for (const char *p : candidates) {
            if (QFile::exists(QString::fromUtf8(p))) {
                qputenv("FONTCONFIG_FILE", p);
                break;
            }
        }
    }
    const QByteArray fcp = qgetenv("FONTCONFIG_PATH");
    if (qEnvironmentVariableIsSet("FONTCONFIG_PATH") && fcp.trimmed().isEmpty())
        qunsetenv("FONTCONFIG_PATH");
}
#endif

int main(int argc, char *argv[]) {
    if (qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
        qputenv("QT_QPA_PLATFORM", "wayland");
    walqt::applyChromiumEnvironment();
#if defined(Q_OS_UNIX) && !defined(Q_OS_MACOS)
    ensureFontconfigEnv();
#endif

    QWebEngineUrlScheme scheme("waypaperhtml");
    scheme.setFlags(QWebEngineUrlScheme::SecureScheme |
                    QWebEngineUrlScheme::LocalScheme |
                    QWebEngineUrlScheme::LocalAccessAllowed |
                    QWebEngineUrlScheme::CorsEnabled);
    QWebEngineUrlScheme::registerScheme(scheme);

    QWebEngineUrlScheme walfile(QByteArrayLiteral("walfile"));
    walfile.setFlags(QWebEngineUrlScheme::SecureScheme |
                     QWebEngineUrlScheme::CorsEnabled |
                     QWebEngineUrlScheme::FetchApiAllowed);
    QWebEngineUrlScheme::registerScheme(walfile);

    QApplication app(argc, argv);
    app.setApplicationName("wal-qt-host");
    app.setApplicationVersion(QStringLiteral(WAL_QT_HOST_VERSION));

    QCommandLineParser parser;
    parser.addOption(QCommandLineOption(QStringList() << "version", "Print version and exit."));
    parser.addOption(QCommandLineOption(QStringList() << "h" << "help", "Print help and exit."));
    parser.process(app);

    if (parser.isSet("version")) {
        QTextStream out(stdout);
        out << "wal-qt-host " << app.applicationVersion() << "\n";
        return 0;
    }
    if (parser.isSet("help")) {
        QTextStream out(stdout);
        out << "Usage: wal-qt-host [--version] [-h|--help]\n"
            << "\n"
            << "Qt6 WebEngine Wayland wallpaper host for waypaper-engine.\n"
            << "\n"
            << "Options:\n"
            << "  --version   Print version and exit.\n"
            << "  -h, --help  Print this help and exit.\n"
            << "\n"
            << "Run with no arguments to start the host normally.\n"
            << "See the README for details: https://github.com/0bCdian/wal-qt\n";
        return 0;
    }

    walqt::SingleInstance lock;
    if (!lock.acquire()) {
        qCritical("Another wal-qt-host instance is already running");
        return 1;
    }

    auto *interceptor = new walqt::NetworkInterceptor(&app);
    auto *schemeHandler = new walqt::WaypaperHtmlSchemeHandler(&app);
    walqt::App walapp(schemeHandler, interceptor);
    if (!walapp.start()) {
        qCritical("Failed to bind control socket");
        return 1;
    }

    return app.exec();
}
