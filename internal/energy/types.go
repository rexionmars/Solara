package energy

// The request and result types of the two energy actions. Ported from TERRA's
// internal/analysis/types.go (solar) and types_wind.go (wind). The result
// fields are TERRA's, because the sidecar computing them is TERRA's; the
// requests differ, as described on each.

// SolarRequest asks for the solar resource at a site. The radiation grid is 1
// degree, so the request resolves to the cell the site falls in.
//
// The optional fields are pointers so an unset field is omitted from the
// sidecar request rather than sent as zero. TERRA sent every field, and an
// unset ClimatologyYears arrived as 0, which the sidecar refuses.
type SolarRequest struct {
	Lon float64 `json:"lon"`
	Lat float64 `json:"lat"`
	// Default 30.
	ClimatologyYears *int `json:"climatology_years,omitempty"`
	// Default 10.
	HourlyYears *int `json:"hourly_years,omitempty"`
	// Degrees from north. Default 0, which faces the equator in the southern
	// hemisphere.
	SurfaceAzimuth *float64 `json:"surface_azimuth,omitempty"`
	// Null applies the reference ratio; a value in (0, 1] overrides it. The
	// response always reports which was used.
	PerformanceRatio *float64 `json:"performance_ratio,omitempty"`
}

// SolarMonth is one calendar month of the radiation climatology, as daily means.
type SolarMonth struct {
	Month int      `json:"month"`
	GHI   *float64 `json:"ghi"`
	DNI   *float64 `json:"dni"`
	DHI   *float64 `json:"dhi"`
	KT    *float64 `json:"kt"`
}

// SolarResource is the long-term radiation climatology at the point.
type SolarResource struct {
	GHIAnnualKWhM2 float64      `json:"ghi_annual_kwh_m2"`
	GHIStd         float64      `json:"ghi_std"`
	GHICVPct       float64      `json:"ghi_cv_pct"`
	GHIP10         float64      `json:"ghi_p10"`
	GHIP90         float64      `json:"ghi_p90"`
	NYears         int          `json:"n_years"`
	TrendPerYear   float64      `json:"trend_per_year"`
	TrendPValue    float64      `json:"trend_p_value"`
	ClearSkyIndex  *float64     `json:"clear_sky_index"`
	Monthly        []SolarMonth `json:"monthly"`
}

// SolarTiltLoss is the insolation lost by deviating from the optimum tilt.
type SolarTiltLoss struct {
	DeviationDeg float64 `json:"deviation_deg"`
	LossPct      float64 `json:"loss_pct"`
}

// SolarGeometry is the fixed-tilt optimum for the point.
type SolarGeometry struct {
	OptimalTiltDeg        float64         `json:"optimal_tilt_deg"`
	OptimalPOAKWhM2Year   float64         `json:"optimal_poa_kwh_m2_year"`
	SurfaceAzimuthDeg     float64         `json:"surface_azimuth_deg"`
	GainOverHorizontalPct float64         `json:"gain_over_horizontal_pct"`
	TiltTolerance         []SolarTiltLoss `json:"tilt_tolerance"`
}

// SolarPV is the photovoltaic yield for a 1 kWp reference array.
type SolarPV struct {
	SpecificYieldKWhKWpYear float64 `json:"specific_yield_kwh_kwp_year"`
	// The ratio applied to produce the yield, and where it came from:
	// "reference" or "user".
	PerformanceRatio       float64 `json:"performance_ratio"`
	PerformanceRatioSource string  `json:"performance_ratio_source"`
	// What the chain models. It runs high because soiling, inter-row shading,
	// degradation, availability and cabling are not modelled, so it is reported
	// for comparison rather than applied.
	PerformanceRatioModelled float64 `json:"performance_ratio_modelled"`
	CapacityFactorPct        float64 `json:"capacity_factor_pct"`
	HourlyYears              int     `json:"hourly_years"`
}

// PowerSeriesProvenance records which NASA POWER series a run read and when it
// was retrieved. POWER reprocesses historical data and the cache never
// expires, so a cached series can be a superseded revision; the run says which
// it was.
type PowerSeriesProvenance struct {
	// "fetch", "cache", or "fetch_uncached".
	Source string `json:"source"`
	// Absent for a cached series written before the stamp was recorded.
	FetchedUTC *string `json:"fetched_utc"`
	Product    string  `json:"product"`
	CellKey    string  `json:"cell_key"`
	Period     string  `json:"period"`
	CacheFile  *string `json:"cache_file"`
	Note       string  `json:"note"`
}

