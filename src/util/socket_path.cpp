#include "util/socket_path.h"
#include <QDir>
namespace walqt {
static QString base() {
    QString r = qEnvironmentVariable("XDG_RUNTIME_DIR");
    return r.isEmpty() ? QDir::tempPath() : r;
}
QString socketPath() { return base() + "/wayland-utauri.sock"; }
QString lockPath()   { return base() + "/wayland-utauri.lock"; }
}
