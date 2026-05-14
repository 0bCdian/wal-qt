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

var settingsCmd = &cobra.Command{
	Use:   "settings",
	Short: "Manage global wal-qt-host settings",
}

var settingsNetworkCmd = &cobra.Command{
	Use:   "network <body.json>",
	Short: "Set global network permission for wallpapers",
	Long:  `POST /settings/network — reads a NetworkSettingsRequest JSON (or - for stdin).`,
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

		var req client.SetNetworkSettingsJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.SetNetworkSettingsWithResponse(context.Background(), req)
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

var settingsImagePresentationCmd = &cobra.Command{
	Use:   "image-presentation <body.json>",
	Short: "Set image fit mode and rendering quality",
	Long:  `POST /settings/image-presentation — reads an ImagePresentationRequest JSON (or - for stdin).`,
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

		var req client.SetImagePresentationJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.SetImagePresentationWithResponse(context.Background(), req)
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
	settingsCmd.AddCommand(settingsNetworkCmd)
	settingsCmd.AddCommand(settingsImagePresentationCmd)
	rootCmd.AddCommand(settingsCmd)
}
