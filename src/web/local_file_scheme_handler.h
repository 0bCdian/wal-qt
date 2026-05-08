#pragma once
#include <QWebEngineUrlSchemeHandler>

namespace walqt {

/// Serves absolute filesystem paths as <scheme>://… so the qrc renderer can load gallery files.
/// Chromium blocks file:// subresources from qrc: pages regardless of LocalContentCanAccessFileUrls.
class LocalFileSchemeHandler : public QWebEngineUrlSchemeHandler {
public:
    using QWebEngineUrlSchemeHandler::QWebEngineUrlSchemeHandler;
    void requestStarted(QWebEngineUrlRequestJob *job) override;
};

} // namespace walqt
