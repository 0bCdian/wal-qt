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

var wallpaperCmd = &cobra.Command{
	Use:   "wallpaper",
	Short: "Send config, capabilities, and playback updates to a running wallpaper",
}

var wallpaperConfigCmd = &cobra.Command{
	Use:   "config <body.json>",
	Short: "Push config values to a running wallpaper",
	Long:  `POST /wallpaper/config — reads a WallpaperConfigRequest JSON (or - for stdin).`,
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

		var req client.PushWallpaperConfigJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.PushWallpaperConfigWithResponse(context.Background(), req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}

		if resp.StatusCode() != 200 {
			if resp.JSON400 != nil {
				return fmt.Errorf("error %d: %s", resp.StatusCode(), resp.JSON400.Error)
			}
			return fmt.Errorf("unexpected status %d", resp.StatusCode())
		}

		applied := 0
		if resp.JSON200 != nil {
			applied = resp.JSON200.Applied
		}
		fmt.Fprintf(os.Stdout, "ok (applied to %d monitors)\n", applied)
		return nil
	},
}

var wallpaperCapabilitiesCmd = &cobra.Command{
	Use:   "capabilities <body.json>",
	Short: "Push runtime capability overrides to a running wallpaper",
	Long:  `POST /wallpaper/capabilities — reads a CapabilitiesRequest JSON (or - for stdin).`,
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

		var req client.PushCapabilitiesJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.PushCapabilitiesWithResponse(context.Background(), req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}

		if resp.StatusCode() != 200 {
			if resp.JSON400 != nil {
				return fmt.Errorf("error %d: %s", resp.StatusCode(), resp.JSON400.Error)
			}
			return fmt.Errorf("unexpected status %d", resp.StatusCode())
		}

		applied := 0
		if resp.JSON200 != nil {
			applied = resp.JSON200.Applied
		}
		fmt.Fprintf(os.Stdout, "ok (applied to %d monitors)\n", applied)
		return nil
	},
}

var wallpaperPlaybackCmd = &cobra.Command{
	Use:   "playback <body.json>",
	Short: "Set playback policy for a running wallpaper",
	Long:  `POST /wallpaper/playback — reads a PlaybackRequest JSON (or - for stdin).`,
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

		var req client.SetPlaybackPolicyJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.SetPlaybackPolicyWithResponse(context.Background(), req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}

		if resp.StatusCode() != 200 {
			if resp.JSON400 != nil {
				return fmt.Errorf("error %d: %s", resp.StatusCode(), resp.JSON400.Error)
			}
			return fmt.Errorf("unexpected status %d", resp.StatusCode())
		}

		applied := 0
		if resp.JSON200 != nil {
			applied = resp.JSON200.Applied
		}
		fmt.Fprintf(os.Stdout, "ok (applied to %d monitors)\n", applied)
		return nil
	},
}

func init() {
	wallpaperCmd.AddCommand(wallpaperConfigCmd)
	wallpaperCmd.AddCommand(wallpaperCapabilitiesCmd)
	wallpaperCmd.AddCommand(wallpaperPlaybackCmd)
	rootCmd.AddCommand(wallpaperCmd)
}
