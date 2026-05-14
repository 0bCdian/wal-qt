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

var parallaxCmd = &cobra.Command{
	Use:   "parallax <body.json>",
	Short: "Configure parallax effect on one or all monitors",
	Long:  `POST /wallpaper/parallax — reads a ParallaxRequest JSON file (or - for stdin).`,
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		sock, err := resolveSocket()
		if err != nil {
			return err
		}

		data, err := readFileOrStdin(args[0])
		if err != nil {
			return err
		}

		var req client.SetParallaxJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.SetParallaxWithResponse(context.Background(), req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}

		if resp.StatusCode() != 200 {
			if resp.JSON400 != nil {
				return fmt.Errorf("error %d: %s", resp.StatusCode(), resp.JSON400.Error)
			}
			return fmt.Errorf("unexpected status %d", resp.StatusCode())
		}

		fmt.Fprintln(os.Stdout, "ok")
		return nil
	},
}

func init() {
	rootCmd.AddCommand(parallaxCmd)
}
