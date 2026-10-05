package energy

// UsableGroundRequest asks how much of an area a plant could stand on, by two
// rules read off the elevation model. Optional fields are pointers for the
// reason given on SolarRequest: a zero height above the drainage is a rule the
// caller may set, and it switches the flood rule off.
type UsableGroundRequest struct {
	Area Polygon `json:"area"`
	// Ground steeper than this is excluded. Default 5.
	SlopeMaxDeg *float64 `json:"slope_max_deg,omitempty"`
	// Ground closer than this above its drainage is excluded. Default 5.
	HandMinM *float64 `json:"hand_min_m,omitempty"`
}

// GroundClass is one class of the usable-ground layer: usable, or the rule or
// rules that exclude a cell. The colour is the one the raster was drawn in, so
// a legend built from it cannot drift from the layer.
type GroundClass struct {
	Key     string  `json:"key"`
	Code    int     `json:"code"`
	Colour  string  `json:"colour"`
	AreaKM2 float64 `json:"area_km2"`
	// Of the measured area: the cells inside the area that carry an elevation,
	// water included.
	Pct float64 `json:"pct"`
	// Of the land inside it. Null for water, which is not land, and for every
	// class of an area that is all water.
	PctOfLand *float64 `json:"pct_of_land"`
}

// GroundWater says where the water came from and how much of the area that
// source saw. The attribution is the one its licence asks for.
type GroundWater struct {
	Source      string `json:"source"`
	Attribution string `json:"attribution"`
	// False where the map holds nothing over the area: no cell is water then,
	// and the water caveat says the sea is being counted as ground.
	Mapped bool `json:"mapped"`
	// Measured ground the map does not classify, counted as land.
	UnmappedKM2 float64 `json:"unmapped_km2"`
}

// GroundRules are the rules a run applied, the defaults filled in.
type GroundRules struct {
	SlopeMaxDeg float64 `json:"slope_max_deg"`
	HandMinM    float64 `json:"hand_min_m"`
	// The contributing area at which a cell counts as drainage. Not a rule the
	// reader types, but the excluded ground moves with it, so it is reported.
	DrainageKM2 float64 `json:"drainage_km2"`
}

// GroundStep is one point of a sensitivity curve: the share that would be
// usable had the rule been typed at Value, the other rule held where it was.
type GroundStep struct {
	Value     float64 `json:"value"`
	UsablePct float64 `json:"usable_pct"`
}

// GroundSensitivity is the two curves, one per rule.
type GroundSensitivity struct {
	Slope []GroundStep `json:"slope"`
	Hand  []GroundStep `json:"hand"`
}

// GroundCaveats are what the figures do not say, sent with every result so a
// figure is never shown without them.
type GroundCaveats struct {
	// The flood rule is a lower bound: the model is read over a buffer, not
	// over the watershed upstream.
	Hand string `json:"hand"`
	// What the water class is not, or that no water map covered the area.
	Water string `json:"water"`
}

// UsableGroundAnalysis is how much of the area neither rule excludes, and the
// ground each rule takes.
//
// Two denominators, and both are sent: the measured area, which is the ground
// the reader drew, and the land inside it, which is what is left once the
// permanent water is out. The rules are applied to the land alone, so every
// figure about a rule is of the land. Those are pointers because an area that
// is all water has no land to be a share of, and null is not zero.
type UsableGroundAnalysis struct {
	// The measured area: the cells inside the area that carry an elevation.
	AreaKM2  float64 `json:"area_km2"`
	LandKM2  float64 `json:"land_km2"`
	WaterKM2 float64 `json:"water_km2"`
	// Usable ground, and its share of the measured area and of the land.
	UsableKM2       float64  `json:"usable_km2"`
	UsablePct       float64  `json:"usable_pct"`
	UsableOfLandPct *float64 `json:"usable_of_land_pct"`
	// Inside the area and without an elevation. Not judged, so in no share.
	NoDataKM2 float64       `json:"no_data_km2"`
	Classes   []GroundClass `json:"classes"`
	// Each rule on its own, of the land; they overlap, so they do not sum to
	// the excluded share.
	ExcludedBySlopePct *float64 `json:"excluded_by_slope_pct"`
	ExcludedByFloodPct *float64 `json:"excluded_by_flood_pct"`
	// Of the land, with the other rule held where it was typed.
	Sensitivity  GroundSensitivity `json:"sensitivity"`
	Rules        GroundRules       `json:"rules"`
	Water        GroundWater       `json:"water"`
	SlopeMeanDeg *float64          `json:"slope_mean_deg"`
	SlopeMaxDeg  *float64          `json:"slope_max_deg"`
	HandMedianM  *float64          `json:"hand_median_m"`
	Pixels       int               `json:"pixels"`
	CellM        []float64         `json:"cell_m"`
	BufferM      float64           `json:"buffer_m"`
	DEMSource    string            `json:"dem_source"`
	Caveats      GroundCaveats     `json:"caveats"`
	// Where the webview loads the rendered layer from, as SolarTerrainAnalysis.
	OverlayURL string `json:"overlay_url"`
	// Absolute path of the uint8 GeoTIFF of classes, for export.
	RasterTIF string `json:"raster_tif"`
	Extent    Bounds `json:"extent"`
}
