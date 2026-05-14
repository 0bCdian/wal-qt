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

var parallaxMoveCmd = &cobra.Command{
	Use:   "parallax-move <body.json>",
	Short: "Nudge the parallax offset one step",
	Long:  `POST /wallpaper/parallax-move — reads a ParallaxMoveRequest JSON (or - for stdin).`,
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

		var req client.MoveParallaxJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.MoveParallaxWithResponse(context.Background(), req)
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
	rootCmd.AddCommand(parallaxMoveCmd)
}
