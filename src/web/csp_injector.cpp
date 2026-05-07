#include "web/csp_injector.h"
#include <QJsonArray>
#include <QJsonDocument>

QString walqt::defaultCspPolicy() {
    return QStringLiteral(
        "default-src 'self' waypaperhtml: file: data: blob:; "
        "script-src 'self' 'unsafe-eval' waypaperhtml: file:; "
        "connect-src 'none'; "
        "frame-src 'none';");
}

QWebEngineScript walqt::buildCspInjectionScript(const QString &cspPolicy) {
    // JSON-encode the policy string so any embedded quotes or backslashes are
    // safely escaped in the generated JS source.
    QJsonDocument doc(QJsonArray{cspPolicy});
    QString arrJson = QString::fromUtf8(doc.toJson(QJsonDocument::Compact));
    // arrJson is e.g. ["default-src 'self' ..."]
    // Strip the surrounding [ and ] to obtain the bare JSON string literal.
    QString stringLiteral = arrJson.mid(1, arrJson.size() - 2);

    QString js = QStringLiteral(R"js(
        (function() {
            var m = document.createElement('meta');
            m.httpEquiv = 'Content-Security-Policy';
            m.content = %1;
            (document.head || document.documentElement).appendChild(m);
        })();
    )js").arg(stringLiteral);

    QWebEngineScript script;
    script.setName(QStringLiteral("walCspInject"));
    script.setSourceCode(js);
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(QWebEngineScript::MainWorld);
    script.setRunsOnSubFrames(false);
    return script;
}
