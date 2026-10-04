package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/rexionmars/TerraEnergyEngine/internal/energy"
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

// savedGridDSN is the connection last connected, remembered between sessions
// so the Grid store card comes back filled in.
func (a *App) savedGridDSN() string {
	dir, err := gridConfigDir()
	if err != nil {
		return ""
	}
	return grid.LoadConfig(dir).DSN
}

/*
chosenGridDSN is the store the grid products read: the saved connection, but
only once it has been connected in this session.

A SESSION STARTS DISCONNECTED. Remembering a connection and using it are two
things, and they were one: the application opened already reading whichever
database was connected last, and drew its layers on a map nobody had asked
anything of. A reader who had done nothing was looking at data with no way to
tell where it came from. Connecting is one press on a card that is already
filled in, and it is the reader's.
*/
func (a *App) chosenGridDSN() string {
	if !a.gridConnected.Load() {
		return ""
	}
	return a.savedGridDSN()
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
// empty dsn forgets the choice, which disconnects: there is no store to fall
// back to (grid.ErrNoStore).
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
	a.gridConnected.Store(dsn != "")
	return grid.Inspect(ctx, r, dsn), nil
}

// DisconnectGridStore stops reading the store for this session and keeps the
// connection remembered, so the card stays filled in for the next Connect.
func (a *App) DisconnectGridStore() (*grid.StoreReport, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	a.gridConnected.Store(false)
	ctx, cancel := context.WithTimeout(a.ctx, gridInspectTimeout)
	defer cancel()
	return grid.Inspect(ctx, r, ""), nil
}

// GridStoreConnection is the store chosen in Settings as the fields of its
// connection card. The password is not among them, only whether one is saved.
func (a *App) GridStoreConnection() grid.StoreConnection {
	return grid.SavedConnection(a.savedGridDSN())
}

// ParseGridStoreURL takes a pasted connection string apart into the card's
// fields, password included: it is the reader's own, pasted a moment ago.
func (a *App) ParseGridStoreURL(dsn string) (grid.StoreConnection, error) {
	return grid.ParseDSN(dsn)
}

// TestGridStore checks the store the fields describe and saves nothing. It
// checks those fields even while TERRA_BR_DSN is set, since the question is
// whether they would work, not which store is read now.
func (a *App) TestGridStore(conn grid.StoreConnection) (*grid.StoreReport, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	dsn, err := conn.WithSavedPassword(a.savedGridDSN()).DSN()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridInspectTimeout)
	defer cancel()
	return grid.Try(ctx, r, dsn), nil
}

// SetGridStoreConnection points the grid products at the store the fields
// describe, under SetGridStore's rules. An empty password with HasPassword set
// keeps the one already saved.
func (a *App) SetGridStoreConnection(conn grid.StoreConnection) (*grid.StoreReport, error) {
	dsn, err := conn.WithSavedPassword(a.savedGridDSN()).DSN()
	if err != nil {
		return nil, err
	}
	return a.SetGridStore(dsn)
}

// StoreBoundaryList lists the named grounds of a store prepared to the
// contract: what its catalogue of areas is read from, in IBGE's place.
func (a *App) StoreBoundaryList() (*grid.BoundaryList, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridLayerTimeout)
	defer cancel()
	return grid.Boundaries(ctx, r, a.chosenGridDSN())
}

// StoreBoundary reads one of those grounds with its outline.
func (a *App) StoreBoundary(id string) (*grid.BoundaryShape, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridLayerTimeout)
	defer cancel()
	return grid.Boundary(ctx, r, id, a.chosenGridDSN())
}

// GridPlants reads the plant register as a map layer.
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

// AnalyzeGridDemand reads what an area already draws from the network, from
// the BDGD register in the store.
func (a *App) AnalyzeGridDemand(req grid.DemandRequest) (*grid.DemandAnalysis, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	if a.ctx == nil {
		return nil, errors.New("the application has not started")
	}
	dir, id, err := a.newRunDir()
	if err != nil {
		return nil, err
	}
	res, err := grid.AnalyzeDemand(a.ctx, r, req, a.chosenGridDSN(), dir,
		func(file string) string { return resultURL(id, file) }, a.emitProgress)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	return res, nil
}

// GridTownDemand reads consumption by municipality as a map layer.
func (a *App) GridTownDemand() (*grid.TownDemandLayer, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridLayerTimeout)
	defer cancel()
	return grid.TownDemand(ctx, r, a.chosenGridDSN())
}

// GridDemandReach measures how much of an area each loaded register covers,
// before a demand reading is run over it. What the reading would report about
// its own coverage, asked while the reader can still act on it.
func (a *App) GridDemandReach(area energy.Polygon) (*grid.ReachProbe, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridLayerTimeout)
	defer cancel()
	return grid.DemandReach(ctx, r, area, a.chosenGridDSN())
}

// GridConcessions reads where each register in the store has data, as a map
// layer. Read once and before any area is chosen: it is what says whether a
// demand reading is answerable over a given ground at all.
func (a *App) GridConcessions() (*grid.ConcessionLayer, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, gridLayerTimeout)
	defer cancel()
	return grid.Concessions(ctx, r, a.chosenGridDSN())
}
