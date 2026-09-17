/*
Package sidecar runs the Python side of the application.

Each request starts one interpreter. The request is written to its stdin as a
JSON object, progress arrives on stderr as one JSON object per line, and the
result is read from stdout as a single JSON object. A failure is a JSON
{"error": ...} line on stderr and a non-zero exit status. The contract is the
one TERRA uses, so an action can move between the two programs unchanged.

Three properties differ from TERRA's runner, each answering a defect found
there: a request can be cancelled, and the cancel reaches every process the
interpreter started (see configureProcess); only one request runs at a time, so
a progress line always belongs to the request the interface is waiting on; and
the result read from stdout is bounded.
*/
package sidecar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	// Bound on Wait once the interpreter has exited or been killed and only
	// its pipes remain open, held by a descendant that inherited them. Without
	// it Wait blocks until that descendant exits.
	waitDelay = 5 * time.Second

	// Largest result accepted on stdout. Rasters and meshes belong in files
	// named by the result, not inside it.
	maxResultBytes = 16 << 20

	// Longest stderr line kept whole. A longer line is split at this length.
	maxLineBytes = 1 << 20
)

var (
	// ErrBusy is returned by Run while another request is running.
	ErrBusy = errors.New("another request is already running")

	// ErrCanceled is returned by Run when Cancel stopped the request.
	ErrCanceled = errors.New("the request was cancelled")
)

// Progress is one progress line from the sidecar.
type Progress struct {
	// 0 to 100, or -1 when the line carries only a message.
	Progress int    `json:"progress"`
	Msg      string `json:"msg"`
}

// Runner starts the sidecar and holds the request in progress, if any.
type Runner struct {
	python string
	script string

	mu     sync.Mutex
	cancel context.CancelFunc // non-nil while Run is executing
}

// NewRunner locates the sidecar and the interpreter that will run it.
func NewRunner() (*Runner, error) {
	dir, err := resolveAppDir()
	if err != nil {
		return nil, err
	}
	return &Runner{
		python: resolvePython(dir),
		script: filepath.Join(dir, "sidecar", "main.py"),
	}, nil
}

// Python is the interpreter requests run under.
func (r *Runner) Python() string {
	return r.python
}

// Run executes one request and returns the raw JSON result. Only one Run
// executes at a time; a second call returns ErrBusy rather than waiting, so
// the caller can tell the user instead of queueing work they cannot see.
func (r *Runner) Run(ctx context.Context, req any, onProgress func(Progress)) (json.RawMessage, error) {
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	r.mu.Lock()
	if r.cancel != nil {
		r.mu.Unlock()
		return nil, ErrBusy
	}
	r.cancel = cancel
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.cancel = nil
		r.mu.Unlock()
	}()

	out, err := r.execute(runCtx, req, onProgress)
	if err != nil && runCtx.Err() != nil && ctx.Err() == nil {
		return nil, ErrCanceled
	}
	return out, err
}

// Cancel stops the request Run is executing and reports whether there was one.
func (r *Runner) Cancel() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel == nil {
		return false
	}
	r.cancel()
	return true
}

// Probe runs the ping action. It is exempt from the one-request rule because
// it is a health check that finishes in about a second and emits no progress,
// so it cannot be confused with the request the interface is following.
func (r *Runner) Probe(ctx context.Context) (json.RawMessage, error) {
	return r.execute(ctx, map[string]any{"action": "ping"}, nil)
}

// Query runs an action that answers from constants, such as
// parameter_defaults, and returns its raw result. It is exempt from the
// one-request rule for the reason Probe is: it reads no data, finishes in the
// time the interpreter takes to start, and emits no progress, so it can run
// beside an analysis without a progress line being taken for its own. Held to
// the one-request rule instead, the interface could not show a parameter's
// default while a run was in progress. Cancel does not reach it; the caller's
// context bounds it.
func (r *Runner) Query(ctx context.Context, action string) (json.RawMessage, error) {
	return r.execute(ctx, map[string]any{"action": action}, nil)
}

func (r *Runner) execute(ctx context.Context, req any, onProgress func(Progress)) (json.RawMessage, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}

	cmd := exec.CommandContext(ctx, r.python, r.script)
	cmd.Stdin = bytes.NewReader(body)
	// PYTHONNOUSERSITE keeps the user's site-packages out of the import path,
	// so the environment a request runs in does not depend on who launched the
	// application. PYTHONUNBUFFERED delivers progress lines as they are written.
	cmd.Env = append(os.Environ(), "PYTHONNOUSERSITE=1", "PYTHONUNBUFFERED=1")
	cmd.WaitDelay = waitDelay
	configureProcess(cmd)

	// Writers that are not *os.File are fed by goroutines os/exec owns, and
	// Run returns only after those have finished, so both are safe to read
	// once it returns.
	stdout := &boundedBuffer{limit: maxResultBytes}
	stderr := &progressWriter{onProgress: onProgress}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	runErr := cmd.Run()
	stderr.flush()

	if runErr != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("sidecar stopped: %w", ctx.Err())
		}
		return nil, stderr.failure(runErr)
	}
	if stdout.overflow {
		return nil, fmt.Errorf("sidecar result exceeds %d bytes", maxResultBytes)
	}
	out := bytes.TrimSpace(stdout.buf.Bytes())
	if len(out) == 0 {
		return nil, errors.New("sidecar produced no result")
	}
	if !json.Valid(out) {
		return nil, errors.New("sidecar result is not valid JSON")
	}
	return json.RawMessage(out), nil
}

