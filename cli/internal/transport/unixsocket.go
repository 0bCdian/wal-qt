package transport

import (
	"context"
	"net"
	"net/http"
)

// NewClient returns an *http.Client that dials a Unix domain socket at socketPath.
// Use "http://unix" as the base URL when constructing the generated API client.
func NewClient(socketPath string) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, "unix", socketPath)
			},
		},
	}
}
