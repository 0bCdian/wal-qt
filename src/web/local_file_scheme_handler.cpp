#include "web/local_file_scheme_handler.h"
#include "util/mime.h"

#include <QFile>
#include <QFileInfo>
#include <QUrl>
#include <QWebEngineUrlRequestJob>

void walqt::LocalFileSchemeHandler::requestStarted(QWebEngineUrlRequestJob *job)
{
    const QUrl url = job->requestUrl();
    if (url.scheme() != QStringLiteral("walfile")) {
        job->fail(QWebEngineUrlRequestJob::RequestDenied);
        return;
    }

    QString path = url.path(QUrl::FullyDecoded);
    if (path.isEmpty()) {
        job->fail(QWebEngineUrlRequestJob::UrlNotFound);
        return;
    }

    const QFileInfo fi(path);
    if (!fi.exists() || !fi.isFile() || !fi.isReadable()) {
        job->fail(QWebEngineUrlRequestJob::UrlNotFound);
        return;
    }

    auto *file = new QFile(path, job);
    if (!file->open(QIODevice::ReadOnly)) {
        delete file;
        job->fail(QWebEngineUrlRequestJob::RequestFailed);
        return;
    }
    job->reply(mimeForPath(path), file);
}