// PowerProvenance carries the record for each temporal product a run read. An
// action that reads only one leaves the other absent.
type PowerProvenance struct {
	Daily  *PowerSeriesProvenance `json:"daily,omitempty"`
	Hourly *PowerSeriesProvenance `json:"hourly,omitempty"`
}

// SolarAnalysis is a solar resource result.
type SolarAnalysis struct {
	// The radiation request point the site resolved to.
	Lon      float64       `json:"lon"`
	Lat      float64       `json:"lat"`
	Resource SolarResource `json:"resource"`
	Geometry SolarGeometry `json:"geometry"`
	PV       SolarPV       `json:"pv"`
	// States the grid the figures resolve on. A per-site number shown without
	// it reads as local.
	GridNote        string           `json:"grid_note"`
	PowerProvenance *PowerProvenance `json:"power_provenance,omitempty"`
}

// WindRequest asks for a wind resource screening at a site. The reanalysis cell
// is 0.5 by 0.625 degrees, so the response reports the cell centre, not the
// site. Optional fields are pointers for the reason given on SolarRequest.
type WindRequest struct {
	Lon float64 `json:"lon"`
	Lat float64 `json:"lat"`
	// Default 10.
	RecordYears *int `json:"record_years,omitempty"`
	// Default 110 m, the reference turbine's hub. No turbine has been selected
	// for any site.
	HubHeightM *float64 `json:"hub_height_m,omitempty"`
	// Default 0.5 m/s. Zero is a value: no hour counts as calm.
	CalmThresholdMS *float64 `json:"calm_threshold_ms,omitempty"`
	// Default 10 m/s. Zero is a value: the record maximum needs no floor.
	RecordMaxFloorMS *float64 `json:"record_max_floor_ms,omitempty"`
	// Two roughness lengths in metres, the assumed land-cover band the derived
	// shear exponent is checked against. Default [0.03, 0.10].
	RoughnessBandM []float64 `json:"roughness_band_m,omitempty"`
}

// WindWeibullFitCheck compares the fitted distribution against the record on
// the mean and on the mean cube, which is what the power calculation uses.
type WindWeibullFitCheck struct {
	EmpiricalMeanMS       float64 `json:"empirical_mean_ms"`
	WeibullMeanMS         float64 `json:"weibull_mean_ms"`
	MeanErrorPct          float64 `json:"mean_error_pct"`
	EmpiricalMeanCubeM3S3 float64 `json:"empirical_mean_cube_m3s3"`
	WeibullMeanCubeM3S3   float64 `json:"weibull_mean_cube_m3s3"`
	MeanCubeErrorPct      float64 `json:"mean_cube_error_pct"`
	Estimator             string  `json:"estimator"`
}

// WindMonthlySpeed is one calendar month of the 50 m mean speed.
type WindMonthlySpeed struct {
	Month       int     `json:"month"`
	MeanSpeedMS float64 `json:"mean_speed_ms"`
}

// WindDirection reports the circular means, as the direction the wind comes from.
type WindDirection struct {
	ConventionNote     string  `json:"convention_note"`
	CircularMeanDeg10m float64 `json:"circular_mean_deg_10m"`
	CircularMeanDeg50m float64 `json:"circular_mean_deg_50m"`
	MedianTurningDeg   float64 `json:"median_turning_deg"`
}

// WindRoseSector is one of the sixteen sectors of the energy rose. EnergyPct
// and HoursPct differ because energy goes as the cube of the speed.
type WindRoseSector struct {
	Sector    int     `json:"sector"`
	CentreDeg float64 `json:"centre_deg"`
	EnergyPct float64 `json:"energy_pct"`
	HoursPct  float64 `json:"hours_pct"`
}

