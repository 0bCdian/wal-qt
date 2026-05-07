#pragma once
#include "http_request.h"
namespace walqt {
class HttpParser {
public:
    static constexpr int kMaxHeaderBytes = 16 * 1024;
    static constexpr int kMaxBodyBytes   = 4 * 1024 * 1024;

    ParseStatus consume(const QByteArray &incoming);
    const HttpRequest &request() const { return req_; }
    int bytesConsumed() const { return consumed_; }
    void reset();

private:
    QByteArray buf_;
    HttpRequest req_;
    int consumed_ = 0;
    int contentLength_ = -1;
    bool headersDone_ = false;
};
}
