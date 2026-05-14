package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/0bCdian/wal-qt/cli/internal/client"
)

// unixTestServer starts a minimal HTTP server on a temp Unix socket and
// returns the socket path and a channel that receives the decoded LoadRequest
// bodies as they arrive.
func unixTestServer(t *testing.T, statusCode int) (sockPath string, bodies <-chan client.LoadRequest) {
	t.Helper()
	sock := filepath.Join(t.TempDir(), "test.sock")

	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatalf("listen unix: %v", err)
	}

	ch := make(chan client.LoadRequest, 8)

	mux := http.NewServeMux()
	mux.HandleFunc("/wallpaper/load", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req client.LoadRequest
		_ = json.Unmarshal(body, &req)
		ch <- req

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		switch statusCode {
		case 200:
			fmt.Fprintln(w, `{"ok":true}`)
		case 202:
			fmt.Fprintln(w, `{"ok":true,"accepted":true}`)
		default:
			fmt.Fprintln(w, `{"error":"test error"}`)
		}
	})

	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		srv.Close()
		ln.Close()
	})

	return sock, ch
}

func TestLoadFromFile(t *testing.T) {
	sock, bodies := unixTestServer(t, 202)

	// Write a manifest file.
	manifest := `{"target":"/home/user/wall.jpg","kind":"image"}`
	f, err := os.CreateTemp(t.TempDir(), "manifest*.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(manifest); err != nil {
		t.Fatal(err)
	}
	f.Close()

	// Run the load command.
	socketPath = sock
	loadWait = false
	err = loadCmd.RunE(loadCmd, []string{f.Name()})
	if err != nil {
		t.Fatalf("load command failed: %v", err)
	}

	req := <-bodies
	if req.Target == nil || *req.Target != "/home/user/wall.jpg" {
		t.Errorf("unexpected target: %v", req.Target)
	}
}

func TestLoadFromStdin(t *testing.T) {
	sock, bodies := unixTestServer(t, 202)

	manifest := `{"target":"/home/user/stdin.jpg","kind":"image"}`

	// Redirect stdin.
	r, w, _ := os.Pipe()
	old := os.Stdin
	os.Stdin = r
	defer func() { os.Stdin = old }()

	go func() {
		io.WriteString(w, manifest)
		w.Close()
	}()

	socketPath = sock
	loadWait = false
	err := loadCmd.RunE(loadCmd, []string{"-"})
	if err != nil {
		t.Fatalf("load command (stdin) failed: %v", err)
	}

	req := <-bodies
	if req.Target == nil || *req.Target != "/home/user/stdin.jpg" {
		t.Errorf("unexpected target: %v", req.Target)
	}
}

func TestLoadWaitFlag(t *testing.T) {
	sock, bodies := unixTestServer(t, 200)

	manifest := `{"target":"/home/user/wall.jpg"}`
	f, err := os.CreateTemp(t.TempDir(), "manifest*.json")
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(manifest)
	f.Close()

	socketPath = sock
	loadWait = true
	defer func() { loadWait = false }()

	err = loadCmd.RunE(loadCmd, []string{f.Name()})
	if err != nil {
		t.Fatalf("load --wait failed: %v", err)
	}

	req := <-bodies
	if req.WaitForCompletion == nil || !*req.WaitForCompletion {
		t.Errorf("expected wait_for_completion=true, got %v", req.WaitForCompletion)
	}
}

func TestLoadNoWaitFlag(t *testing.T) {
	sock, bodies := unixTestServer(t, 202)

	manifest := `{"target":"/home/user/wall.jpg"}`
	f, err := os.CreateTemp(t.TempDir(), "manifest*.json")
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(manifest)
	f.Close()

	socketPath = sock
	loadWait = false

	err = loadCmd.RunE(loadCmd, []string{f.Name()})
	if err != nil {
		t.Fatalf("load (no wait) failed: %v", err)
	}

	req := <-bodies
	// When --wait is not set, we do not override whatever was in the file.
	// The manifest above has no wait_for_completion, so it should be nil.
	if req.WaitForCompletion != nil && *req.WaitForCompletion {
		t.Errorf("expected wait_for_completion to be nil/false, got %v", req.WaitForCompletion)
	}
}

func TestLoadInvalidJSON(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "bad*.json")
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("not json")
	f.Close()

	socketPath = "/tmp/unused.sock"
	err = loadCmd.RunE(loadCmd, []string{f.Name()})
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
	if !strings.Contains(err.Error(), "invalid manifest JSON") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestLoadMissingFile(t *testing.T) {
	socketPath = "/tmp/unused.sock"
	err := loadCmd.RunE(loadCmd, []string{"/nonexistent/manifest.json"})
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}
