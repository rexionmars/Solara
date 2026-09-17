package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
	"github.com/rexionmars/TerraEnergyEngine/internal/store"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the struct the frontend is bound to. Every exported method on it is
// callable from the interface through the generated wailsjs bindings.
type App struct {
	ctx    context.Context
	runner *sidecar.Runner
	// Why the runner could not be built; reported in place of a probe result.
	runnerErr error

	// The local account database, written once in startup. Nil when it could
	// not be opened; accountsErr then says why, and the bindings report it.
	accounts    *store.Store
	accountsErr error

	// The signed-in account, or nil for the guest. Written by the account
	// bindings, each of which Wails runs on its own goroutine.
	userMu sync.RWMutex
	user   *store.User

	bootMu      sync.Mutex
	bootLogs    []string
	bootStarted time.Time

	// This session's results directory; see app_results.go. Set in NewApp,
	// before the asset server starts, so the requests that read it never race
	// the write.
	resultsDir string
	resultsErr error
}

// NewApp creates a new App.
func NewApp() *App {
	a := &App{}
	a.resultsDir, a.resultsErr = newResultsDir()
	return a
}

const (
	// How long the splash is held when the boot finishes sooner: long enough
	// to read the release line, short enough that nobody waits on it. The Ken
	// Burns pan in index.css is timed against this.
	minSplash = 3 * time.Second

	// The boot probe. Past this the splash hands over anyway and the header
	// reports the sidecar as unavailable.
	bootProbeTimeout = 8 * time.Second

	// Ping, called from the interface. The first interpreter start after a
	// reboot can take several seconds.
	pingTimeout = 15 * time.Second
)

// startup runs once, before the frontend can call any binding, so the fields
// it writes are never read concurrently with the write.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	wruntime.WindowCenter(ctx)
	a.openAccounts()
	a.bootLog("resolving sidecar…")
	a.runner, a.runnerErr = sidecar.NewRunner()
	if a.runnerErr != nil {
		a.bootLog("sidecar: " + a.runnerErr.Error())
		return
	}
	a.bootLog("python · " + filepath.Base(a.runner.Python()))
}

// domReady runs once the frontend can receive events. The probe runs off the
// Wails callback so the window keeps painting while the interpreter starts.
func (a *App) domReady(ctx context.Context) {
	a.bootStarted = time.Now()
	go a.probeSidecar(ctx)
}

// shutdown stops a request still running when the window closes. Without it
// the interpreter, and every process it started, outlives the application.
func (a *App) shutdown(context.Context) {
	if a.runner != nil {
		a.runner.Cancel()
	}
	if a.accounts != nil {
		_ = a.accounts.Close()
	}
	// After the cancel above, so no sidecar is still writing into it.
	if a.resultsDir != "" {
		_ = os.RemoveAll(a.resultsDir)
	}
}

func (a *App) bootLog(msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	a.bootMu.Lock()
	a.bootLogs = append(a.bootLogs, msg)
	if len(a.bootLogs) > 64 {
		a.bootLogs = a.bootLogs[len(a.bootLogs)-64:]
	}
	a.bootMu.Unlock()
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "boot:log", msg)
	}
}

// GetBootLogs returns the boot lines written so far. The splash reads them on
// mount, because the lines written during startup were emitted before any
// listener existed.
func (a *App) GetBootLogs() []string {
	a.bootMu.Lock()
	defer a.bootMu.Unlock()
	out := make([]string, len(a.bootLogs))
	copy(out, a.bootLogs)
	return out
}

// probeSidecar checks the sidecar, holds the splash for its minimum, then
// emits boot:ready with whether the sidecar answered. The frontend fades the
// splash and calls RevealMainWindow.
func (a *App) probeSidecar(ctx context.Context) {
	a.bootLog("probing sidecar…")
	status := a.checkSidecar(bootProbeTimeout)
	if status.OK {
		a.bootLog("sidecar ready · python " + status.Version)
	} else {
		a.bootLog("sidecar: " + status.Error)
	}

	if wait := minSplash - time.Since(a.bootStarted); wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return
		}
	}
	a.bootLog("ready")
	wruntime.EventsEmit(ctx, "boot:ready", status.OK)
}

// RevealMainWindow expands the splash-sized window into the main window and
// brings it to the front.
func (a *App) RevealMainWindow() {
	ctx := a.ctx
	// Held on top while it expands, so another application cannot cover it
	// mid-transition; released once the frame has settled.
	wruntime.WindowSetAlwaysOnTop(ctx, true)
	wruntime.WindowSetMinSize(ctx, 960, 600)
	wruntime.WindowSetMaxSize(ctx, 0, 0)
	wruntime.WindowUnminimise(ctx)
	wruntime.WindowMaximise(ctx)
	wruntime.WindowShow(ctx)
	focusApp()

	go func() {
		time.Sleep(250 * time.Millisecond)
		wruntime.WindowSetAlwaysOnTop(ctx, false)
		wruntime.WindowShow(ctx)
		focusApp()
	}()
}

// SidecarStatus is what Ping reports about the Python side.
type SidecarStatus struct {
	OK bool `json:"ok"`
	// Interpreter the runner resolved, as a path or a command name.
	Python string `json:"python"`
	// Version the interpreter reported, when it answered.
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Ping starts the sidecar with the ping action and reports whether it answered.
func (a *App) Ping() SidecarStatus {
	return a.checkSidecar(pingTimeout)
}

func (a *App) checkSidecar(timeout time.Duration) SidecarStatus {
	if a.runner == nil {
		msg := "sidecar unavailable"
		if a.runnerErr != nil {
			msg = a.runnerErr.Error()
		}
		return SidecarStatus{Error: msg}
	}

	status := SidecarStatus{Python: a.runner.Python()}
	ctx, cancel := context.WithTimeout(a.ctx, timeout)
	defer cancel()

	raw, err := a.runner.Probe(ctx)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	var reply struct {
		Python string `json:"python"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil {
		status.Error = "unreadable ping reply: " + err.Error()
		return status
	}
	status.OK = true
	status.Version = reply.Python
	return status
}
