package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/0bCdian/wal-qt/cli/internal/client"
	"github.com/0bCdian/wal-qt/cli/internal/transport"
	"github.com/spf13/cobra"
)

var loadWait bool

var loadCmd = &cobra.Command{
	Use:   "load <manifest.json>",
	Short: "Load a wallpaper from a manifest file",
	Long: `POST /wallpaper/load — reads a LoadRequest JSON file (or - for stdin)
and sends it to wal-qt-host. Use --wait to block until the renderer
acknowledges the transition (up to 30 s).`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		sock, err := resolveSocket()
		if err != nil {
			return err
		}

		// Read manifest.
		data, err := readFileOrStdin(args[0])
		if err != nil {
			return err
		}

		var req client.LoadWallpaperJSONRequestBody
		if err := json.Unmarshal(data, &req); err != nil {
			return fmt.Errorf("invalid manifest JSON: %w", err)
		}

		// Apply --wait flag.
		if loadWait {
			t := true
			req.WaitForCompletion = &t
		}

		c, err := client.NewClientWithResponses("http://unix", client.WithHTTPClient(transport.NewClient(sock)))
		if err != nil {
			return fmt.Errorf("creating client: %w", err)
		}

		resp, err := c.LoadWallpaperWithResponse(context.Background(), req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}

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
	},
}

func init() {
	loadCmd.Flags().BoolVar(&loadWait, "wait", false, "Block until the renderer acknowledges the transition (sets wait_for_completion: true)")
	rootCmd.AddCommand(loadCmd)
}

// readFileOrStdin reads the file at path, or stdin when path is "-".
func readFileOrStdin(path string) ([]byte, error) {
	if path == "-" {
		return io.ReadAll(os.Stdin)
	}
	return os.ReadFile(path)
}
