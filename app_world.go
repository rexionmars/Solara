package main

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/rexionmars/TerraEnergyEngine/internal/world"
)

/*
The world bindings: the boundaries of any country, which is what the catalogue
of areas reads where neither a store nor a national service names the ground.
Read outside the one-analysis rule, like the grid layers, so a boundary can be
chosen while an analysis runs.
*/

// A level of a large country is tens of megabytes the first time it is asked
// for; after that it is read from the cache.
const boundaryTimeout = 4 * time.Minute

// boundaryCacheDir keeps each country's levels between sessions, beside the
// other caches.
func boundaryCacheDir() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "terra-energy-engine", "boundaries")
}

// WorldCountries lists the countries whose boundaries can be read.
func (a *App) WorldCountries() (*world.Countries, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, boundaryTimeout)
	defer cancel()
	return world.ListCountries(ctx, r, boundaryCacheDir())
}

// WorldLevels lists the levels one country is published at.
func (a *App) WorldLevels(iso3 string) ([]world.Level, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, boundaryTimeout)
	defer cancel()
	return world.Levels(ctx, r, iso3, boundaryCacheDir())
}

// WorldPlaces lists the boundaries of one level of a country, by name.
func (a *App) WorldPlaces(iso3 string, level int) ([]world.Place, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, boundaryTimeout)
	defer cancel()
	return world.Places(ctx, r, iso3, level, boundaryCacheDir())
}

// WorldBoundary reads one boundary with its outline.
func (a *App) WorldBoundary(iso3 string, level int, id string) (*world.Shape, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, boundaryTimeout)
	defer cancel()
	return world.Boundary(ctx, r, iso3, level, id, boundaryCacheDir())
}
