package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

const version = "0.1.0"

var socketPath string

var rootCmd = &cobra.Command{
	Use:   "wal-qt [path]",
	Short: "CLI client for the wal-qt Wayland wallpaper host",
	Long: `wal-qt is a CLI for controlling wal-qt-host over its Unix socket API.

Pass a path to set a wallpaper directly — kind is inferred from the file
extension (image/video) or from a directory (web package):

  wal-qt ~/Pictures/wall.jpg                 # clone to every monitor
  wal-qt ~/Videos/loop.mp4 --monitors DP-1   # one monitor
  wal-qt ~/wallpapers/clock --transition wipe

The host process exposes an HTTP control socket at $XDG_RUNTIME_DIR/wal-qt.sock.
Use --socket to override the path.`,
	Version: version,
}

// Execute runs the root command.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.SetVersionTemplate("wal-qt {{.Version}}\n")
	rootCmd.PersistentFlags().StringVar(
		&socketPath,
		"socket",
		"",
		`Unix socket path (default: $XDG_RUNTIME_DIR/wal-qt.sock)`,
	)
}

// resolveSocket returns the effective socket path, erroring if XDG_RUNTIME_DIR
// is unset and no explicit --socket flag was given.
func resolveSocket() (string, error) {
	if socketPath != "" {
		return socketPath, nil
	}
	xdg := os.Getenv("XDG_RUNTIME_DIR")
	if xdg == "" {
		return "", fmt.Errorf("XDG_RUNTIME_DIR is not set; use --socket to specify the wal-qt socket path")
	}
	return xdg + "/wal-qt.sock", nil
}