// WindMeasured are the quantities the reanalysis carries at 10 m and 50 m,
// with no extrapolation.
type WindMeasured struct {
	Qualifier              string              `json:"qualifier"`
	MeanSpeed10mMS         float64             `json:"mean_speed_10m_ms"`
	MeanSpeed50mMS         float64             `json:"mean_speed_50m_ms"`
	ShearExponent          float64             `json:"shear_exponent"`
	WeibullK50m            float64             `json:"weibull_k_50m"`
	WeibullC50mMS          float64             `json:"weibull_c_50m_ms"`
	WeibullFitCheck50m     WindWeibullFitCheck `json:"weibull_fit_check_50m"`
	EnergyPatternFactor50m float64             `json:"energy_pattern_factor_50m"`
	WindPowerDensity50mWM2 float64             `json:"wind_power_density_50m_w_m2"`
	AirDensityMeanKgM3     float64             `json:"air_density_mean_kg_m3"`
	AirDensityMinKgM3      float64             `json:"air_density_min_kg_m3"`
	AirDensityMaxKgM3      float64             `json:"air_density_max_kg_m3"`
	MonthlyMeanSpeed50m    []WindMonthlySpeed  `json:"monthly_mean_speed_50m"`
	Direction              WindDirection       `json:"direction"`
	DirectionEnergyRose50m []WindRoseSector    `json:"direction_energy_rose_50m"`
}

// WindExtrapolation states how far above the highest measured level (50 m) the
// hub figures sit.
type WindExtrapolation struct {
	HubHeightM            float64 `json:"hub_height_m"`
	InterpolationCeilingM float64 `json:"interpolation_ceiling_m"`
	HeightRatio           float64 `json:"height_ratio"`
	IsExtrapolation       bool    `json:"is_extrapolation"`
	Statement             string  `json:"statement"`
}

// WindOperatingRegime is the share of hours in each part of the power curve.
type WindOperatingRegime struct {
	AboveCutInPct     float64 `json:"above_cut_in_pct"`
	AtOrAboveRatedPct float64 `json:"at_or_above_rated_pct"`
	AboveCutOutPct    float64 `json:"above_cut_out_pct"`
	CutInMS           float64 `json:"cut_in_ms"`
	RatedMS           float64 `json:"rated_ms"`
	CutOutMS          float64 `json:"cut_out_ms"`
}

// WindHub is the hub-height result. Gross: no wake, availability, electrical,
// icing or curtailment loss is applied, and there is no external validation.
type WindHub struct {
	Qualifier                                 string              `json:"qualifier"`
	Extrapolation                             WindExtrapolation   `json:"extrapolation"`
	MeanSpeedMS                               float64             `json:"mean_speed_ms"`
	WeibullK                                  float64             `json:"weibull_k"`
	WeibullCMS                                float64             `json:"weibull_c_ms"`
	WindPowerDensityWM2                       float64             `json:"wind_power_density_w_m2"`
	GrossCapacityFactorPct                    float64             `json:"gross_capacity_factor_pct"`
	GrossCapacityFactorNoDensityCorrectionPct float64             `json:"gross_capacity_factor_no_density_correction_pct"`
	GrossAnnualEnergyMWhPerTurbine            float64             `json:"gross_annual_energy_mwh_per_turbine"`
	OperatingRegime                           WindOperatingRegime `json:"operating_regime"`
	HoursPerYear                              float64             `json:"hours_per_year"`
	ExcludedLosses                            []string            `json:"excluded_losses"`
}

// WindShearRow is the hub result under one shear assumption. RoughnessLengthM
// is null on the row derived from the record itself.
type WindShearRow struct {
	ShearExponent     float64  `json:"shear_exponent"`
	RoughnessLengthM  *float64 `json:"roughness_length_m"`
	Basis             string   `json:"basis"`
	HubSpeedMS        float64  `json:"hub_speed_ms"`
	CapacityFactorPct float64  `json:"capacity_factor_pct"`
	AnnualEnergyMWh   float64  `json:"annual_energy_mwh"`
}

// WindShearDiagnostics inverts the derived shear exponent to a roughness length
// and checks it against the assumed land cover.
type WindShearDiagnostics struct {
	ShearExponent float64 `json:"shear_exponent"`
	// Null when the shear falls outside the range the log profile can invert.
	// A bare float64 would decode that null as a roughness of 0 m, which TERRA
	// printed once.
	ImpliedRoughnessLengthM    *float64  `json:"implied_roughness_length_m"`
	AssumedRoughnessBandM      []float64 `json:"assumed_roughness_band_m"`
	ExpectedShearExponentBand  []float64 `json:"expected_shear_exponent_band"`
	ConsistentWithAssumedCover bool      `json:"consistent_with_assumed_cover"`
	ShearExponentHourlyMean    float64   `json:"shear_exponent_hourly_mean"`
	ShearExponentHourlyMedian  float64   `json:"shear_exponent_hourly_median"`
	ShearExponentDay           float64   `json:"shear_exponent_day"`
	ShearExponentNight         float64   `json:"shear_exponent_night"`
	LocalUTCOffsetHours        int       `json:"local_utc_offset_hours"`
}

