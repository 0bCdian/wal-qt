#pragma once
#include <QWebEngineUrlSchemeHandler>
#include <QString>
namespace walqt {
// Pure: returns absolute resolved path on success, or empty QString on rejection.
// Rejects: nonexistent paths, traversal escaping packageRoot, symlink escape, absolute paths.
QString resolveSchemePath(const QString &packageRoot, const QString &urlPath);

class WaypaperHtmlSchemeHandler : public QWebEngineUrlSchemeHandler {
    Q_OBJECT
public:
    using QWebEngineUrlSchemeHandler::QWebEngineUrlSchemeHandler;
    void setPackageRoot(const QString &root);
    void requestStarted(QWebEngineUrlRequestJob *job) override;
private:
    QString packageRoot_;
};
}
