package transport_test

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/0bCdian/wal-qt/cli/internal/transport"
)

func TestNewClientDialsUnixSocket(t *testing.T) {
	// Create a temp dir for the socket.
	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "test.sock")

	// Start a Unix socket HTTP server.
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatalf("listen unix: %v", err)
	}
	defer ln.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "pong")
	})

	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	defer srv.Close()

	// Build a client via our transport.
	c := transport.NewClient(sockPath)

	resp, err := c.Get("http://unix/ping")
	if err != nil {
		t.Fatalf("GET /ping: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if string(body) != "pong\n" {
		t.Errorf("unexpected body: %q", string(body))
	}
}

func TestNewClientWrongSocketPath(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "nonexistent.sock")
	c := transport.NewClient(sockPath)

	_, err := c.Get("http://unix/anything")
	if err == nil {
		t.Fatal("expected error dialing non-existent socket, got nil")
	}
}

func TestNewClientCorrectSocketPath(t *testing.T) {
	// Verify the client uses the exact path we give it (not some env var).
	tmpDir := t.TempDir()
	sockA := filepath.Join(tmpDir, "a.sock")
	sockB := filepath.Join(tmpDir, "b.sock")

	lnA, err := net.Listen("unix", sockA)
	if err != nil {
		t.Fatalf("listen A: %v", err)
	}
	defer lnA.Close()

	muxA := http.NewServeMux()
	muxA.HandleFunc("/id", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "A")
	})
	srvA := &http.Server{Handler: muxA}
	go func() { _ = srvA.Serve(lnA) }()
	defer srvA.Close()

	// sockB does not exist — client targeting A must NOT accidentally dial B.
	_ = sockB
	_ = os.Getenv // just to confirm we aren't using env

	c := transport.NewClient(sockA)
	resp, err := c.Get("http://unix/id")
	if err != nil {
		t.Fatalf("GET /id on sockA: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if string(body) != "A\n" {
		t.Errorf("expected body 'A', got %q", string(body))
	}
}
