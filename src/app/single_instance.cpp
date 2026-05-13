#include "app/single_instance.h"
#include "util/socket_path.h"

bool walqt::SingleInstance::acquire()
{
    lock_ = std::make_unique<QLockFile>(walqt::lockPath());
    // QLockFile stale-lock heuristics: if the PID inside the lock is gone (crash, SIGKILL, OOM),
    // tryLock can take the lock after staleLockTime. With 0, Qt never treats a lock as stale and
    // orphan $XDG_RUNTIME_DIR/wal-qt.lock blocks every new start forever.
    lock_->setStaleLockTime(30'000);
    return lock_->tryLock(250);
}
