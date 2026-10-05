/*
Package world reads what is published about the world at large, for ground no
store describes: the administrative boundaries of any country, from
geoBoundaries. The reading is in Python, in sidecar/terra_energy_engine/world;
this package owns the requests and the shape of what comes back.
*/
package world

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
)

// Country is one country geoBoundaries publishes.
type Country struct {
	ISO3 string `json:"iso3"`
	Name string `json:"name"`
}

// Countries is every country that can be asked for, and the credit owed.
type Countries struct {
	Countries []Country `json:"countries"`
	Credit    string    `json:"credit"`
}

// Level is one level a country is published at: 0 is the country itself, 1
// its first subdivision. Name is the level's own word where the source gave
// one ("Freguesias"), and empty where it did not.
type Level struct {
	Level int    `json:"level"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Place is one boundary of a level, without its shape.
type Place struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Shape is one boundary with its outline, a GeoJSON Polygon or MultiPolygon
// passed through undecoded.
type Shape struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Geometry json.RawMessage `json:"geometry" ts_type:"any"`
}

func read(ctx context.Context, r *sidecar.Runner, req map[string]any, cacheDir, key string, into any) error {
	if cacheDir != "" {
		req["boundary_cache_dir"] = cacheDir
	}
	raw, err := r.Read(ctx, req)
	if err != nil {
		return err
	}
	var wrapped map[string]json.RawMessage
	if err := json.Unmarshal(raw, &wrapped); err != nil || wrapped[key] == nil {
		return errors.New("the sidecar returned no boundaries")
	}
	if err := json.Unmarshal(wrapped[key], into); err != nil {
		return fmt.Errorf("decode the boundaries: %w", err)
	}
	return nil
}

// ListCountries reads every country that can be asked for.
func ListCountries(ctx context.Context, r *sidecar.Runner, cacheDir string) (*Countries, error) {
	var out Countries
	if err := read(ctx, r, map[string]any{"action": "world_countries"}, cacheDir, "world_countries", &out); err != nil {
		return nil, err
	}
	if out.Countries == nil {
		out.Countries = []Country{}
	}
	return &out, nil
}

// Levels reads the levels a country is published at.
func Levels(ctx context.Context, r *sidecar.Runner, iso3, cacheDir string) ([]Level, error) {
	var out struct {
		Levels []Level `json:"levels"`
	}
	req := map[string]any{"action": "world_boundaries", "iso3": iso3}
	if err := read(ctx, r, req, cacheDir, "world_boundaries", &out); err != nil {
		return nil, err
	}
	if out.Levels == nil {
		out.Levels = []Level{}
	}
	return out.Levels, nil
}

// Places reads the boundaries of one level of a country, by name.
func Places(ctx context.Context, r *sidecar.Runner, iso3 string, level int, cacheDir string) ([]Place, error) {
	var out struct {
		Places []Place `json:"places"`
	}
	req := map[string]any{"action": "world_boundaries", "iso3": iso3, "level": level}
	if err := read(ctx, r, req, cacheDir, "world_boundaries", &out); err != nil {
		return nil, err
	}
	if out.Places == nil {
		out.Places = []Place{}
	}
	return out.Places, nil
}

// Boundary reads one boundary with its outline.
func Boundary(ctx context.Context, r *sidecar.Runner, iso3 string, level int, id, cacheDir string) (*Shape, error) {
	var out struct {
		Boundary *Shape `json:"boundary"`
	}
	req := map[string]any{"action": "world_boundaries", "iso3": iso3, "level": level, "id": id}
	if err := read(ctx, r, req, cacheDir, "world_boundaries", &out); err != nil {
		return nil, err
	}
	if out.Boundary == nil {
		return nil, errors.New("the sidecar returned no boundary")
	}
	return out.Boundary, nil
}
