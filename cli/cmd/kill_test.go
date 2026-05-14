package cmd

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// writeLock writes a lock file with the given content and returns the directory.
func writeLock(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "wal-qt-host.lock")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatalf("write lock: %v", err)
	}
	return dir
}

func TestKillLockFileMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_RUNTIME_DIR", tmpDir)

	// Lock file does not exist — should return errNotRunning sentinel.
	err := runKill()
	if !errors.Is(err, errNotRunning) {
		t.Fatalf("expected errNotRunning, got: %v", err)
	}
}

func TestKillLockFileMalformed(t *testing.T) {
	dir := writeLock(t, "not-a-pid\n")
	t.Setenv("XDG_RUNTIME_DIR", dir)

	err := runKill()
	if err == nil {
		t.Fatal("expected error for malformed PID, got nil")
	}
	if !strings.Contains(err.Error(), "malformed PID") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestKillLockFileZeroPID(t *testing.T) {
	dir := writeLock(t, "0\n")
	t.Setenv("XDG_RUNTIME_DIR", dir)

	err := runKill()
	if err == nil {
		t.Fatal("expected error for PID 0, got nil")
	}
	if !strings.Contains(err.Error(), "malformed PID") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestKillLockFileNegativePID(t *testing.T) {
	dir := writeLock(t, "-1\n")
	t.Setenv("XDG_RUNTIME_DIR", dir)

	err := runKill()
	if err == nil {
		t.Fatal("expected error for negative PID, got nil")
	}
	if !strings.Contains(err.Error(), "malformed PID") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestKillLockFileValidPID(t *testing.T) {
	// Use init (PID 1) or the parent PID — we just need a running process.
	// We spawn a short-lived process so we can send SIGTERM to it safely.
	// Use "sleep 60" and kill it ourselves; the runKill call beats us to it.
	proc, err := os.StartProcess("/bin/sleep", []string{"sleep", "60"}, &os.ProcAttr{})
	if err != nil {
		t.Skipf("cannot start sleep process: %v", err)
	}
	t.Cleanup(func() {
		// ensure the child is reaped even if the test fails before runKill.
		_ = proc.Kill()
		_, _ = proc.Wait()
	})

	dir := writeLock(t, fmt.Sprintf("%d\n", proc.Pid))
	t.Setenv("XDG_RUNTIME_DIR", dir)

	err = runKill()
	if err != nil {
		t.Fatalf("unexpected error sending SIGTERM to child process: %v", err)
	}

	// Reap the child so it doesn't become a zombie.
	_, _ = proc.Wait()
}

func TestKillLockFileLeadingTrailingWhitespace(t *testing.T) {
	proc, err := os.StartProcess("/bin/sleep", []string{"sleep", "60"}, &os.ProcAttr{})
	if err != nil {
		t.Skipf("cannot start sleep process: %v", err)
	}
	t.Cleanup(func() {
		_ = proc.Kill()
		_, _ = proc.Wait()
	})

	dir := writeLock(t, fmt.Sprintf("  %s  \n", strconv.Itoa(proc.Pid)))
	t.Setenv("XDG_RUNTIME_DIR", dir)

	// Should parse correctly regardless of whitespace.
	err = runKill()
	if err != nil {
		t.Fatalf("expected no error with whitespace-padded PID, got: %v", err)
	}

	_, _ = proc.Wait()
}
