#pragma once
#include <QWebEngineScript>
#include <QString>
namespace walqt {
QString defaultCspPolicy();
QWebEngineScript buildCspInjectionScript(const QString &cspPolicy);
}
