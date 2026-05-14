package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/0bCdian/wal-qt/cli/internal/client"
	"github.com/0bCdian/wal-qt/cli/internal/transport"
	"github.com/spf13/cobra"
)

var statusJSON bool

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show current wallpaper status for all monitors",
	Long:  `GET /wallpaper/status — returns full topology and per-monitor wallpaper state.`,
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

		enc := json.NewEncoder(os.Stdout)
		if !statusJSON {
			enc.SetIndent("", "  ")
		}
		return enc.Encode(resp.JSON200)
	},
}

func init() {
	statusCmd.Flags().BoolVar(&statusJSON, "json", false, "Output raw JSON (no indentation)")
	rootCmd.AddCommand(statusCmd)
}
