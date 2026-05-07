#pragma once
#include <QByteArray>
#include <QString>
#include <functional>
#include <memory>
namespace walqt {
using LoadResponder = std::function<void(int status, const QByteArray &body)>;

class PendingLoad : public std::enable_shared_from_this<PendingLoad> {
public:
    PendingLoad(int expected, LoadResponder respond);
    void ack(bool ok, const QString &err);   // monitor reported transition done
    void timeout();                           // 30s elapsed
    bool finished() const { return done_; }

private:
    int remaining_;
    bool anyFailed_ = false;
    bool timedOut_ = false;
    QString firstError_;
    LoadResponder respond_;
    bool done_ = false;
    void finish();
};
}
