package grid

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/rexionmars/TerraEnergyEngine/internal/energy"
	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
)

func TestResolve_PrecedenceIsVariableThenChosenThenDefault(t *testing.T) {
	t.Setenv(EnvDSN, "")
	if send, source, shown := Resolve(""); send != "" || source != SourceDefault || shown != DefaultDSN {
		t.Errorf("nothing set: got %q %q %q", send, source, shown)
	}
	if send, source, _ := Resolve("  postgresql://db/terra_br "); send != "postgresql://db/terra_br" || source != SourceChosen {
		t.Errorf("chosen: got %q %q", send, source)
	}
	t.Setenv(EnvDSN, "postgresql://env/terra_br")
	// The variable wins, and is not sent: the sidecar reads it itself.
	if send, source, shown := Resolve("postgresql://db/terra_br"); send != "" || source != SourceEnv || shown != "postgresql://env/terra_br" {
		t.Errorf("variable set: got %q %q %q", send, source, shown)
	}
}

func TestRedactDSN(t *testing.T) {
	for in, want := range map[string]string{
		"postgresql://ana:s3cret@db.local:5432/terra_br":   "postgresql://ana:***@db.local:5432/terra_br",
		"host=db user=ana password=s3cret dbname=terra_br": "host=db user=ana password=*** dbname=terra_br",
		"host=db password='two words' dbname=terra_br":     "host=db password=*** dbname=terra_br",
		"postgresql:///terra_br":                           "postgresql:///terra_br",
	} {
		if got := RedactDSN(in); got != want {
			t.Errorf("RedactDSN(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestConfig_RoundTripsPrivately(t *testing.T) {
	dir := t.TempDir()
	if got := LoadConfig(dir); got.DSN != "" {
		t.Fatalf("a missing file read as %+v", got)
	}
	if err := SaveConfig(dir, Config{DSN: "postgresql://ana:s3cret@db/terra_br"}); err != nil {
		t.Fatal(err)
	}
	if got := LoadConfig(dir); got.DSN != "postgresql://ana:s3cret@db/terra_br" {
		t.Fatalf("read back %+v", got)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(dir, configFile))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("mode %v; a DSN can carry a password", info.Mode().Perm())
		}
	}
}

func TestConnectionPayload_SendsOnlyWhatWasSet(t *testing.T) {
	area := energy.Polygon{Type: "Polygon", Coordinates: [][][]float64{{{0, 0}, {1, 0}, {1, 1}, {0, 0}}}}
	p := connectionPayload(ConnectionRequest{Area: area}, "")
	if _, ok := p["br_store_dsn"]; ok {
		t.Error("an empty DSN was sent")
	}
	if _, ok := p["search_radius_km"]; ok {
		t.Error("an unset radius was sent")
	}
	radius := 0.0
	p = connectionPayload(ConnectionRequest{Area: area, SearchRadiusKM: &radius}, "postgresql://db/x")
	if p["search_radius_km"] != 0.0 || p["br_store_dsn"] != "postgresql://db/x" {
		t.Errorf("got %v", p)
	}
}

// liveRunner points a runner at this repository's sidecar under an
// interpreter that has psycopg, or skips.
func liveRunner(t *testing.T) *sidecar.Runner {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	python := filepath.Join(root, ".venv", "bin", "python3")
	if err := exec.Command(python, "-c", "import psycopg").Run(); err != nil {
		t.Skip("no interpreter with psycopg in .venv")
	}
	t.Setenv("TERRA_ENERGY_APP_DIR", root)
	t.Setenv("TERRA_ENERGY_PYTHON", python)
	r, err := sidecar.NewRunner()
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestInspect_TurnsARefusedConnectionIntoAReason(t *testing.T) {
	r := liveRunner(t)
	t.Setenv(EnvDSN, "")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	report := Inspect(ctx, r, "postgresql://ana:s3cret@127.0.0.1:1/terra_nothing_here")
	if report.Reachable || report.Unreachable == "" {
		t.Fatalf("got %+v", report)
	}
	if report.DSNSource != SourceChosen || strings.Contains(report.DSN, "s3cret") {
		t.Errorf("source %q dsn %q", report.DSNSource, report.DSN)
	}
	if strings.Contains(report.Unreachable, "s3cret") {
		t.Errorf("the password reached the reason: %q", report.Unreachable)
	}
}

func TestInspect_ReportsEitherContentsOrAReason(t *testing.T) {
	r := liveRunner(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	report := Inspect(ctx, r, "")
	if report.Reachable == (report.Unreachable != "") {
		t.Fatalf("reachable %v with reason %q", report.Reachable, report.Unreachable)
	}
	if report.Reachable && report.Coverage == nil {
		t.Fatal("reachable with no coverage")
	}
}

// A reply the sidecar wrote over Sol do Sertão, decoded with unknown fields
// refused, so a field the sidecar adds or renames fails here rather than
// reaching the interface as a silent null.
func TestConnectionAnalysis_DecodesARealReplyWhole(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "grid_congestion.json"))
	if err != nil {
		t.Fatal(err)
	}
	var wrapped struct {
		Analysis *ConnectionAnalysis `json:"grid_congestion"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wrapped); err != nil {
		t.Fatal(err)
	}
	a := wrapped.Analysis
	if a == nil || !a.Connection.Reachable || len(a.Connection.Attachment) == 0 {
		t.Fatalf("got %+v", a)
	}
	if a.CurtailmentAtConnectedPlants == nil || a.CurtailmentAtConnectedPlants.PlantsInAOI == 0 {
		t.Fatal("the curtailment half did not decode")
	}
}

func TestDemandPayload_SendsOnlyWhatWasSet(t *testing.T) {
	area := energy.Polygon{Type: "Polygon", Coordinates: [][][]float64{{{0, 0}, {1, 0}, {1, 1}, {0, 0}}}}
	p := demandPayload(DemandRequest{Area: area}, "", "")
	for _, k := range []string{"br_store_dsn", "distribuidora", "ano", "specific_yield_ceiling_kwh_kwp", "cell_km", "work_dir"} {
		if _, ok := p[k]; ok {
			t.Errorf("an unset %s was sent", k)
		}
	}
	year, ceiling, cell := 2024, 1610.1, 0.5
	p = demandPayload(DemandRequest{
		Area: area, Distribuidora: "Neoenergia_Cosern", Year: &year,
		SpecificYieldCeiling: &ceiling, CellKM: &cell,
	}, "postgresql://db/x", "/tmp/run")
	if p["distribuidora"] != "Neoenergia_Cosern" || p["ano"] != 2024 ||
		p["specific_yield_ceiling_kwh_kwp"] != 1610.1 || p["br_store_dsn"] != "postgresql://db/x" ||
		p["cell_km"] != 0.5 || p["work_dir"] != "/tmp/run" {
		t.Errorf("got %v", p)
	}
}

func TestAnalyzeDemand_RefusesWhatCannotBeAYieldOrAYear(t *testing.T) {
	area := energy.Polygon{Type: "Polygon", Coordinates: [][][]float64{{{0, 0}, {1, 0}, {1, 1}, {0, 0}}}}
	zero, year := 0.0, 1024
	if _, err := AnalyzeDemand(context.Background(), nil,
		DemandRequest{Area: area, SpecificYieldCeiling: &zero}, "", "", nil, nil); err == nil {
		t.Error("a ceiling of zero was accepted")
	}
	if _, err := AnalyzeDemand(context.Background(), nil,
		DemandRequest{Area: area, Year: &year}, "", "", nil, nil); err == nil {
		t.Error("the year 1024 was accepted")
	}
	if _, err := AnalyzeDemand(context.Background(), nil,
		DemandRequest{Area: area, CellKM: &zero}, "", "", nil, nil); err == nil {
		t.Error("a cell of zero kilometres was accepted")
	}
}

// The reply the sidecar returned for an area over Natal, cut to its shape. A
// level the area holds no unit of is absent rather than zero, and the lists
// the interface walks are never null after decoding.
func TestDemandAnalysis_DecodesAReplyAndLeavesNoNullList(t *testing.T) {
	raw := []byte(`{"demand_area":{
	  "register":{"distribuidora":"Neoenergia_Cosern","ano":2024,"base":"BDGD Neoenergia_Cosern, ano-base 2024"},
	  "consumo":{"bt":{"unidades":540611,"energia_ano_mwh":1301788.0,
	    "energia_mensal_mwh":[113741.3,111988.7,113287.6,118141.5,112505.5,108366.1,
	                          98092.2,97100.4,100823.9,99842.6,105993.7,121904.6]},
	    "mt":null,"at":null},
	  "geracao":{"bt":{"unidades":23084,"potencia_instalada_kw":499111.0,
	    "potencia_instalada_plausivel_kw":482505.2,"energia_injetada_ano_mwh":192430.5,
	    "acima_do_teto":{"teto_kwh_kwp_ano":1610.1,"unidades":6589,"potencia_kw":16605.8,"nota":"x"}}},
	  "totais":{"energia_consumida_ano_mwh":2173874.6,"energia_injetada_ano_mwh":410043.4,
	            "injetada_sobre_consumida_pct":18.86},
	  "assumptions":{"energia_da_geracao":"injected","potencia_instalada":"mixed units",
	                 "posicao":"connection point",
	                 "teto_de_rendimento":{"valor_kwh_kwp_ano":1610.1,"origem":"request","nota":"x"}}}}`)
	var wrapped struct {
		Analysis *DemandAnalysis `json:"demand_area"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatal(err)
	}
	a := wrapped.Analysis
	normalizeDemand(a)
	if a.Consumption["bt"].Units != 540611 || len(a.Consumption["bt"].MonthlyMWh) != 12 {
		t.Errorf("low voltage consumption: %+v", a.Consumption["bt"])
	}
	if a.Consumption["mt"] != nil {
		t.Error("a level with no unit in the area should stay absent, not become zero")
	}
	g := a.Generation["bt"]
	if g.PlausibleInstalledKW >= g.InstalledKW || g.AboveCeiling.Units != 6589 {
		t.Errorf("generation: %+v", g)
	}
	if a.ByClass == nil || a.ByTown == nil || a.Register.Holdings == nil {
		t.Error("a null list survived decoding")
	}
	if a.Assumptions.Ceiling.Source != "request" {
		t.Errorf("the ceiling's origin was lost: %+v", a.Assumptions.Ceiling)
	}
}
