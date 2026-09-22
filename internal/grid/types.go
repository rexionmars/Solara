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

// ---- The demand reading -------------------------------------------------------------

// DemandRequest asks what an area already draws from the network.
type DemandRequest struct {
	Area energy.Polygon `json:"area"`
	// Which register to read. A store holding one distributor needs neither;
	// holding several, the reading refuses to guess.
	Distribuidora string `json:"distribuidora,omitempty"`
	Year          *int   `json:"ano,omitempty"`
	// The specific yield the solar product read at this place, in
	// kWh/kWp/year. A generator reporting more than this has a register error.
	// Absent, the reading applies a convention and says so.
	SpecificYieldCeiling *float64 `json:"specific_yield_ceiling_kwh_kwp,omitempty"`
	// The density layer's cell, in kilometres. Default 1.
	CellKM *float64 `json:"cell_km,omitempty"`
}

// DemandAnalysis is the demand_area reply.
type DemandAnalysis struct {
	Register DemandRegister `json:"register"`
	// By voltage level: bt, mt, at. A level with no unit in the area is absent.
	Consumption map[string]*DemandConsumption `json:"consumo"`
	Generation  map[string]*DemandGeneration  `json:"geracao"`
	Totals      DemandTotals                  `json:"totais"`
	// What the figures say, as quantities the reading states in words.
	Findings DemandFindings `json:"analise"`
	// Where inside the area the consumption fell, as a layer for the map.
	// Absent where no unit of the register stands in the area.
	Density     *DemandDensity    `json:"density"`
	ByClass     []DemandByGroup   `json:"por_classe"`
	ByTown      []DemandByGroup   `json:"por_municipio"`
	Assumptions DemandAssumptions `json:"assumptions"`
}

// DemandFindings is what is derived from the registers rather than read off
// them: how the year swings, how gathered the load is, what the rooftops
// already cover and how far the register can be trusted. Each part is absent
// where the area holds nothing to derive it from.
type DemandFindings struct {
	Seasonality   *DemandSeasonality   `json:"sazonalidade"`
	Mix           *DemandMix           `json:"mix"`
	Trust         *DemandTrust         `json:"confianca_do_registro"`
	Concentration *DemandConcentration `json:"concentracao"`
	CentreOfLoad  *DemandCentre        `json:"centro_de_carga"`
}

// DemandSeasonality is the year's swing, in the register's own months.
type DemandSeasonality struct {
	PeakMonth    int      `json:"mes_pico"`
	TroughMonth  int      `json:"mes_vale"`
	PeakMWh      float64  `json:"pico_mwh"`
	TroughMWh    float64  `json:"vale_mwh"`
	AmplitudePct *float64 `json:"amplitude_pct"`
}

// DemandMix is the class that leads the area, by energy and by unit count.
type DemandMix struct {
	Class     string  `json:"classe"`
	EnergyPct float64 `json:"pct_da_energia"`
	UnitsPct  float64 `json:"pct_das_unidades"`
}

// DemandTrust counts the generators whose declaration cannot be true, and what
// share of the declared power they hold.
type DemandTrust struct {
	Impossible    int     `json:"geradores_impossiveis"`
	Generators    int     `json:"geradores"`
	GeneratorsPct float64 `json:"pct_dos_geradores"`
	PowerPct      float64 `json:"pct_da_potencia"`
}

// DemandConcentration is how little ground holds how much of the consumption.
type DemandConcentration struct {
	CellsForHalf int     `json:"celulas_com_metade"`
	KM2ForHalf   float64 `json:"km2_com_metade"`
	CellsPct     float64 `json:"pct_das_celulas_ocupadas"`
	TopDecilePct float64 `json:"decil_superior_pct"`
}

// DemandCentre is the consumption-weighted middle of the area, and how far it
// stands from the area's own middle.
type DemandCentre struct {
	Lon      float64 `json:"lon"`
	Lat      float64 `json:"lat"`
	OffsetKM float64 `json:"desloc_km"`
	Bearing  string  `json:"rumo"`
}

