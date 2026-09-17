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
