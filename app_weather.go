package main

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/rexionmars/TerraEnergyEngine/internal/weather"
)

// The wind field is about 180 KB from a research server; past this it is
// reported as unreachable rather than left spinning.
const windFieldTimeout = 90 * time.Second

// windCacheDir keeps the hour's wind field between requests, beside the NASA
// POWER cache.
func windCacheDir() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "terra-energy-engine", "wind")
}

// WindField reads the GFS wind over South America at heightM (10 or 100) for
// the hour now.
func (a *App) WindField(heightM int) (*weather.WindField, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, windFieldTimeout)
	defer cancel()
	return weather.FetchWindField(ctx, r, heightM, windCacheDir())
}
