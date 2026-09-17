package grid

import (
	"encoding/json"

	"github.com/rexionmars/TerraEnergyEngine/internal/energy"
)

// ---- The store --------------------------------------------------------------------

// StoreReport says which database the grid products read and whether it
// answered. It is always returned, never an error: an unreachable store is a
// state the settings screen shows, with the reason in Unreachable.
type StoreReport struct {
	// The connection, with any password masked.
	DSN string `json:"dsn"`
	// Where the DSN came from: SourceEnv, SourceChosen or SourceDefault.
	DSNSource   string    `json:"dsn_source"`
	Reachable   bool      `json:"reachable"`
	Unreachable string    `json:"unreachable,omitempty"`
	Coverage    *Coverage `json:"coverage,omitempty"`
}

// Coverage is the grid_coverage reply: what the store holds.
type Coverage struct {
	Datasets      []DatasetCoverage `json:"datasets"`
	Plants        PlantCoverage     `json:"plants"`
	Network       NetworkCoverage   `json:"network"`
	LoadConflicts LoadConflicts     `json:"load_conflicts"`
}

// DatasetCoverage is one ONS dataset as loaded: its periods ("2024-04"), its
// rows and when the newest period was loaded.
type DatasetCoverage struct {
	Dataset   string `json:"dataset"`
	Periods   int    `json:"periods"`
	From      string `json:"from"`
	To        string `json:"to"`
	Rows      int64  `json:"rows"`
	LoadedUTC string `json:"loaded_utc"`
}

type PlantCoverage struct {
	Registered   int `json:"registered"`
	WithGeometry int `json:"with_geometry"`
}

type NetworkCoverage struct {
	Substations    int `json:"substations"`
	LinesInService int `json:"lines_in_service"`
}

type LoadConflicts struct {
	Total     int    `json:"total"`
	Identical int    `json:"identical"`
	Note      string `json:"note"`
}

// ---- The layers -------------------------------------------------------------------

// PlantsLayer is the ANEEL plant register as a GeoJSON FeatureCollection of
// points, each with ceg, name, kind, uf, municipality, mw, since and metered.
// The collection is passed through undecoded: it is several megabytes the
// shell has no reason to read.
type PlantsLayer struct {
	GeoJSON json.RawMessage `json:"geojson" ts_type:"any"`
	Counts  PlantCounts     `json:"counts"`
	Note    string          `json:"note"`
}

type PlantCounts struct {
	Returned   int  `json:"returned"`
	Metered    int  `json:"metered"`
	Registered int  `json:"registered"`
	Located    int  `json:"located"`
	Truncated  bool `json:"truncated"`
}

// NetworkLayer is the ONS transmission register as two collections: lines
// (id, name, kv, mva, in_service, published_km, straight_km) and substation
// buses (bus, name, kv, uf, subsystem, operator).
type NetworkLayer struct {
	Lines       json.RawMessage `json:"lines" ts_type:"any"`
	Substations json.RawMessage `json:"substations" ts_type:"any"`
	Counts      NetworkCounts   `json:"counts"`
	RouteFactor RouteFactor     `json:"route_factor"`
	Note        string          `json:"note"`
}

type NetworkCounts struct {
	Lines           int `json:"lines"`
	LinesInService  int `json:"lines_in_service"`
	LinesWithRating int `json:"lines_with_rating"`
	Substations     int `json:"substations"`
}

// RouteFactor is how much longer a conductor runs than the straight segment
// the register draws it as.
type RouteFactor struct {
	Median float64 `json:"median"`
	P90    float64 `json:"p90"`
	Note   string  `json:"note,omitempty"`
}

// ---- The connection reading ---------------------------------------------------------

// ConnectionRequest asks where an area could join the transmission network.
type ConnectionRequest struct {
	Area energy.Polygon `json:"area"`
	// How far to search for substations and lines. Default 100 km.
	SearchRadiusKM *float64 `json:"search_radius_km,omitempty"`
}

// ConnectionAnalysis is the grid_congestion reply.
type ConnectionAnalysis struct {
	Connection Connection `json:"connection"`
	// What the plants already inside the area experienced; nil where no
	// metered plant stands in it, or where the store cannot say (see
	// CurtailmentAbsent).
	CurtailmentAtConnectedPlants *CurtailmentSummary `json:"curtailment_at_connected_plants"`
	// Why the curtailment half is missing, when the store lacks what it needs.
	CurtailmentAbsent string  `json:"curtailment_absent,omitempty"`
	Window            *Window `json:"window"`
	Note              string  `json:"note"`
}

