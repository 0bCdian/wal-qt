#pragma once
#include <QByteArray>
#include <QString>
namespace walqt {
struct HttpRequest {
    QString method;     // "GET" / "POST"
    QString path;       // "/wallpaper/load"
    QByteArray body;    // raw bytes
};
enum class ParseStatus { NeedMore, Done, BadRequest, TooLarge };
}
