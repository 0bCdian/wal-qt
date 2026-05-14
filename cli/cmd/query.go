package cmd

import (
	"context"
	"fmt"

	"github.com/0bCdian/wal-qt/cli/internal/client"
	"github.com/0bCdian/wal-qt/cli/internal/transport"
	"github.com/spf13/cobra"
)

var queryCmd = &cobra.Command{
	Use:   "query",
	Short: "List monitors and their current wallpapers",
	Long: `Derives the monitor list from GET /wallpaper/status and prints a
compact table: name, geometry (WxH+X+Y), and the current wallpaper target.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		sock, err := resolveSocket()
		if err != nil {
			return err
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.GetWallpaperStatusWithResponse(context.Background())
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}

		if resp.StatusCode() != 200 {
			if resp.JSON400 != nil {
				return fmt.Errorf("error %d: %s", resp.StatusCode(), resp.JSON400.Error)
			}
			return fmt.Errorf("unexpected status %d", resp.StatusCode())
		}

		status := resp.JSON200.Status

		// Build a name→geometry map for quick lookup.
		geom := make(map[string]string, len(status.Topology))
		for _, m := range status.Topology {
			geom[m.Name] = fmt.Sprintf("%dx%d+%d+%d", m.Width, m.Height, m.X, m.Y)
		}

		// Header.
		fmt.Printf("%-16s  %-20s  %s\n", "MONITOR", "GEOMETRY", "WALLPAPER")
		fmt.Printf("%-16s  %-20s  %s\n", "-------", "--------", "---------")

		for _, m := range status.Monitors {
			target := "(none)"
			if m.CurrentTarget != nil && *m.CurrentTarget != "" {
				target = *m.CurrentTarget
			}
			g := geom[m.Name]
			if g == "" {
				g = "(unknown)"
			}
			fmt.Printf("%-16s  %-20s  %s\n", m.Name, g, target)
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(queryCmd)
}