// boundedBuffer keeps the first limit bytes written to it and discards the
// rest. It reports every write as complete so the interpreter is never left
// blocked on a full pipe.
type boundedBuffer struct {
	buf      bytes.Buffer
	limit    int
	overflow bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	room := b.limit - b.buf.Len()
	switch {
	case len(p) <= room:
		b.buf.Write(p)
	case room > 0:
		b.buf.Write(p[:room])
		b.overflow = true
	case len(p) > 0:
		b.overflow = true
	}
	return len(p), nil
}

// progressWriter splits stderr into lines. A line that decodes as a progress
// object is relayed; one carrying "error" is the sidecar's own account of a
// failure; any other line (a traceback frame, a library warning) is kept only
// as the last such line, which for a traceback is the exception message.
type progressWriter struct {
	onProgress func(Progress)
	pending    []byte
	lastError  string
	lastLine   string
}

func (w *progressWriter) Write(p []byte) (int, error) {
	w.pending = append(w.pending, p...)
	for {
		i := bytes.IndexByte(w.pending, '\n')
		if i < 0 {
			break
		}
		w.line(w.pending[:i])
		w.pending = w.pending[i+1:]
	}
	if len(w.pending) > maxLineBytes {
		w.line(w.pending[:maxLineBytes])
		w.pending = w.pending[maxLineBytes:]
	}
	return len(p), nil
}

func (w *progressWriter) flush() {
	if len(w.pending) > 0 {
		w.line(w.pending)
		w.pending = nil
	}
}

func (w *progressWriter) line(raw []byte) {
	s := strings.TrimSpace(string(raw))
	if s == "" {
		return
	}
	var ev struct {
		Progress *int   `json:"progress"`
		Msg      string `json:"msg"`
		Error    string `json:"error"`
	}
	if err := json.Unmarshal([]byte(s), &ev); err != nil || (ev.Progress == nil && ev.Msg == "" && ev.Error == "") {
		w.lastLine = s
		return
	}
	if ev.Error != "" {
		w.lastError = ev.Error
		return
	}
	p := -1
	if ev.Progress != nil {
		p = *ev.Progress
	}
	if w.onProgress != nil {
		w.onProgress(Progress{Progress: p, Msg: ev.Msg})
	}
}

// failure turns a non-zero exit into the most specific reason available: the
// sidecar's structured error, else the last unstructured stderr line, else the
// exit status alone.
func (w *progressWriter) failure(runErr error) error {
	switch {
	case w.lastError != "":
		return errors.New(w.lastError)
	case w.lastLine != "":
		return fmt.Errorf("sidecar failed (%v): %s", runErr, w.lastLine)
	default:
		return fmt.Errorf("sidecar failed: %w", runErr)
	}
}

func hasSidecar(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "sidecar", "main.py"))
	return err == nil
}

// resolveAppDir finds the directory holding sidecar/main.py:
// TERRA_ENERGY_APP_DIR when set, then the working directory (wails dev runs
// from the project root), then the executable's directory and its parents,
// which covers a built binary run from inside the repository, macOS bundle
// included.
func resolveAppDir() (string, error) {
	if dir := os.Getenv("TERRA_ENERGY_APP_DIR"); dir != "" {
		if hasSidecar(dir) {
			return dir, nil
		}
		return "", fmt.Errorf("TERRA_ENERGY_APP_DIR=%s holds no sidecar/main.py", dir)
	}

	var candidates []string
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, wd)
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for range 8 {
			candidates = append(candidates, dir)
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	for _, dir := range candidates {
		if hasSidecar(dir) {
			return dir, nil
		}
	}
	return "", errors.New("sidecar/main.py not found; set TERRA_ENERGY_APP_DIR to the directory that holds it")
}

// resolvePython picks the interpreter: TERRA_ENERGY_PYTHON when set, then a
// .venv in the application directory, then the python3 found on PATH. A
// desktop launch on macOS inherits a minimal PATH, so the first two are the
// dependable ones.
func resolvePython(appDir string) string {
	if p := os.Getenv("TERRA_ENERGY_PYTHON"); p != "" {
		return p
	}
	venv := filepath.Join(appDir, ".venv", "bin", "python3")
	fallback := "python3"
	if runtime.GOOS == "windows" {
		venv = filepath.Join(appDir, ".venv", "Scripts", "python.exe")
		fallback = "python"
	}
	if _, err := os.Stat(venv); err == nil {
		return venv
	}
	return fallback
}
