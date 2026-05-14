package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/0bCdian/wal-qt/cli/internal/client"
	"github.com/0bCdian/wal-qt/cli/internal/transport"
	"github.com/spf13/cobra"
)

var healthCmd = &cobra.Command{
	Use:   "health",
	Short: "Check if wal-qt-host is alive",
	Long:  `GET /health — returns service name and API version.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		sock, err := resolveSocket()
		if err != nil {
			return err
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.GetHealthWithResponse(context.Background())
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}

		if resp.StatusCode() != 200 {
			if resp.JSON400 != nil {
				return fmt.Errorf("error %d: %s", resp.StatusCode(), resp.JSON400.Error)
			}
			return fmt.Errorf("unexpected status %d", resp.StatusCode())
		}

		h := resp.JSON200
		fmt.Fprintf(os.Stdout, "status:      ok=%v\nservice:     %s\napi_version: %s\n", h.Ok, h.Service, h.ApiVersion)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(healthCmd)
}
