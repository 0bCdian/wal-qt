#include "app/single_instance.h"
#include "util/socket_path.h"
bool walqt::SingleInstance::acquire() {
    lock_ = std::make_unique<QLockFile>(walqt::lockPath());
    lock_->setStaleLockTime(0);
    return lock_->tryLock(100);
}
