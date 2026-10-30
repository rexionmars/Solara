package sidecar

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

// warmWorkers is how many interpreters stay running for reads. Two, because
// the map reads two layers at once (frontend/src/lib/geopackage.ts); a third
// read waits for one of them rather than starting a process of its own.
const warmWorkers = 2

/*
A worker is one interpreter kept running between reads, started with
--serve (terra_energy_engine/cli.py). Starting Python and importing what a
read needs costs about 0.3 s, which a map paid on every pan of every layer
while each request had its own process. A worker answers one request at a
time: a line of JSON in, a line of {"result": ...} or {"error": ...} out.

It runs the code it was started with, so a sidecar edited during `wails dev`
reaches the reads only once the application restarts. Analyses do not use
workers: Run keeps a process per request, which Cancel can kill alone.
*/
type worker struct {
	cmd  *exec.Cmd
	stop context.CancelFunc
	in   io.WriteCloser
	out  *bufio.Reader
	// Set when the worker can no longer be trusted with a request: it died,
	// was killed mid-answer, or wrote something that was not an answer.
	broken bool
}

func (r *Runner) startWorker() (*worker, error) {
	ctx, stop := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, r.python, append(r.args(), "--serve")...)
	cmd.Env = append(os.Environ(), "PYTHONNOUSERSITE=1", "PYTHONUNBUFFERED=1")
	cmd.WaitDelay = waitDelay
	// Progress and tracebacks are drained and dropped: an answer carries its own error.
	cmd.Stderr = io.Discard
	configureProcess(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		stop()
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		stop()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		stop()
		return nil, err
	}
	// Reaps the process whenever it ends; its pipes then close and a pending read fails.
	go func() { _ = cmd.Wait() }()
	return &worker{cmd: cmd, stop: stop, in: in, out: bufio.NewReaderSize(out, 64<<10)}, nil
}

// close ends the worker's interpreter and everything it started.
func (w *worker) close() {
	w.broken = true
	_ = w.in.Close()
	w.stop()
}

// ask sends one request and waits for its answer. A request the context ends
// first kills the worker, since its answer would arrive for nobody.
func (w *worker) ask(ctx context.Context, body []byte) (json.RawMessage, error) {
	type reply struct {
		line []byte
		err  error
	}
	got := make(chan reply, 1)
	go func() {
		if _, err := w.in.Write(append(body, '\n')); err != nil {
			got <- reply{err: err}
			return
		}
		line, err := w.out.ReadBytes('\n')
		got <- reply{line: line, err: err}
	}()
	var a reply
	select {
	case <-ctx.Done():
		w.close()
		return nil, fmt.Errorf("sidecar stopped: %w", ctx.Err())
	case a = <-got:
	}
	if a.err != nil {
		w.broken = true
		return nil, fmt.Errorf("sidecar worker: %w", a.err)
	}
	if len(a.line) > maxResultBytes {
		return nil, fmt.Errorf("sidecar result exceeds %d bytes", maxResultBytes)
	}
	var answer struct {
		Result json.RawMessage `json:"result"`
		Error  *string         `json:"error"`
	}
	if err := json.Unmarshal(a.line, &answer); err != nil {
		w.broken = true
		return nil, errors.New("sidecar result is not valid JSON")
	}
	if answer.Error != nil {
		return nil, errors.New(*answer.Error)
	}
	if len(answer.Result) == 0 || string(answer.Result) == "null" {
		return nil, errors.New("sidecar produced no result")
	}
	return answer.Result, nil
}

// pool holds the workers. A slot is a worker that may exist, busy or idle;
// an idle worker is taken before a free slot starts another, so a second
// interpreter starts only while the first is busy.
type pool struct {
	slots chan struct{}
	mu    sync.Mutex
	idle  []*worker
}

func newPool() *pool {
	return &pool{slots: make(chan struct{}, warmWorkers)}
}

// take waits for a slot and returns the most recently used idle worker, or
// nil when the slot is free to start one.
func (p *pool) take(ctx context.Context) (*worker, error) {
	select {
	case p.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, fmt.Errorf("sidecar stopped: %w", ctx.Err())
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if n := len(p.idle); n > 0 {
		w := p.idle[n-1]
		p.idle = p.idle[:n-1]
		return w, nil
	}
	return nil, nil
}

// give returns a slot, keeping its worker for the next read unless it broke.
func (p *pool) give(w *worker) {
	if w != nil && w.broken {
		w.close()
		w = nil
	}
	if w != nil {
		p.mu.Lock()
		p.idle = append(p.idle, w)
		p.mu.Unlock()
	}
	<-p.slots
}

// readWarm answers a read from a running worker, starting one when a slot is
// free and none is idle. A worker that cannot start, or dies under a request,
// sends that request down the cold path instead, so a fault in the warm path
// costs time and never a read.
func (r *Runner) readWarm(ctx context.Context, req any) (json.RawMessage, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}
	w, err := r.warm.take(ctx)
	if err != nil {
		return nil, err
	}
	if w == nil {
		if w, err = r.startWorker(); err != nil {
			r.warm.give(nil)
			return r.execute(ctx, req, nil)
		}
	}
	out, err := w.ask(ctx, body)
	broken := w.broken
	r.warm.give(w)
	if broken && ctx.Err() == nil {
		return r.execute(ctx, req, nil)
	}
	return out, err
}

// Close ends the idle workers. Busy ones end when the application does: their
// stdin closes with it, and the interpreter stops serving.
func (r *Runner) Close() {
	r.warm.mu.Lock()
	defer r.warm.mu.Unlock()
	for _, w := range r.warm.idle {
		w.close()
	}
	r.warm.idle = nil
}
