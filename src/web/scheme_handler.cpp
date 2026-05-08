#include "web/scheme_handler.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QUrl>
#include <QWebEngineUrlRequestJob>
#include "util/mime.h"

QString walqt::resolveSchemePath(const QString &packageRoot, const QString &rawUrlPath)
{
    if (packageRoot.isEmpty()) return {};
    QString decoded = QUrl::fromPercentEncoding(rawUrlPath.toUtf8());
    if (decoded.startsWith('/')) return {};   // reject absolute
    QString rootCanon = QFileInfo(packageRoot).canonicalFilePath();
    if (rootCanon.isEmpty()) return {};
    QString candidate = QDir(packageRoot).absoluteFilePath(decoded);
    QString resolved  = QFileInfo(candidate).canonicalFilePath();
    if (resolved.isEmpty()) return {};
    if (resolved != rootCanon && !resolved.startsWith(rootCanon + '/')) return {};
    return resolved;
}

void walqt::WaypaperHtmlSchemeHandler::setPackageRoot(const QString &root)
{
    packageRoot_ = root;
}

void walqt::WaypaperHtmlSchemeHandler::requestStarted(QWebEngineUrlRequestJob *job)
{
    // QUrl::path() of waypaperhtml://pkg/foo/bar.js is "/foo/bar.js" — the leading slash
    // is the URL path separator after the host, not a filesystem-absolute marker.
    // resolveSchemePath() expects a package-relative path and rejects anything starting
    // with '/' as an absolute-path traversal attempt; strip one leading slash here.
    QString rawPath = job->requestUrl().path();
    if (rawPath.startsWith('/'))
        rawPath = rawPath.mid(1);

    QString resolved = resolveSchemePath(packageRoot_, rawPath);
    if (resolved.isEmpty()) {
        job->fail(QWebEngineUrlRequestJob::RequestDenied);
        return;
    }
    auto *file = new QFile(resolved, job);
    if (!file->open(QIODevice::ReadOnly)) {
        job->fail(QWebEngineUrlRequestJob::UrlNotFound);
        return;
    }
    job->reply(walqt::mimeForPath(resolved), file);
}
