#include "http_parser.h"
#include <QList>

namespace walqt {

ParseStatus HttpParser::consume(const QByteArray &incoming)
{
    buf_.append(incoming);

    if (!headersDone_) {
        // Check for TooLarge before finding the separator
        int sepIdx = buf_.indexOf("\r\n\r\n");
        if (sepIdx < 0) {
            if (buf_.size() > kMaxHeaderBytes) {
                return ParseStatus::TooLarge;
            }
            return ParseStatus::NeedMore;
        }

        // We have found the end of headers
        int headerBytes = sepIdx + 4; // includes the \r\n\r\n
        QByteArray headerSection = buf_.left(sepIdx);

        // Split header section into lines
        QList<QByteArray> lines = headerSection.split('\n');

        // Clean up carriage returns
        for (auto &line : lines) {
            if (line.endsWith('\r')) {
                line.chop(1);
            }
        }

        if (lines.isEmpty()) {
            return ParseStatus::BadRequest;
        }

        // Parse request line
        QByteArray requestLine = lines[0];
        QList<QByteArray> parts = requestLine.split(' ');
        if (parts.size() != 3) {
            return ParseStatus::BadRequest;
        }
        if (!parts[2].startsWith("HTTP/")) {
            return ParseStatus::BadRequest;
        }

        req_.method = QString::fromLatin1(parts[0]);
        req_.path   = QString::fromUtf8(parts[1]);

        // Parse header lines (skip request line)
        contentLength_ = 0; // default to 0 if no Content-Length header
        for (int i = 1; i < lines.size(); ++i) {
            const QByteArray &line = lines[i];
            if (line.isEmpty()) continue;

            int colonIdx = line.indexOf(':');
            if (colonIdx < 0) continue;

            QByteArray name  = line.left(colonIdx).trimmed().toLower();
            QByteArray value = line.mid(colonIdx + 1).trimmed();

            if (name == "content-length") {
                bool ok = false;
                long n = value.toLong(&ok);
                if (!ok || n < 0) {
                    return ParseStatus::BadRequest;
                }
                if (n > kMaxBodyBytes) {
                    return ParseStatus::TooLarge;
                }
                contentLength_ = static_cast<int>(n);
            }
        }

        // Remove headers (including \r\n\r\n) from buf_, leaving only body data
        buf_ = buf_.mid(headerBytes);
        headersDone_ = true;

        // Store header byte count for consumed_ calculation
        consumed_ = headerBytes;
    }

    // Check if we have enough body bytes
    if (buf_.size() < contentLength_) {
        return ParseStatus::NeedMore;
    }

    req_.body   = buf_.left(contentLength_);
    consumed_  += contentLength_;
    return ParseStatus::Done;
}

void HttpParser::reset()
{
    buf_.clear();
    req_ = HttpRequest{};
    consumed_ = 0;
    contentLength_ = -1;
    headersDone_ = false;
}

} // namespace walqt
