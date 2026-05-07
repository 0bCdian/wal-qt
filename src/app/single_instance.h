#pragma once
#include <QLockFile>
#include <memory>
namespace walqt {
class SingleInstance {
public:
    bool acquire();   // false if another instance holds the lock
private:
    std::unique_ptr<QLockFile> lock_;
};
}
