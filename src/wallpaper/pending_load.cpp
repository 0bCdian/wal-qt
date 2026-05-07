#include "wallpaper/pending_load.h"
#include <QJsonObject>
#include <QJsonDocument>

walqt::PendingLoad::PendingLoad(int expected, LoadResponder respond)
    : remaining_(expected), respond_(std::move(respond)) {}

void walqt::PendingLoad::ack(bool ok, const QString &err) {
    if (done_) return;
    if (!ok && firstError_.isEmpty()) {
        anyFailed_ = true;
        firstError_ = err.isEmpty() ? QStringLiteral("unknown") : err;
    }
    if (--remaining_ <= 0) finish();
}

void walqt::PendingLoad::timeout() {
    if (done_) return;
    timedOut_ = true;
    anyFailed_ = true;
    firstError_ = QStringLiteral("timeout");
    finish();
}

void walqt::PendingLoad::finish() {
    if (done_) return;
    done_ = true;
    if (!anyFailed_) {
        respond_(200, QByteArray(R"({"ok":true})"));
        return;
    }
    QJsonObject body{{"ok", false}, {"error", firstError_}};
    int status = timedOut_ ? 504 : 500;
    respond_(status, QJsonDocument(body).toJson(QJsonDocument::Compact));
}
