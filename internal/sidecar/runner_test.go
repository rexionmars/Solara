//go:build !windows

package sidecar

import (
	"context"
	"encoding/json"
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

// A sidecar that serves pid, error, die and sleep, and answers a one-shot
// request with {"cold": true}, so a test can tell which path answered.
const servingApp = `
import json, os, sys, time
if sys.argv[1:] == ['--serve']:
    for line in sys.stdin:
        action = json.loads(line)['action']
        if action == 'die':
            os._exit(3)
        if action == 'sleep':
            time.sleep(30)
        answer = {'result': {'pid': os.getpid()}} if action == 'pid' else {'error': 'unknown action: ' + action}
        print(json.dumps(answer), flush=True)
else:
    json.load(sys.stdin)
    print(json.dumps({'cold': True}))
`

func pidOf(t *testing.T, r *Runner, ctx context.Context) int {
	t.Helper()
	raw, err := r.Read(ctx, map[string]any{"action": "pid"})
	if err != nil {
		t.Fatal(err)
	}
	var got struct{ Pid int }
	if err := json.Unmarshal(raw, &got); err != nil || got.Pid == 0 {
		t.Fatalf("not a served answer: %s", raw)
	}
	return got.Pid
}

func TestRead_ReusesWarmInterpreter(t *testing.T) {
	r := fakeApp(t, servingApp)
	t.Cleanup(r.Close)
	first := pidOf(t, r, context.Background())
	if again := pidOf(t, r, context.Background()); again != first {
		t.Fatalf("second read started another interpreter: %d then %d", first, again)
	}
	if _, err := r.Read(context.Background(), map[string]any{"action": "nope"}); err == nil || err.Error() != "unknown action: nope" {
		t.Fatalf("want the served error as it was written, got %v", err)
	}
	if after := pidOf(t, r, context.Background()); after != first {
		t.Fatal("an error answer cost the worker")
	}
}

func TestRead_DeadWorkerFallsBackToOneShot(t *testing.T) {
	r := fakeApp(t, servingApp)
	t.Cleanup(r.Close)
	first := pidOf(t, r, context.Background())
	raw, err := r.Read(context.Background(), map[string]any{"action": "die"})
	if err != nil || !strings.Contains(string(raw), `"cold": true`) {
		t.Fatalf("want the one-shot answer after the worker died, got %s, %v", raw, err)
	}
	if next := pidOf(t, r, context.Background()); next == first {
		t.Fatal("a dead worker was reused")
	}
}

func TestRead_TimeoutKillsTheWorker(t *testing.T) {
	r := fakeApp(t, servingApp)
	t.Cleanup(r.Close)
	first := pidOf(t, r, context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	if _, err := r.Read(ctx, map[string]any{"action": "sleep"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want the deadline, got %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for syscall.Kill(first, 0) == nil {
		if time.Now().After(deadline) {
			t.Fatal("the timed-out worker is still running")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if next := pidOf(t, r, context.Background()); next == first {
		t.Fatal("a killed worker was reused")
	}
}

func TestClose_EndsIdleWorkers(t *testing.T) {
	r := fakeApp(t, servingApp)
	pid := pidOf(t, r, context.Background())
	r.Close()
	deadline := time.Now().Add(5 * time.Second)
	for syscall.Kill(pid, 0) == nil {
		if time.Now().After(deadline) {
			t.Fatal("an idle worker outlived Close")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRead_RealSidecarServes(t *testing.T) {
	repo, _ := filepath.Abs(filepath.Join("..", ".."))
	t.Setenv("TERRA_ENERGY_APP_DIR", repo)
	t.Setenv("TERRA_ENERGY_PYTHON", python(t))
	r, err := NewRunner()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	for range 2 {
		raw, err := r.Read(context.Background(), map[string]any{"action": "ping"})
		if err != nil || !strings.Contains(string(raw), `"ok": true`) {
			t.Fatalf("want the ping answer, got %s, %v", raw, err)
		}
	}
	if _, err := r.Read(context.Background(), map[string]any{"action": "no_such_action"}); err == nil || !strings.Contains(err.Error(), "unknown action") {
		t.Fatalf("want the sidecar's own error, got %v", err)
	}
}