// DemandDensity is the consumption per cell, drawn over the area.
//
// The cell holds the units whose connection point falls in it, so it maps the
// network's load at the network's own resolution, not consumption per hectare
// of ground. An empty cell is transparent, never zero.
type DemandDensity struct {
	// Where the webview loads the rendered layer from, and the path the
	// sidecar wrote it at, which is cleared once the URL is built.
	OverlayURL string             `json:"overlay_url"`
	OverlayPNG string             `json:"overlay_png,omitempty"`
	Extent     energy.Bounds      `json:"extent"`
	Scale      energy.RenderScale `json:"scale"`
	CellKM     float64            `json:"cell_km"`
	// Cells that hold at least one unit, of the grid below.
	Cells int        `json:"cells"`
	Grid  DemandGrid `json:"grid"`
	Unit  string     `json:"unit"`
	Note  string     `json:"note"`
}

// DemandGrid is the layer's shape in cells.
type DemandGrid struct {
	NX int `json:"nx"`
	NY int `json:"ny"`
}

// DemandRegister says which BDGD this reading counted.
type DemandRegister struct {
	Distribuidora string          `json:"distribuidora"`
	Year          int             `json:"ano"`
	Base          string          `json:"base"`
	Holdings      []DemandHolding `json:"holdings"`
}

// DemandHolding is one register the store carries.
type DemandHolding struct {
	Distribuidora string `json:"distribuidora"`
	Year          int    `json:"ano"`
	Units         int    `json:"unidades"`
	// Units the register could not place; they cannot fall inside any area.
	Unplaced int `json:"sem_ponto"`
}

// DemandConsumption is one voltage level's consumer units inside the area.
type DemandConsumption struct {
	Units      int       `json:"unidades"`
	EnergyMWh  float64   `json:"energia_ano_mwh"`
	MonthlyMWh []float64 `json:"energia_mensal_mwh"`
}

// DemandGeneration is what the area generates behind the meter. The energy is
// what reached the network, not what was generated: see Assumptions.
type DemandGeneration struct {
	Units int `json:"unidades"`
	// What the register says, and what is left of it once the rows that
	// cannot be true are set aside.
	InstalledKW          float64     `json:"potencia_instalada_kw"`
	PlausibleInstalledKW float64     `json:"potencia_instalada_plausivel_kw"`
	InjectedMWh          float64     `json:"energia_injetada_ano_mwh"`
	AboveCeiling         DemandAbove `json:"acima_do_teto"`
	// Up to a few thousand rows as [installed kW, energy MWh], so the reading
	// can draw the register against its ceiling rather than only count it.
	// Ordered by a hash of the identifier: the same area draws the same cloud.
	Sample [][]float64 `json:"amostra"`
}

// DemandAbove counts the generators that report more than their site can make.
type DemandAbove struct {
	CeilingKWhKWp float64 `json:"teto_kwh_kwp_ano"`
	Units         int     `json:"unidades"`
	PowerKW       float64 `json:"potencia_kw"`
	Note          string  `json:"nota"`
}

// DemandTotals is the area's consumption and what its own generation put back.
type DemandTotals struct {
	ConsumedMWh float64  `json:"energia_consumida_ano_mwh"`
	InjectedMWh float64  `json:"energia_injetada_ano_mwh"`
	InjectedPct *float64 `json:"injetada_sobre_consumida_pct"`
}

// DemandByGroup is consumption cut by class or by town.
type DemandByGroup struct {
	Class     string  `json:"clas_sub,omitempty"`
	Town      string  `json:"mun,omitempty"`
	Units     int     `json:"unidades"`
	EnergyMWh float64 `json:"energia_ano_mwh"`
}

// DemandAssumptions is what the reading had to assume to answer, in the words
// it reports them: none of it is corrected silently.
type DemandAssumptions struct {
	GenerationEnergy string        `json:"energia_da_geracao"`
	InstalledPower   string        `json:"potencia_instalada"`
	Position         string        `json:"posicao"`
	Ceiling          DemandCeiling `json:"teto_de_rendimento"`
}

// DemandCeiling is the yield a generator is audited against, and where it came
// from: the solar product at this place, or the product's own convention.
type DemandCeiling struct {
	ValueKWhKWp float64 `json:"valor_kwh_kwp_ano"`
	Source      string  `json:"origem"`
	Note        string  `json:"nota"`
}
