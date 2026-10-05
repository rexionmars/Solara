package weather

import (
	"context"
	"strings"
	"testing"
)

func TestDecodeWindField(t *testing.T) {
	raw := `{"wind_field": {"height_m": 10, "valid": "2026-09-17T15:00:00Z", "run": "2026-09-17T06:00:00Z",
		"lon0": -60, "lat0": 10, "dlon": 0.5, "dlat": 0.5, "nx": 2, "ny": 2,
		"u": [1, null, 3, 4], "v": [0, 0, 0, 0], "source": "s", "note": "n"}}`
	f, err := decodeWindField([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if f.U[1] != nil || *f.U[2] != 3 || *f.Run != "2026-09-17T06:00:00Z" {
		t.Errorf("got %+v", f)
	}
}

func TestDecodeWindField_RefusesAGridThatDoesNotMatchItsShape(t *testing.T) {
	for name, raw := range map[string]string{
		"short arrays": `{"wind_field": {"nx": 2, "ny": 2, "dlon": 0.5, "dlat": 0.5, "u": [1, 2, 3], "v": [1, 2, 3, 4]}}`,
		"no spacing":   `{"wind_field": {"nx": 2, "ny": 2, "dlon": 0, "dlat": 0.5, "u": [1, 2, 3, 4], "v": [1, 2, 3, 4]}}`,
		"no field":     `{}`,
	} {
		if _, err := decodeWindField([]byte(raw)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestFetchWindField_RefusesAnUnreadHeightBeforeStartingTheSidecar(t *testing.T) {
	_, err := FetchWindField(context.Background(), nil, 50, nil, "")
	if err == nil || !strings.Contains(err.Error(), "50 m") {
		t.Fatalf("got %v", err)
	}
}
