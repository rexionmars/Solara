/*
Package grid reads the Brazilian electrical system from the local PostGIS store
TERRA loads: the plant register and the transmission network as map layers, and
where an area could join that network.

The queries are in Python, in sidecar/terra_energy_engine/grid; this package
owns which database they are pointed at, what each action is sent and the shape
of what comes back. Go never opens the database itself.

WHICH DATABASE, in order: TERRA_BR_DSN, then the one chosen in Settings, then
postgresql:///terra_br. TERRA reads the same variable and has the same
default, so both applications find one store without being told. When the
variable is set, no DSN is sent with a request, so the variable stays in charge
of every process the sidecar starts.
*/
package grid

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
)

const (
	// EnvDSN names the variable that points every grid product at a store.
	EnvDSN = "TERRA_BR_DSN"
	// DefaultDSN is the local socket with the user's own role.
	DefaultDSN = "postgresql:///terra_br"

	SourceEnv     = "TERRA_BR_DSN"
	SourceChosen  = "chosen"
	SourceDefault = "default"

	configFile = "grid.json"
)

// Resolve decides which DSN a request carries and where it came from. send is
// empty when nothing should be sent: the variable is set, or nothing was chosen
// and the sidecar's own default applies. shown is the DSN the store is actually
// read from, unredacted.
func Resolve(chosen string) (send, source, shown string) {
	if env := os.Getenv(EnvDSN); env != "" {
		return "", SourceEnv, env
	}
	if chosen = strings.TrimSpace(chosen); chosen != "" {
		return chosen, SourceChosen, chosen
	}
	return "", SourceDefault, DefaultDSN
}

// Config is what the application remembers about the store.
type Config struct {
	DSN string `json:"dsn,omitempty"`
}

// LoadConfig reads the store's settings from dir. A missing or unreadable file
// is the empty configuration: the default store is then read, which is what a
// first launch should do.
func LoadConfig(dir string) Config {
	var cfg Config
	raw, err := os.ReadFile(filepath.Join(dir, configFile))
	if err != nil {
		return Config{}
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return Config{}
	}
	return cfg
}

// SaveConfig writes the store's settings into dir, atomically and readable by
// the user alone: a DSN can carry a password.
func SaveConfig(dir string, cfg Config) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dir, configFile)
	partial := path + ".partial"
	if err := os.WriteFile(partial, raw, 0o600); err != nil {
		return fmt.Errorf("write grid config: %w", err)
	}
	if err := os.Rename(partial, path); err != nil {
		_ = os.Remove(partial)
		return fmt.Errorf("write grid config: %w", err)
	}
	return nil
}

var (
	urlPassword     = regexp.MustCompile(`://([^:/@]+):[^@]*@`)
	keywordPassword = regexp.MustCompile(`(?i)(password\s*=\s*)('[^']*'|\S+)`)
)

// RedactDSN masks the password in a DSN, in either the URL form
// (postgresql://user:secret@host/db) or the keyword form (password=secret), so
// it can be shown on screen and written in a report.
func RedactDSN(dsn string) string {
	dsn = urlPassword.ReplaceAllString(dsn, "://$1:***@")
	return keywordPassword.ReplaceAllString(dsn, "${1}***")
}

func payload(action, dsn string) map[string]any {
	p := map[string]any{"action": action}
	if dsn != "" {
		p["br_store_dsn"] = dsn
	}
	return p
}

// Inspect checks the store by asking what it holds. It never returns an error:
// a store that did not answer is reported with the sidecar's reason.
func Inspect(ctx context.Context, r *sidecar.Runner, chosen string) *StoreReport {
	send, source, shown := Resolve(chosen)
	report := &StoreReport{DSN: RedactDSN(shown), DSNSource: source}
	raw, err := r.Read(ctx, payload("grid_coverage", send))
	if err != nil {
		report.Unreachable = err.Error()
		return report
	}
	var wrapped struct {
		Coverage *Coverage `json:"grid_coverage"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil || wrapped.Coverage == nil {
		report.Unreachable = "the store answered with something that is not its coverage"
		return report
	}
	report.Reachable = true
	report.Coverage = wrapped.Coverage
	return report
}

// Plants reads the whole plant register as a layer.
func Plants(ctx context.Context, r *sidecar.Runner, chosen string) (*PlantsLayer, error) {
	send, _, _ := Resolve(chosen)
	raw, err := r.Read(ctx, payload("grid_plants", send))
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Layer *PlantsLayer `json:"grid_plants"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the plant register: %w", err)
	}
	if wrapped.Layer == nil || len(wrapped.Layer.GeoJSON) == 0 {
		return nil, errors.New("the sidecar returned no plant register")
	}
	return wrapped.Layer, nil
}

