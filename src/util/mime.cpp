#include "util/mime.h"
namespace walqt {
QByteArray mimeForPath(const QString &path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".js"))   return "application/javascript";
    if (path.endsWith(".css"))  return "text/css";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".png"))  return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".mp4"))  return "video/mp4";
    if (path.endsWith(".webm")) return "video/webm";
    if (path.endsWith(".wasm")) return "application/wasm";
    return "application/octet-stream";
}
}
