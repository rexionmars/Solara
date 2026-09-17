package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/rexionmars/TerraEnergyEngine/internal/grid"
	"github.com/rexionmars/TerraEnergyEngine/internal/store"
)

/*
The grid bindings: the store the electrical record is read from, its registers
as map layers, and the connection reading over an area. See internal/grid.

The store is checked and the layers read outside the one-analysis rule
(sidecar.Runner.Read), so the map keeps its layers while an analysis runs. The
connection reading is an analysis like the others: one at a time, with
progress, stopped by CancelRun.
*/

const (
	// A check is one query over a table of source files; past this the store
	// is reported as not answering. The connect itself gives up after five
	// seconds (grid/store.py CONNECT_TIMEOUT_S).
	gridInspectTimeout = 30 * time.Second

	// The register is about 7 MB and takes a few seconds to read and encode.
	gridLayerTimeout = 90 * time.Second
)

// gridConfigDir is where the chosen store is remembered: the application's
// data directory, beside the account database.
func gridConfigDir() (string, error) {
	return store.DefaultDir()
}

func (a *App) chosenGridDSN() string {
	dir, err := gridConfigDir()
	if err != nil {
		return ""
	}
	return grid.LoadConfig(dir).DSN
}

// InspectGridStore reports which store the grid products read and what it
// holds, or why it did not answer.
func (a *App) InspectGridStore() (*grid.StoreReport, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridInspectTimeout)
	defer cancel()
	return grid.Inspect(ctx, r, a.chosenGridDSN()), nil
}

// SetGridStore points the grid products at dsn and reports what it holds. An
// empty dsn forgets the choice and returns to the default.
//
// A DSN that does not answer is refused and not saved, with the reason in the
// report: a saved store nobody can reach would only move the failure to the
// next reading. While TERRA_BR_DSN is set the choice is still saved, and the
// report says the variable is what is read.
func (a *App) SetGridStore(dsn string) (*grid.StoreReport, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	dsn = strings.TrimSpace(dsn)
	dir, err := gridConfigDir()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridInspectTimeout)
	defer cancel()
	if dsn != "" {
		trial := grid.Inspect(ctx, r, dsn)
		if !trial.Reachable && trial.DSNSource == grid.SourceChosen {
			return trial, nil
		}
	}
	if err := grid.SaveConfig(dir, grid.Config{DSN: dsn}); err != nil {
		return nil, err
	}
	return grid.Inspect(ctx, r, dsn), nil
}

// GridPlants reads the ANEEL plant register as a map layer.
func (a *App) GridPlants() (*grid.PlantsLayer, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridLayerTimeout)
	defer cancel()
	return grid.Plants(ctx, r, a.chosenGridDSN())
}

// GridNetwork reads the ONS transmission register as map layers.
func (a *App) GridNetwork() (*grid.NetworkLayer, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridLayerTimeout)
	defer cancel()
	return grid.Network(ctx, r, a.chosenGridDSN())
}

// AnalyzeGridConnection reads where an area could join the transmission
// network, and what the plants already connected in it experienced.
func (a *App) AnalyzeGridConnection(req grid.ConnectionRequest) (*grid.ConnectionAnalysis, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	if a.ctx == nil {
		return nil, errors.New("the application has not started")
	}
	return grid.AnalyzeConnection(a.ctx, r, req, a.chosenGridDSN(), a.emitProgress)
}
