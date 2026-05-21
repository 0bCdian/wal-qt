package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/0bCdian/wal-qt/cli/internal/client"
	"github.com/0bCdian/wal-qt/cli/internal/transport"
	"github.com/spf13/cobra"
)

var (
	setMonitors   []string
	setTransition string
	setWait       bool
)

// imageExtensions and videoExtensions classify a wallpaper file by its
// lower-cased extension. Kept as ordered slices so error messages are stable.
var (
	imageExtensions = []string{".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}
	videoExtensions = []string{".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"}
)

// kindForPath returns the wal-qt wallpaper kind for a path: "web" for a
// directory (a web package), or "image"/"video" for a file classified by
// extension. An unrecognized extension is an error.
func kindForPath(path string, isDir bool) (string, error) {
	if isDir {
		return "web", nil
	}
	ext := strings.ToLower(filepath.Ext(path))
	if slices.Contains(imageExtensions, ext) {
		return "image", nil
	}
	if slices.Contains(videoExtensions, ext) {
		return "video", nil
	}
	return "", fmt.Errorf(
		"unrecognized wallpaper %q: expected an image (%s), a video (%s), or a directory (web package)",
		filepath.Base(path),
		strings.Join(imageExtensions, " "),
		strings.Join(videoExtensions, " "))
}

// buildLoadRequest assembles a LoadRequest for a single wallpaper path. With no
// monitors it sets the top-level target/kind, which the host clones to every
// monitor. With monitors it builds a per-monitor targets[] list so only those
// outputs are affected.
func buildLoadRequest(absPath, kind string, monitors []string, transition string, wait bool) client.LoadWallpaperJSONRequestBody {
	var req client.LoadWallpaperJSONRequestBody

	names := make([]string, 0, len(monitors))
	for _, m := range monitors {
		if m = strings.TrimSpace(m); m != "" {
			names = append(names, m)
		}
	}

	if len(names) == 0 {
		lrKind := client.LoadRequestKind(kind)
		req.Target = &absPath
		req.Kind = &lrKind
	} else {
		targets := make([]client.WallpaperTarget, 0, len(names))
		for _, n := range names {
			k := client.WallpaperTargetKind(kind)
			targets = append(targets, client.WallpaperTarget{
				Name:   n,
				Target: absPath,
				Kind:   &k,
			})
		}
		req.Targets = &targets
	}

	if transition != "" {
		tr := client.LoadRequestTransition(transition)
		req.Transition = &tr
	}
	if wait {
		w := true
		req.WaitForCompletion = &w
	}
	return req
}

// reportLoadResponse maps a /wallpaper/load response to CLI output / an error.
func reportLoadResponse(resp *client.LoadWallpaperResponse) error {
	switch resp.StatusCode() {
	case 200:
		fmt.Fprintln(os.Stdout, "ok (completed)")
	case 202:
		fmt.Fprintln(os.Stdout, "accepted")
	case 400:
		if resp.JSON400 != nil {
			return fmt.Errorf("error 400: %s", resp.JSON400.Error)
		}
		return fmt.Errorf("error 400: bad request")
	case 404:
		if resp.JSON404 != nil {
			return fmt.Errorf("error 404: %s", resp.JSON404.Error)
		}
		return fmt.Errorf("error 404: no matching monitors")
	case 504:
		if resp.JSON504 != nil {
			return fmt.Errorf("error 504: %s", resp.JSON504.Error)
		}
		return fmt.Errorf("error 504: wait-for-completion timed out")
	default:
		return fmt.Errorf("unexpected status %d", resp.StatusCode())
	}
	return nil
}

// runSet is the root command action: `wal-qt <path>` sets a wallpaper directly.
func runSet(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return cmd.Help()
	}
	path := args[0]

	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("cannot read wallpaper path %q: %w", path, err)
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolving absolute path for %q: %w", path, err)
	}
	kind, err := kindForPath(absPath, info.IsDir())
	if err != nil {
		return err
	}

	sock, err := resolveSocket()
	if err != nil {
		return err
	}

	req := buildLoadRequest(absPath, kind, setMonitors, setTransition, setWait)

	c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
	if err != nil {
		return fmt.Errorf("creating client: %w", err)
	}
	resp, err := c.LoadWallpaperWithResponse(context.Background(), req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	return reportLoadResponse(resp)
}

func init() {
	rootCmd.Args = cobra.MaximumNArgs(1)
	rootCmd.RunE = runSet
	rootCmd.Flags().StringSliceVar(&setMonitors, "monitors", nil,
		"Comma-separated Wayland output names to target (default: all monitors)")
	rootCmd.Flags().StringVar(&setTransition, "transition", "",
		"Transition effect (fade, wipe, grow, …); forwarded to the renderer")
	rootCmd.Flags().BoolVar(&setWait, "wait", false,
		"Block until the renderer acknowledges the transition")
}