// Network reads the whole transmission register as a layer.
func Network(ctx context.Context, r *sidecar.Runner, chosen string) (*NetworkLayer, error) {
	send, _, _ := Resolve(chosen)
	raw, err := r.Read(ctx, payload("grid_network", send))
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Layer *NetworkLayer `json:"grid_network"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the transmission register: %w", err)
	}
	if wrapped.Layer == nil || len(wrapped.Layer.Lines) == 0 || len(wrapped.Layer.Substations) == 0 {
		return nil, errors.New("the sidecar returned no transmission register")
	}
	return wrapped.Layer, nil
}

func connectionPayload(req ConnectionRequest, send string) map[string]any {
	p := payload("grid_congestion", send)
	p["polygon_geojson"] = req.Area
	if req.SearchRadiusKM != nil {
		p["search_radius_km"] = *req.SearchRadiusKM
	}
	return p
}

// AnalyzeConnection reads where an area could join the network. It runs as an
// analysis: one at a time, with progress, and cancellable.
func AnalyzeConnection(ctx context.Context, r *sidecar.Runner, req ConnectionRequest, chosen string,
	onProgress func(sidecar.Progress)) (*ConnectionAnalysis, error) {
	if err := req.Area.Validate(); err != nil {
		return nil, err
	}
	if req.SearchRadiusKM != nil && *req.SearchRadiusKM <= 0 {
		return nil, fmt.Errorf("the search radius must be greater than zero, got %g km", *req.SearchRadiusKM)
	}
	send, _, _ := Resolve(chosen)
	raw, err := r.Run(ctx, connectionPayload(req, send), onProgress)
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Analysis *ConnectionAnalysis `json:"grid_congestion"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the connection reading: %w", err)
	}
	if wrapped.Analysis == nil {
		return nil, errors.New("the sidecar returned no connection reading")
	}
	normalize(wrapped.Analysis)
	return wrapped.Analysis, nil
}

// normalize turns absent lists into empty ones, so the interface reads a
// length rather than guarding against null at every list.
func normalize(a *ConnectionAnalysis) {
	c := &a.Connection
	if c.Attachment == nil {
		c.Attachment = []Attachment{}
	}
	if c.AttachedBusHeadroom == nil {
		c.AttachedBusHeadroom = []BusHeadroom{}
	}
	if c.Neighbours == nil {
		c.Neighbours = []Neighbour{}
	}
	if c.NeighbourBusHeadroom == nil {
		c.NeighbourBusHeadroom = []BusHeadroom{}
	}
	if c.Substations == nil {
		c.Substations = []Reach{}
	}
	if c.Lines == nil {
		c.Lines = []Reach{}
	}
}

func demandPayload(req DemandRequest, send, workDir string) map[string]any {
	p := payload("demand_area", send)
	p["polygon_geojson"] = req.Area
	if req.Distribuidora != "" {
		p["distribuidora"] = req.Distribuidora
	}
	if req.Year != nil {
		p["ano"] = *req.Year
	}
	if req.SpecificYieldCeiling != nil {
		p["specific_yield_ceiling_kwh_kwp"] = *req.SpecificYieldCeiling
	}
	if req.CellKM != nil {
		p["cell_km"] = *req.CellKM
	}
	// Absent, the reading answers in figures and draws no layer.
	if workDir != "" {
		p["work_dir"] = workDir
	}
	return p
}

