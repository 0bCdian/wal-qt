package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/0bCdian/wal-qt/cli/internal/client"
)

func TestKindForPath(t *testing.T) {
	cases := []struct {
		name    string
		path    string
		isDir   bool
		want    string
		wantErr bool
	}{
		{"jpg", "/a/b.jpg", false, "image", false},
		{"jpeg uppercase", "/a/b.JPEG", false, "image", false},
		{"png", "/a/b.png", false, "image", false},
		{"webp", "/a/b.webp", false, "image", false},
		{"gif", "/a/b.gif", false, "image", false},
		{"bmp", "/a/b.bmp", false, "image", false},
		{"avif", "/a/b.avif", false, "image", false},
		{"mp4", "/a/b.mp4", false, "video", false},
		{"mkv", "/a/b.mkv", false, "video", false},
		{"webm", "/a/b.webm", false, "video", false},
		{"mov uppercase", "/a/b.MOV", false, "video", false},
		{"avi", "/a/b.avi", false, "video", false},
		{"m4v", "/a/b.m4v", false, "video", false},
		{"directory is web", "/a/package", true, "web", false},
		{"unknown extension", "/a/notes.txt", false, "", true},
		{"no extension", "/a/wallpaper", false, "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := kindForPath(c.path, c.isDir)
			if c.wantErr {
				if err == nil {
					t.Fatalf("kindForPath(%q, %v): expected error, got kind %q", c.path, c.isDir, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("kindForPath(%q, %v): unexpected error: %v", c.path, c.isDir, err)
			}
			if got != c.want {
				t.Errorf("kindForPath(%q, %v) = %q, want %q", c.path, c.isDir, got, c.want)
			}
		})
	}
}

func TestBuildLoadRequestClone(t *testing.T) {
	req := buildLoadRequest("/abs/wall.png", "image", nil, "", false)

	if req.Target == nil || *req.Target != "/abs/wall.png" {
		t.Errorf("target = %v, want /abs/wall.png", req.Target)
	}
	if req.Kind == nil || *req.Kind != client.LoadRequestKindImage {
		t.Errorf("kind = %v, want image", req.Kind)
	}
	if req.Targets != nil {
		t.Errorf("expected nil targets[] for a clone request, got %v", req.Targets)
	}
	if req.Transition != nil {
		t.Errorf("expected nil transition, got %v", req.Transition)
	}
	if req.WaitForCompletion != nil {
		t.Errorf("expected nil wait_for_completion, got %v", req.WaitForCompletion)
	}
}

func TestBuildLoadRequestMonitors(t *testing.T) {
	req := buildLoadRequest("/abs/wall.mp4", "video", []string{"DP-1", "HDMI-A-1"}, "", false)

	if req.Targets == nil {
		t.Fatal("expected targets[] when monitors are given, got nil")
	}
	ts := *req.Targets
	if len(ts) != 2 {
		t.Fatalf("expected 2 targets, got %d", len(ts))
	}
	if ts[0].Name != "DP-1" || ts[0].Target != "/abs/wall.mp4" {
		t.Errorf("target[0] = %+v, want name DP-1 / path /abs/wall.mp4", ts[0])
	}
	if ts[0].Kind == nil || *ts[0].Kind != client.Video {
		t.Errorf("target[0].kind = %v, want video", ts[0].Kind)
	}
	if ts[1].Name != "HDMI-A-1" {
		t.Errorf("target[1].name = %q, want HDMI-A-1", ts[1].Name)
	}
	if req.Target != nil {
		t.Errorf("expected nil top-level target when monitors are given, got %v", req.Target)
	}
}

func TestBuildLoadRequestMonitorsTrimsWhitespaceAndEmpties(t *testing.T) {
	req := buildLoadRequest("/abs/wall.png", "image", []string{" DP-1 ", "", "  ", "DP-2"}, "", false)

	if req.Targets == nil {
		t.Fatal("expected targets[], got nil")
	}
	ts := *req.Targets
	if len(ts) != 2 {
		t.Fatalf("expected 2 targets after dropping empties, got %d: %+v", len(ts), ts)
	}
	if ts[0].Name != "DP-1" || ts[1].Name != "DP-2" {
		t.Errorf("names = %q,%q, want DP-1,DP-2 (trimmed)", ts[0].Name, ts[1].Name)
	}
}

func TestBuildLoadRequestTransitionAndWait(t *testing.T) {
	req := buildLoadRequest("/abs/w.png", "image", nil, "wipe", true)

	if req.Transition == nil || *req.Transition != client.LoadRequestTransitionWipe {
		t.Errorf("transition = %v, want wipe", req.Transition)
	}
	if req.WaitForCompletion == nil || !*req.WaitForCompletion {
		t.Errorf("wait_for_completion = %v, want true", req.WaitForCompletion)
	}
}

func TestSetCommandCloneImage(t *testing.T) {
	sock, bodies := unixTestServer(t, 202)

	img := filepath.Join(t.TempDir(), "wall.png")
	if err := os.WriteFile(img, []byte("not-a-real-png"), 0o644); err != nil {
		t.Fatal(err)
	}

	socketPath = sock
	setMonitors = nil
	setTransition = ""
	setWait = false

	if err := runSet(rootCmd, []string{img}); err != nil {
		t.Fatalf("set command failed: %v", err)
	}

	req := <-bodies
	if req.Target == nil || *req.Target != img {
		t.Errorf("target = %v, want %q", req.Target, img)
	}
	if req.Kind == nil || *req.Kind != client.LoadRequestKindImage {
		t.Errorf("kind = %v, want image", req.Kind)
	}
	if req.Targets != nil {
		t.Errorf("expected no targets[] for clone, got %v", req.Targets)
	}
}

func TestSetCommandMonitors(t *testing.T) {
	sock, bodies := unixTestServer(t, 202)

	img := filepath.Join(t.TempDir(), "wall.jpg")
	if err := os.WriteFile(img, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	socketPath = sock
	setMonitors = []string{"DP-1", "DP-2"}
	setTransition = ""
	setWait = false
	t.Cleanup(func() { setMonitors = nil })

	if err := runSet(rootCmd, []string{img}); err != nil {
		t.Fatalf("set command failed: %v", err)
	}

	req := <-bodies
	if req.Targets == nil || len(*req.Targets) != 2 {
		t.Fatalf("expected 2 targets[], got %v", req.Targets)
	}
}

func TestSetCommandWebDirectory(t *testing.T) {
	sock, bodies := unixTestServer(t, 202)

	dir := t.TempDir()

	socketPath = sock
	setMonitors = nil
	setTransition = ""
	setWait = false

	if err := runSet(rootCmd, []string{dir}); err != nil {
		t.Fatalf("set command failed: %v", err)
	}

	req := <-bodies
	if req.Kind == nil || *req.Kind != client.LoadRequestKindWeb {
		t.Errorf("kind = %v, want web", req.Kind)
	}
}

func TestSetCommandMissingPath(t *testing.T) {
	socketPath = "/tmp/unused.sock"
	err := runSet(rootCmd, []string{"/nonexistent/path/wall.png"})
	if err == nil {
		t.Fatal("expected an error for a missing path, got nil")
	}
}

func TestSetCommandUnknownExtension(t *testing.T) {
	f := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	socketPath = "/tmp/unused.sock"
	err := runSet(rootCmd, []string{f})
	if err == nil {
		t.Fatal("expected an error for an unrecognized extension, got nil")
	}
}