// WindDataQuality is the record's own account of itself. AllChecksPassed false
// with a populated Flags list means the hub figures rest on a series the checks
// do not support.
type WindDataQuality struct {
	RecordHours            int                  `json:"record_hours"`
	ExpectedHours          int                  `json:"expected_hours"`
	MeanSpeedMS            map[string]float64   `json:"mean_speed_ms"`
	CalmFractionPct        map[string]float64   `json:"calm_fraction_pct"`
	CalmThresholdMS        float64              `json:"calm_threshold_ms"`
	RecordMaximumMS        map[string]float64   `json:"record_maximum_ms"`
	RecordMaximumFloorMS   float64              `json:"record_maximum_floor_ms"`
	RecordMaximumPlausible bool                 `json:"record_maximum_plausible"`
	CalmFraction2mFlagPct  float64              `json:"calm_fraction_2m_flag_pct"`
	NaNCount               map[string]int       `json:"nan_count"`
	Shear                  WindShearDiagnostics `json:"shear"`
	Flags                  []string             `json:"flags"`
	AllChecksPassed        bool                 `json:"all_checks_passed"`
}

// WindTurbine is the reference power curve the capacity factor was computed on:
// a reference turbine, not a selection for this site.
type WindTurbine struct {
	Name              string  `json:"name"`
	RatedPowerW       float64 `json:"rated_power_w"`
	RotorDiameterM    float64 `json:"rotor_diameter_m"`
	HubHeightM        float64 `json:"hub_height_m"`
	Blades            int     `json:"blades"`
	IECClass          string  `json:"iec_class"`
	TurbulenceClass   string  `json:"turbulence_class"`
	CutInMS           float64 `json:"cut_in_ms"`
	RatedSpeedMS      float64 `json:"rated_speed_ms"`
	CutOutMS          float64 `json:"cut_out_ms"`
	PowerCurvePoints  int     `json:"power_curve_points"`
	PowerCurveColumn  string  `json:"power_curve_column"`
	Citation          string  `json:"citation"`
	CitationURL       string  `json:"citation_url"`
	CurveSourceURL    string  `json:"curve_source_url"`
	CurveSourceCommit string  `json:"curve_source_commit"`
}

// WindAssumptions repeats the conventions the figures rest on, including that
// the wind capacity factor is not comparable with the photovoltaic one.
type WindAssumptions struct {
	HubHeightM          float64   `json:"hub_height_m"`
	HubHeightSource     string    `json:"hub_height_source"`
	RecordYears         int       `json:"record_years"`
	RecordWindow        string    `json:"record_window"`
	ShearExponent       float64   `json:"shear_exponent"`
	ShearExponentSource string    `json:"shear_exponent_source"`
	RoughnessBandM      []float64 `json:"roughness_band_m"`
	CalmThresholdMS     float64   `json:"calm_threshold_ms"`
	RecordMaxFloorMS    float64   `json:"record_max_floor_ms"`
	Qualifier           string    `json:"qualifier"`
	ExcludedLosses      []string  `json:"excluded_losses"`
	ComparisonNote      string    `json:"comparison_note"`
}

// WindAnalysis is a wind resource screening: an indication, not an assessment.
// The hub figures are gross, carry no external validation, and rest on an
// extrapolation above the highest level the data carries.
type WindAnalysis struct {
	Lon float64 `json:"lon"`
	Lat float64 `json:"lat"`
	// Centre of the reanalysis cell the site resolves to, [lon, lat].
	GridCellCentre []float64 `json:"grid_cell_centre"`
	GridNote       string    `json:"grid_note"`
	RecordYears    float64   `json:"record_years"`
	RecordWindow   string    `json:"record_window"`
	HubHeightM     float64   `json:"hub_height_m"`
	Qualifier      string    `json:"qualifier"`

	Measured         WindMeasured     `json:"measured"`
	Hub              WindHub          `json:"hub"`
	ShearSensitivity []WindShearRow   `json:"shear_sensitivity"`
	DataQuality      WindDataQuality  `json:"data_quality"`
	Turbine          WindTurbine      `json:"turbine"`
	Assumptions      WindAssumptions  `json:"assumptions"`
	PowerProvenance  *PowerProvenance `json:"power_provenance,omitempty"`
}
