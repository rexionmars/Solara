package main

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/rexionmars/TerraEnergyEngine/internal/energy"
	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

/*
The energy bindings. Each runs one sidecar action and returns its result; one
analysis runs at a time, and CancelRun stops it.

Progress is emitted as "sidecar:progress". There is one channel because there
is one analysis at a time -- the runner refuses a second with ErrBusy -- so a
progress line always belongs to the run the interface is waiting on. TERRA
routed one shared channel by guessing which product was active.
*/

// powerCacheDir is where the NASA POWER series are kept between runs: the
// user's cache directory, which the system may clear and which backups skip.
// Not TERRA's ~/.cache/geosense/power, so the two applications share a cache
// only if this is pointed at it on purpose.
func powerCacheDir() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "terra-energy-engine", "power")
}

func (a *App) emitProgress(p sidecar.Progress) {
	wruntime.EventsEmit(a.ctx, "sidecar:progress", p)
}

func (a *App) analysisRunner() (*sidecar.Runner, error) {
	if a.runner == nil {
		msg := "the sidecar is unavailable"
		if a.runnerErr != nil {
			msg += ": " + a.runnerErr.Error()
		}
		return nil, errors.New(msg)
	}
	return a.runner, nil
}

// AnalyzeSolarResource computes the solar resource and photovoltaic yield at a site.
func (a *App) AnalyzeSolarResource(req energy.SolarRequest) (*energy.SolarAnalysis, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	return energy.AnalyzeSolar(a.ctx, r, req, powerCacheDir(), a.emitProgress)
}

// AnalyzeWindResource screens the wind resource at a site.
func (a *App) AnalyzeWindResource(req energy.WindRequest) (*energy.WindAnalysis, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	return energy.AnalyzeWind(a.ctx, r, req, powerCacheDir(), a.emitProgress)
}

// AnalyzeSolarTerrain maps the plane-of-array irradiation over an area's
// terrain. The rendered layer is served from this run's results directory.
func (a *App) AnalyzeSolarTerrain(req energy.SolarTerrainRequest) (*energy.SolarTerrainAnalysis, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	dir, id, err := a.newRunDir()
	if err != nil {
		return nil, err
	}
	res, err := energy.AnalyzeSolarTerrain(a.ctx, r, req, powerCacheDir(), dir,
		func(file string) string { return resultURL(id, file) }, a.emitProgress)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	return res, nil
}

// CancelRun stops the analysis in progress and reports whether there was one.
// The process group is killed, so nothing the interpreter started survives it.
func (a *App) CancelRun() bool {
	if a.runner == nil {
		return false
	}
	return a.runner.Cancel()
}
