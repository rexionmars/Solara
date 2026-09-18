//go:build !windows

package sidecar

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// python is the interpreter the tests run the sidecar under. It needs only the
// standard library.
func python(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"python3.12", "python3"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	t.Skip("no python3 on PATH")
	return ""
}

// fakeApp writes sidecar/main.py with the given body into a temporary
// application directory and points the runner at it.
func fakeApp(t *testing.T, body string) *Runner {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "sidecar"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sidecar", "main.py"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TERRA_ENERGY_APP_DIR", dir)
	t.Setenv("TERRA_ENERGY_PYTHON", python(t))
	r, err := NewRunner()
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestProbe_RealSidecar_ReportsVersion(t *testing.T) {
	repo, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("TERRA_ENERGY_APP_DIR", repo)
	t.Setenv("TERRA_ENERGY_PYTHON", python(t))
	r, err := NewRunner()
	if err != nil {
		t.Fatal(err)
	}

	raw, err := r.Probe(context.Background())
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if !strings.Contains(string(raw), `"ok": true`) {
		t.Fatalf("unexpected reply %s", raw)
	}
}

func TestRun_UnknownAction_ReturnsSidecarError(t *testing.T) {
	repo, _ := filepath.Abs(filepath.Join("..", ".."))
	t.Setenv("TERRA_ENERGY_APP_DIR", repo)
	t.Setenv("TERRA_ENERGY_PYTHON", python(t))
	r, err := NewRunner()
	if err != nil {
		t.Fatal(err)
	}

	_, err = r.Run(context.Background(), map[string]any{"action": "no_such_action"}, nil)
	if err == nil || !strings.Contains(err.Error(), "unknown action") {
		t.Fatalf("want the sidecar's own error, got %v", err)
	}
}

func TestRun_Progress_RelayedInOrder(t *testing.T) {
	r := fakeApp(t, `
import json, sys
for p in (10, 50, 90):
    sys.stderr.write(json.dumps({"progress": p, "msg": "step"}) + "\n")
print(json.dumps({"done": True}))
`)
	var seen []int
	raw, err := r.Run(context.Background(), map[string]any{}, func(p Progress) {
		seen = append(seen, p.Progress)
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(raw)); got != `{"done": true}` {
		t.Fatalf("result %s", got)
	}
	if len(seen) != 3 || seen[0] != 10 || seen[2] != 90 {
		t.Fatalf("progress %v", seen)
	}
}

// The defect this runner exists to avoid: cancelling must end the processes
// the interpreter started, not only the interpreter.
func TestCancel_KillsDescendants(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	r := fakeApp(t, `
import json, subprocess, sys, time
child = subprocess.Popen(["sleep", "60"])
open(`+strconv.Quote(pidFile)+`, "w").write(str(child.pid))
sys.stderr.write(json.dumps({"progress": 1, "msg": "started"}) + "\n")
time.sleep(60)
`)

	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), map[string]any{}, func(Progress) {
			select {
			case <-started:
			default:
				close(started)
			}
		})
		done <- err
	}()

	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("sidecar never reported progress")
	}

	if _, err := r.Run(context.Background(), map[string]any{}, nil); !errors.Is(err, ErrBusy) {
		t.Fatalf("second Run: want ErrBusy, got %v", err)
	}

	if !r.Cancel() {
		t.Fatal("Cancel reported no running request")
	}
	select {
	case err := <-done:
		if !errors.Is(err, ErrCanceled) {
			t.Fatalf("want ErrCanceled, got %v", err)
		}
	case <-time.After(waitDelay + 5*time.Second):
		t.Fatal("Run did not return after Cancel")
	}

	b, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		t.Fatal(err)
	}
	// Signal 0 checks existence without delivering anything. The killed child
	// is orphaned with its parent and reaped by init, after which it is gone;
	// the deadline covers the interval before the reap.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if err := syscall.Kill(pid, 0); errors.Is(err, syscall.ESRCH) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("descendant %d still alive after Cancel", pid)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
