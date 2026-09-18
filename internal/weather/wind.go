/*
Package weather reads the weather now where only the sidecar can: the GFS wind
field over South America, which arrives as NetCDF. See
sidecar/terra_energy_engine/weather/wind.py for the source and its limits.
*/
package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
)

// WindField is the wind at one height over a regular grid, west to east and
// north to south: point (i, j) is at lon0 + i*dlon, lat0 - j*dlat, and its
// components are u[j*nx+i] and v[j*nx+i], in m/s. A null component is a point
// the model has no value for.
type WindField struct {
	HeightM int        `json:"height_m"`
	Valid   string     `json:"valid"`
	Run     *string    `json:"run"`
	Lon0    float64    `json:"lon0"`
	Lat0    float64    `json:"lat0"`
	DLon    float64    `json:"dlon"`
	DLat    float64    `json:"dlat"`
	NX      int        `json:"nx"`
	NY      int        `json:"ny"`
	U       []*float64 `json:"u"`
	V       []*float64 `json:"v"`
	Source  string     `json:"source"`
	Note    string     `json:"note"`
}

// Heights are the heights the field is read at.
var Heights = []int{10, 100}

func decodeWindField(raw []byte) (*WindField, error) {
	var wrapped struct {
		Field *WindField `json:"wind_field"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the wind field: %w", err)
	}
	f := wrapped.Field
	if f == nil {
		return nil, errors.New("the sidecar returned no wind field")
	}
	// Refused rather than drawn: a grid whose arrays do not match its shape
	// would put every value at the wrong point, silently.
	if f.NX < 2 || f.NY < 2 || f.DLon <= 0 || f.DLat <= 0 {
		return nil, fmt.Errorf("the wind field's grid is malformed: %d x %d at %g x %g degrees", f.NX, f.NY, f.DLon, f.DLat)
	}
	if len(f.U) != f.NX*f.NY || len(f.V) != f.NX*f.NY {
		return nil, fmt.Errorf("the wind field holds %d and %d values for a %d x %d grid", len(f.U), len(f.V), f.NX, f.NY)
	}
	return f, nil
}

// FetchWindField reads the field at heightM, from cacheDir when this hour's
// is already there. It runs outside the one-analysis rule, so the map keeps
// its wind while an analysis runs.
func FetchWindField(ctx context.Context, r *sidecar.Runner, heightM int, cacheDir string) (*WindField, error) {
	known := false
	for _, h := range Heights {
		known = known || h == heightM
	}
	if !known {
		return nil, fmt.Errorf("the wind field is read at 10 or 100 m, not %d m", heightM)
	}
	req := map[string]any{"action": "wind_field", "height_m": heightM}
	if cacheDir != "" {
		req["wind_cache_dir"] = cacheDir
	}
	raw, err := r.Read(ctx, req)
	if err != nil {
		return nil, err
	}
	return decodeWindField(raw)
}