// Connection is the network within reach of the area.
type Connection struct {
	Reachable  bool    `json:"reachable"`
	SearchedKM float64 `json:"searched_km"`
	// Where plants of the area are joined, as the operator publishes it.
	Attachment          []Attachment  `json:"attachment"`
	AttachedBusHeadroom []BusHeadroom `json:"attached_bus_headroom"`
	// Where the plants nearest the area are joined, when none stands in it.
	Neighbours           []Neighbour   `json:"neighbours"`
	NeighbourBusHeadroom []BusHeadroom `json:"neighbour_bus_headroom"`
	NearestSubstation    *Reach        `json:"nearest_substation"`
	NearestLine          *Reach        `json:"nearest_line"`
	Substations          []Reach       `json:"substations"`
	Lines                []Reach       `json:"lines"`
	HighestVoltageKV     *float64      `json:"highest_voltage_kv"`
	CapacityPublished    float64       `json:"capacity_published_fraction"`
	RouteFactor          RouteFactor   `json:"route_factor"`
	Source               string        `json:"source,omitempty"`
	Note                 string        `json:"note,omitempty"`
}

// Attachment is one metered unit of the area and the bus it enters at.
type Attachment struct {
	IDONS            string   `json:"id_ons"`
	Entity           string   `json:"entity"`
	PointCode        string   `json:"point_code"`
	PointName        string   `json:"point_name"`
	CapacityMW       *float64 `json:"capacity_mw"`
	Kind             string   `json:"kind"`
	DistanceKM       *float64 `json:"distance_km"`
	Bus              *int     `json:"bus"`
	Substation       *string  `json:"substation"`
	VoltageKV        *float64 `json:"voltage_kv"`
	VoltageConfirmed bool     `json:"voltage_confirmed"`
}

// Neighbour is a metered unit near the area and the bus it enters at.
type Neighbour struct {
	IDONS      string   `json:"id_ons"`
	Entity     string   `json:"entity"`
	PointCode  string   `json:"point_code"`
	PointName  string   `json:"point_name"`
	CapacityMW *float64 `json:"capacity_mw"`
	Kind       string   `json:"kind"`
	DistanceKM float64  `json:"distance_km"`
	Bus        *int     `json:"bus"`
	Substation *string  `json:"substation"`
	VoltageKV  *float64 `json:"voltage_kv"`
}

// BusHeadroom is what leaves a bus and what is already attached to it,
// reported apart and never combined.
type BusHeadroom struct {
	Bus                      int      `json:"bus"`
	LinesInService           int      `json:"lines_in_service"`
	LinesWithPublishedRating int      `json:"lines_with_published_rating"`
	LineCapacityMVA          *float64 `json:"line_capacity_mva"`
	UnitsAttached            int      `json:"units_attached"`
	AttachedMW               *float64 `json:"attached_mw"`
	Note                     string   `json:"note"`
}

// Reach is a substation or line and its distance from the area.
type Reach struct {
	Name        string   `json:"name"`
	DistanceKM  float64  `json:"distance_km"`
	VoltageKV   *float64 `json:"voltage_kv"`
	CapacityMVA *float64 `json:"capacity_mva,omitempty"`
}

// CurtailmentSummary is the energy withheld from the metered plants inside
// the area over the window.
type CurtailmentSummary struct {
	PlantsInAOI                  int      `json:"plants_in_aoi"`
	Window                       string   `json:"window"`
	ExpectedMWh                  float64  `json:"expected_mwh"`
	DeliveredMWh                 float64  `json:"delivered_mwh"`
	WithheldMWh                  float64  `json:"withheld_mwh"`
	WithheldFraction             *float64 `json:"withheld_fraction"`
	WithheldUnderRestrictionMWh  float64  `json:"withheld_under_restriction_mwh"`
	EstimateGapWhenFreeMWh       float64  `json:"estimate_gap_when_free_mwh"`
	Periods                      int64    `json:"periods"`
	PeriodsUnderRestriction      int64    `json:"periods_under_restriction"`
	RestrictedFraction           *float64 `json:"restricted_fraction"`
	TopReason                    *string  `json:"top_reason"`
	TopOrigin                    *string  `json:"top_origin"`
	UnrestrictedBaselineFraction *float64 `json:"unrestricted_baseline_fraction"`
	Kind                         string   `json:"kind"`
	Basis                        string   `json:"basis"`
	Source                       string   `json:"source"`
}

// Window is the span a reading covers: requested, held by the store, and used.
type Window struct {
	Requested []*string `json:"requested"`
	Record    []string  `json:"record"`
	Used      []string  `json:"used"`
}