// AnalyzeDemand reads what an area already draws from the network, and what it
// already generates behind the meter, from the BDGD register in the store.
//
// A sibling of AnalyzeConnection and not a part of it: that one reads what the
// network could take from a plant here, this one what the place already takes
// from the network. The two registers are published on different dates and at
// different resolutions, so nothing here is subtracted from anything there.
// workDir is where the sidecar writes the density layer, and overlayURL turns
// that file's name into the URL the webview loads it from. Both may be empty,
// and the reading then answers in figures alone.
func AnalyzeDemand(ctx context.Context, r *sidecar.Runner, req DemandRequest, chosen, workDir string,
	overlayURL func(file string) string, onProgress func(sidecar.Progress)) (*DemandAnalysis, error) {
	if err := req.Area.Validate(); err != nil {
		return nil, err
	}
	if req.SpecificYieldCeiling != nil && *req.SpecificYieldCeiling <= 0 {
		return nil, fmt.Errorf("the yield ceiling must be greater than zero, got %g kWh/kWp/year",
			*req.SpecificYieldCeiling)
	}
	if req.Year != nil && (*req.Year < 2000 || *req.Year > 2100) {
		return nil, fmt.Errorf("the base year %d is not a year the register could carry", *req.Year)
	}
	if req.CellKM != nil && *req.CellKM <= 0 {
		return nil, fmt.Errorf("the layer's cell must be greater than zero, got %g km", *req.CellKM)
	}
	send, _, _ := Resolve(chosen)
	raw, err := r.Run(ctx, demandPayload(req, send, workDir), onProgress)
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Analysis *DemandAnalysis `json:"demand_area"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the demand reading: %w", err)
	}
	if wrapped.Analysis == nil {
		return nil, errors.New("the sidecar returned no demand reading")
	}
	normalizeDemand(wrapped.Analysis)
	if d := wrapped.Analysis.Density; d != nil {
		// Only a file inside this run's directory is served; anything else
		// would be a path the results route has no business exposing.
		if workDir == "" || filepath.Dir(filepath.Clean(d.OverlayPNG)) != filepath.Clean(workDir) {
			return nil, fmt.Errorf("the sidecar wrote the demand layer outside the run directory: %s", d.OverlayPNG)
		}
		d.OverlayURL = overlayURL(filepath.Base(d.OverlayPNG))
		d.OverlayPNG = ""
	}
	return wrapped.Analysis, nil
}

// normalizeDemand turns absent lists and maps into empty ones, so the
// interface reads a length rather than guarding against null at every list.
func normalizeDemand(a *DemandAnalysis) {
	if a.Consumption == nil {
		a.Consumption = map[string]*DemandConsumption{}
	}
	if a.Generation == nil {
		a.Generation = map[string]*DemandGeneration{}
	}
	if a.ByClass == nil {
		a.ByClass = []DemandByGroup{}
	}
	if a.ByTown == nil {
		a.ByTown = []DemandByGroup{}
	}
	if a.Register.Holdings == nil {
		a.Register.Holdings = []DemandHolding{}
	}
}

// TownDemand reads what each municipality of the loaded register consumes. A
// register read rather than an analysis: it runs outside the one-at-a-time
// rule, so the map keeps its layers while a reading is in flight.
func TownDemand(ctx context.Context, r *sidecar.Runner, chosen string) (*TownDemandLayer, error) {
	send, _, _ := Resolve(chosen)
	raw, err := r.Read(ctx, payload("demand_towns", send))
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Layer *TownDemandLayer `json:"demand_towns"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the municipal demand layer: %w", err)
	}
	if wrapped.Layer == nil {
		return nil, errors.New("the sidecar returned no municipal demand layer")
	}
	if wrapped.Layer.Towns == nil {
		wrapped.Layer.Towns = []TownConsumption{}
	}
	if wrapped.Layer.Registers == nil {
		wrapped.Layer.Registers = []TownRegister{}
	}
	return wrapped.Layer, nil
}

// Concessions reads where every register in the store has data, as a layer.
// Like TownDemand it takes no area: it answers before any ground is chosen,
// which is the only moment the answer is useful.
func Concessions(ctx context.Context, r *sidecar.Runner, chosen string) (*ConcessionLayer, error) {
	send, _, _ := Resolve(chosen)
	raw, err := r.Read(ctx, payload("grid_concessions", send))
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Layer *ConcessionLayer `json:"grid_concessions"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the concession layer: %w", err)
	}
	if wrapped.Layer == nil {
		return nil, errors.New("the sidecar returned no concession layer")
	}
	if wrapped.Layer.Holdings == nil {
		wrapped.Layer.Holdings = []DemandHolding{}
	}
	if wrapped.Layer.Reaches == nil {
		wrapped.Layer.Reaches = []Concession{}
	}
	return wrapped.Layer, nil
}
