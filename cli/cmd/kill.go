package cmd

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
)

// errNotRunning is a sentinel returned when the lock file is absent.
// The root command runner translates this to exit code 1.
var errNotRunning = errors.New("wal-qt-host is not running")

var killCmd = &cobra.Command{
	Use:   "kill",
	Short: "Send SIGTERM to wal-qt-host",
	Long: `Reads $XDG_RUNTIME_DIR/wal-qt-host.lock, parses the PID, and sends SIGTERM.
Exits with code 1 if the lock file is missing or the PID is invalid.`,
	SilenceErrors: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		err := runKill()
		if err != nil {
			if errors.Is(err, errNotRunning) {
				fmt.Fprintln(os.Stderr, err.Error())
				os.Exit(1)
			}
			return err
		}
		return nil
	},
}

// runKill is the testable core: returns errNotRunning when the lock file is
// absent, a descriptive error for bad input, or nil on success.
func runKill() error {
	xdg := os.Getenv("XDG_RUNTIME_DIR")
	if xdg == "" {
		return fmt.Errorf("XDG_RUNTIME_DIR is not set")
	}

	lockPath := xdg + "/wal-qt-host.lock"
	data, err := os.ReadFile(lockPath)
	if err != nil {
		if os.IsNotExist(err) {
			return errNotRunning
		}
		return fmt.Errorf("reading lock file: %w", err)
	}

	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil || pid <= 0 {
		return fmt.Errorf("malformed PID in lock file %q: %q", lockPath, pidStr)
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("finding process %d: %w", pid, err)
	}

	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return fmt.Errorf("sending SIGTERM to pid %d: %w", pid, err)
	}

	fmt.Fprintf(os.Stdout, "sent SIGTERM to wal-qt-host (pid %d)\n", pid)
	return nil
}

func init() {
	rootCmd.AddCommand(killCmd)
}
