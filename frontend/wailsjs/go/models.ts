export namespace energy {
	
	export class Bounds {
	    lon_min: number;
	    lat_min: number;
	    lon_max: number;
	    lat_max: number;
	
	    static createFrom(source: any = {}) {
	        return new Bounds(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon_min = source["lon_min"];
	        this.lat_min = source["lat_min"];
	        this.lon_max = source["lon_max"];
	        this.lat_max = source["lat_max"];
	    }
	}
	export class TerrainDefaults {
	    hourly_years: number;
	    season: string;
	    seasons: string[];
	
	    static createFrom(source: any = {}) {
	        return new TerrainDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hourly_years = source["hourly_years"];
	        this.season = source["season"];
	        this.seasons = source["seasons"];
	    }
	}
	export class WindDefaults {
	    record_years: number;
	    hub_height_m: number;
	    calm_threshold_ms: number;
	    record_max_floor_ms: number;
	    roughness_band_m: number[];
	
	    static createFrom(source: any = {}) {
	        return new WindDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.record_years = source["record_years"];
	        this.hub_height_m = source["hub_height_m"];
	        this.calm_threshold_ms = source["calm_threshold_ms"];
	        this.record_max_floor_ms = source["record_max_floor_ms"];
	        this.roughness_band_m = source["roughness_band_m"];
	    }
	}
	export class SolarDefaults {
	    climatology_years: number;
	    hourly_years: number;
	    surface_azimuth: number;
	    performance_ratio: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.climatology_years = source["climatology_years"];
	        this.hourly_years = source["hourly_years"];
	        this.surface_azimuth = source["surface_azimuth"];
	        this.performance_ratio = source["performance_ratio"];
	    }
	}
	export class ParameterDefaults {
	    solar: SolarDefaults;
	    wind: WindDefaults;
	    terrain: TerrainDefaults;
	
	    static createFrom(source: any = {}) {
	        return new ParameterDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.solar = this.convertValues(source["solar"], SolarDefaults);
	        this.wind = this.convertValues(source["wind"], WindDefaults);
	        this.terrain = this.convertValues(source["terrain"], TerrainDefaults);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Polygon {
	    type: string;
	    coordinates: number[][][];
	
	    static createFrom(source: any = {}) {
	        return new Polygon(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.coordinates = source["coordinates"];
	    }
	}
	export class PowerSeriesProvenance {
	    source: string;
	    fetched_utc?: string;
	    product: string;
	    cell_key: string;
	    period: string;
	    cache_file?: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new PowerSeriesProvenance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = source["source"];
	        this.fetched_utc = source["fetched_utc"];
	        this.product = source["product"];
	        this.cell_key = source["cell_key"];
	        this.period = source["period"];
	        this.cache_file = source["cache_file"];
	        this.note = source["note"];
	    }
	}
	export class PowerProvenance {
	    daily?: PowerSeriesProvenance;
	    hourly?: PowerSeriesProvenance;
	
	    static createFrom(source: any = {}) {
	        return new PowerProvenance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.daily = this.convertValues(source["daily"], PowerSeriesProvenance);
	        this.hourly = this.convertValues(source["hourly"], PowerSeriesProvenance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class RenderScale {
	    palette: string;
	    min: number;
	    max: number;
	    reference?: number;
	    basis: string;
	    shared_with?: string;
	    decimals: number;
	    stops: string[];
	
	    static createFrom(source: any = {}) {
	        return new RenderScale(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.palette = source["palette"];
	        this.min = source["min"];
	        this.max = source["max"];
	        this.reference = source["reference"];
	        this.basis = source["basis"];
	        this.shared_with = source["shared_with"];
	        this.decimals = source["decimals"];
	        this.stops = source["stops"];
	    }
	}
	export class SkyView {
	    applied: boolean;
	    mean_horizon_deg: number;
	    max_horizon_deg: number;
	    threshold_deg: number;
	    diffuse_loss_mean_pct?: number;
	    diffuse_loss_max_pct?: number;
	
	    static createFrom(source: any = {}) {
	        return new SkyView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applied = source["applied"];
	        this.mean_horizon_deg = source["mean_horizon_deg"];
	        this.max_horizon_deg = source["max_horizon_deg"];
	        this.threshold_deg = source["threshold_deg"];
	        this.diffuse_loss_mean_pct = source["diffuse_loss_mean_pct"];
	        this.diffuse_loss_max_pct = source["diffuse_loss_max_pct"];
	    }
	}
	export class SolarPV {
	    specific_yield_kwh_kwp_year: number;
	    performance_ratio: number;
	    performance_ratio_source: string;
	    performance_ratio_modelled: number;
	    capacity_factor_pct: number;
	    hourly_years: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarPV(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.specific_yield_kwh_kwp_year = source["specific_yield_kwh_kwp_year"];
	        this.performance_ratio = source["performance_ratio"];
	        this.performance_ratio_source = source["performance_ratio_source"];
	        this.performance_ratio_modelled = source["performance_ratio_modelled"];
	        this.capacity_factor_pct = source["capacity_factor_pct"];
	        this.hourly_years = source["hourly_years"];
	    }
	}
	export class SolarTiltLoss {
	    deviation_deg: number;
	    loss_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarTiltLoss(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.deviation_deg = source["deviation_deg"];
	        this.loss_pct = source["loss_pct"];
	    }
	}
	export class SolarGeometry {
	    optimal_tilt_deg: number;
	    optimal_poa_kwh_m2_year: number;
	    surface_azimuth_deg: number;
	    gain_over_horizontal_pct: number;
	    tilt_tolerance: SolarTiltLoss[];
	
	    static createFrom(source: any = {}) {
	        return new SolarGeometry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.optimal_tilt_deg = source["optimal_tilt_deg"];
	        this.optimal_poa_kwh_m2_year = source["optimal_poa_kwh_m2_year"];
	        this.surface_azimuth_deg = source["surface_azimuth_deg"];
	        this.gain_over_horizontal_pct = source["gain_over_horizontal_pct"];
	        this.tilt_tolerance = this.convertValues(source["tilt_tolerance"], SolarTiltLoss);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarMonth {
	    month: number;
	    ghi?: number;
	    dni?: number;
	    dhi?: number;
	    kt?: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarMonth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.ghi = source["ghi"];
	        this.dni = source["dni"];
	        this.dhi = source["dhi"];
	        this.kt = source["kt"];
	    }
	}
	export class SolarResource {
	    ghi_annual_kwh_m2: number;
	    ghi_std: number;
	    ghi_cv_pct: number;
	    ghi_p10: number;
	    ghi_p90: number;
	    n_years: number;
	    trend_per_year: number;
	    trend_p_value: number;
	    clear_sky_index?: number;
	    monthly: SolarMonth[];
	
	    static createFrom(source: any = {}) {
	        return new SolarResource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ghi_annual_kwh_m2 = source["ghi_annual_kwh_m2"];
	        this.ghi_std = source["ghi_std"];
	        this.ghi_cv_pct = source["ghi_cv_pct"];
	        this.ghi_p10 = source["ghi_p10"];
	        this.ghi_p90 = source["ghi_p90"];
	        this.n_years = source["n_years"];
	        this.trend_per_year = source["trend_per_year"];
	        this.trend_p_value = source["trend_p_value"];
	        this.clear_sky_index = source["clear_sky_index"];
	        this.monthly = this.convertValues(source["monthly"], SolarMonth);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarAnalysis {
	    lon: number;
	    lat: number;
	    resource: SolarResource;
	    geometry: SolarGeometry;
	    pv: SolarPV;
	    grid_note: string;
	    power_provenance?: PowerProvenance;
	
	    static createFrom(source: any = {}) {
	        return new SolarAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.resource = this.convertValues(source["resource"], SolarResource);
	        this.geometry = this.convertValues(source["geometry"], SolarGeometry);
	        this.pv = this.convertValues(source["pv"], SolarPV);
	        this.grid_note = source["grid_note"];
	        this.power_provenance = this.convertValues(source["power_provenance"], PowerProvenance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	export class SolarRequest {
	    lon: number;
	    lat: number;
	    climatology_years?: number;
	    hourly_years?: number;
	    surface_azimuth?: number;
	    performance_ratio?: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.climatology_years = source["climatology_years"];
	        this.hourly_years = source["hourly_years"];
	        this.surface_azimuth = source["surface_azimuth"];
	        this.performance_ratio = source["performance_ratio"];
	    }
	}
	
	export class SolarTerrainAnalysis {
	    poa_min: number;
	    poa_max: number;
	    poa_mean: number;
	    poa_std_pct: number;
	    slope_mean_deg: number;
	    slope_max_deg: number;
	    pixels: number;
	    hourly_years: number;
	    dem_source: string;
	    season: string;
	    unit: string;
	    scale: RenderScale;
	    shading_mean_pct?: number;
	    shading_max_pct?: number;
	    horizon_max_dist_m: number;
	    beam_fraction: number;
	    sky_view?: SkyView;
	    overlay_url: string;
	    raster_tif: string;
	    extent: Bounds;
	    power_provenance?: PowerProvenance;
	
	    static createFrom(source: any = {}) {
	        return new SolarTerrainAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.poa_min = source["poa_min"];
	        this.poa_max = source["poa_max"];
	        this.poa_mean = source["poa_mean"];
	        this.poa_std_pct = source["poa_std_pct"];
	        this.slope_mean_deg = source["slope_mean_deg"];
	        this.slope_max_deg = source["slope_max_deg"];
	        this.pixels = source["pixels"];
	        this.hourly_years = source["hourly_years"];
	        this.dem_source = source["dem_source"];
	        this.season = source["season"];
	        this.unit = source["unit"];
	        this.scale = this.convertValues(source["scale"], RenderScale);
	        this.shading_mean_pct = source["shading_mean_pct"];
	        this.shading_max_pct = source["shading_max_pct"];
	        this.horizon_max_dist_m = source["horizon_max_dist_m"];
	        this.beam_fraction = source["beam_fraction"];
	        this.sky_view = this.convertValues(source["sky_view"], SkyView);
	        this.overlay_url = source["overlay_url"];
	        this.raster_tif = source["raster_tif"];
	        this.extent = this.convertValues(source["extent"], Bounds);
	        this.power_provenance = this.convertValues(source["power_provenance"], PowerProvenance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarTerrainRequest {
	    area: Polygon;
	    hourly_years?: number;
	    season?: string;
	
	    static createFrom(source: any = {}) {
	        return new SolarTerrainRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area = this.convertValues(source["area"], Polygon);
	        this.hourly_years = source["hourly_years"];
	        this.season = source["season"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class WindAssumptions {
	    hub_height_m: number;
	    hub_height_source: string;
	    record_years: number;
	    record_window: string;
	    shear_exponent: number;
	    shear_exponent_source: string;
	    roughness_band_m: number[];
	    calm_threshold_ms: number;
	    record_max_floor_ms: number;
	    qualifier: string;
	    excluded_losses: string[];
	    comparison_note: string;
	
	    static createFrom(source: any = {}) {
	        return new WindAssumptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hub_height_m = source["hub_height_m"];
	        this.hub_height_source = source["hub_height_source"];
	        this.record_years = source["record_years"];
	        this.record_window = source["record_window"];
	        this.shear_exponent = source["shear_exponent"];
	        this.shear_exponent_source = source["shear_exponent_source"];
	        this.roughness_band_m = source["roughness_band_m"];
	        this.calm_threshold_ms = source["calm_threshold_ms"];
	        this.record_max_floor_ms = source["record_max_floor_ms"];
	        this.qualifier = source["qualifier"];
	        this.excluded_losses = source["excluded_losses"];
	        this.comparison_note = source["comparison_note"];
	    }
	}
	export class WindTurbine {
	    name: string;
	    rated_power_w: number;
	    rotor_diameter_m: number;
	    hub_height_m: number;
	    blades: number;
	    iec_class: string;
	    turbulence_class: string;
	    cut_in_ms: number;
	    rated_speed_ms: number;
	    cut_out_ms: number;
	    power_curve_points: number;
	    power_curve_column: string;
	    citation: string;
	    citation_url: string;
	    curve_source_url: string;
	    curve_source_commit: string;
	
	    static createFrom(source: any = {}) {
	        return new WindTurbine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.rated_power_w = source["rated_power_w"];
	        this.rotor_diameter_m = source["rotor_diameter_m"];
	        this.hub_height_m = source["hub_height_m"];
	        this.blades = source["blades"];
	        this.iec_class = source["iec_class"];
	        this.turbulence_class = source["turbulence_class"];
	        this.cut_in_ms = source["cut_in_ms"];
	        this.rated_speed_ms = source["rated_speed_ms"];
	        this.cut_out_ms = source["cut_out_ms"];
	        this.power_curve_points = source["power_curve_points"];
	        this.power_curve_column = source["power_curve_column"];
	        this.citation = source["citation"];
	        this.citation_url = source["citation_url"];
	        this.curve_source_url = source["curve_source_url"];
	        this.curve_source_commit = source["curve_source_commit"];
	    }
	}
	export class WindShearDiagnostics {
	    shear_exponent: number;
	    implied_roughness_length_m?: number;
	    assumed_roughness_band_m: number[];
	    expected_shear_exponent_band: number[];
	    consistent_with_assumed_cover: boolean;
	    shear_exponent_hourly_mean: number;
	    shear_exponent_hourly_median: number;
	    shear_exponent_day: number;
	    shear_exponent_night: number;
	    local_utc_offset_hours: number;
	
	    static createFrom(source: any = {}) {
	        return new WindShearDiagnostics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shear_exponent = source["shear_exponent"];
	        this.implied_roughness_length_m = source["implied_roughness_length_m"];
	        this.assumed_roughness_band_m = source["assumed_roughness_band_m"];
	        this.expected_shear_exponent_band = source["expected_shear_exponent_band"];
	        this.consistent_with_assumed_cover = source["consistent_with_assumed_cover"];
	        this.shear_exponent_hourly_mean = source["shear_exponent_hourly_mean"];
	        this.shear_exponent_hourly_median = source["shear_exponent_hourly_median"];
	        this.shear_exponent_day = source["shear_exponent_day"];
	        this.shear_exponent_night = source["shear_exponent_night"];
	        this.local_utc_offset_hours = source["local_utc_offset_hours"];
	    }
	}
	export class WindDataQuality {
	    record_hours: number;
	    expected_hours: number;
	    mean_speed_ms: Record<string, number>;
	    calm_fraction_pct: Record<string, number>;
	    calm_threshold_ms: number;
	    record_maximum_ms: Record<string, number>;
	    record_maximum_floor_ms: number;
	    record_maximum_plausible: boolean;
	    calm_fraction_2m_flag_pct: number;
	    nan_count: Record<string, number>;
	    shear: WindShearDiagnostics;
	    flags: string[];
	    all_checks_passed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WindDataQuality(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.record_hours = source["record_hours"];
	        this.expected_hours = source["expected_hours"];
	        this.mean_speed_ms = source["mean_speed_ms"];
	        this.calm_fraction_pct = source["calm_fraction_pct"];
	        this.calm_threshold_ms = source["calm_threshold_ms"];
	        this.record_maximum_ms = source["record_maximum_ms"];
	        this.record_maximum_floor_ms = source["record_maximum_floor_ms"];
	        this.record_maximum_plausible = source["record_maximum_plausible"];
	        this.calm_fraction_2m_flag_pct = source["calm_fraction_2m_flag_pct"];
	        this.nan_count = source["nan_count"];
	        this.shear = this.convertValues(source["shear"], WindShearDiagnostics);
	        this.flags = source["flags"];
	        this.all_checks_passed = source["all_checks_passed"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WindShearRow {
	    shear_exponent: number;
	    roughness_length_m?: number;
	    basis: string;
	    hub_speed_ms: number;
	    capacity_factor_pct: number;
	    annual_energy_mwh: number;
	
	    static createFrom(source: any = {}) {
	        return new WindShearRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shear_exponent = source["shear_exponent"];
	        this.roughness_length_m = source["roughness_length_m"];
	        this.basis = source["basis"];
	        this.hub_speed_ms = source["hub_speed_ms"];
	        this.capacity_factor_pct = source["capacity_factor_pct"];
	        this.annual_energy_mwh = source["annual_energy_mwh"];
	    }
	}
	export class WindOperatingRegime {
	    above_cut_in_pct: number;
	    at_or_above_rated_pct: number;
	    above_cut_out_pct: number;
	    cut_in_ms: number;
	    rated_ms: number;
	    cut_out_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new WindOperatingRegime(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.above_cut_in_pct = source["above_cut_in_pct"];
	        this.at_or_above_rated_pct = source["at_or_above_rated_pct"];
	        this.above_cut_out_pct = source["above_cut_out_pct"];
	        this.cut_in_ms = source["cut_in_ms"];
	        this.rated_ms = source["rated_ms"];
	        this.cut_out_ms = source["cut_out_ms"];
	    }
	}
	export class WindExtrapolation {
	    hub_height_m: number;
	    interpolation_ceiling_m: number;
	    height_ratio: number;
	    is_extrapolation: boolean;
	    statement: string;
	
	    static createFrom(source: any = {}) {
	        return new WindExtrapolation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hub_height_m = source["hub_height_m"];
	        this.interpolation_ceiling_m = source["interpolation_ceiling_m"];
	        this.height_ratio = source["height_ratio"];
	        this.is_extrapolation = source["is_extrapolation"];
	        this.statement = source["statement"];
	    }
	}
	export class WindHub {
	    qualifier: string;
	    extrapolation: WindExtrapolation;
	    mean_speed_ms: number;
	    weibull_k: number;
	    weibull_c_ms: number;
	    wind_power_density_w_m2: number;
	    gross_capacity_factor_pct: number;
	    gross_capacity_factor_no_density_correction_pct: number;
	    gross_annual_energy_mwh_per_turbine: number;
	    operating_regime: WindOperatingRegime;
	    hours_per_year: number;
	    excluded_losses: string[];
	
	    static createFrom(source: any = {}) {
	        return new WindHub(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.qualifier = source["qualifier"];
	        this.extrapolation = this.convertValues(source["extrapolation"], WindExtrapolation);
	        this.mean_speed_ms = source["mean_speed_ms"];
	        this.weibull_k = source["weibull_k"];
	        this.weibull_c_ms = source["weibull_c_ms"];
	        this.wind_power_density_w_m2 = source["wind_power_density_w_m2"];
	        this.gross_capacity_factor_pct = source["gross_capacity_factor_pct"];
	        this.gross_capacity_factor_no_density_correction_pct = source["gross_capacity_factor_no_density_correction_pct"];
	        this.gross_annual_energy_mwh_per_turbine = source["gross_annual_energy_mwh_per_turbine"];
	        this.operating_regime = this.convertValues(source["operating_regime"], WindOperatingRegime);
	        this.hours_per_year = source["hours_per_year"];
	        this.excluded_losses = source["excluded_losses"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WindRoseSector {
	    sector: number;
	    centre_deg: number;
	    energy_pct: number;
	    hours_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new WindRoseSector(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sector = source["sector"];
	        this.centre_deg = source["centre_deg"];
	        this.energy_pct = source["energy_pct"];
	        this.hours_pct = source["hours_pct"];
	    }
	}
	export class WindDirection {
	    convention_note: string;
	    circular_mean_deg_10m: number;
	    circular_mean_deg_50m: number;
	    median_turning_deg: number;
	
	    static createFrom(source: any = {}) {
	        return new WindDirection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.convention_note = source["convention_note"];
	        this.circular_mean_deg_10m = source["circular_mean_deg_10m"];
	        this.circular_mean_deg_50m = source["circular_mean_deg_50m"];
	        this.median_turning_deg = source["median_turning_deg"];
	    }
	}
	export class WindMonthlySpeed {
	    month: number;
	    mean_speed_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new WindMonthlySpeed(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.mean_speed_ms = source["mean_speed_ms"];
	    }
	}
	export class WindWeibullFitCheck {
	    empirical_mean_ms: number;
	    weibull_mean_ms: number;
	    mean_error_pct: number;
	    empirical_mean_cube_m3s3: number;
	    weibull_mean_cube_m3s3: number;
	    mean_cube_error_pct: number;
	    estimator: string;
	
	    static createFrom(source: any = {}) {
	        return new WindWeibullFitCheck(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.empirical_mean_ms = source["empirical_mean_ms"];
	        this.weibull_mean_ms = source["weibull_mean_ms"];
	        this.mean_error_pct = source["mean_error_pct"];
	        this.empirical_mean_cube_m3s3 = source["empirical_mean_cube_m3s3"];
	        this.weibull_mean_cube_m3s3 = source["weibull_mean_cube_m3s3"];
	        this.mean_cube_error_pct = source["mean_cube_error_pct"];
	        this.estimator = source["estimator"];
	    }
	}
	export class WindMeasured {
	    qualifier: string;
	    mean_speed_10m_ms: number;
	    mean_speed_50m_ms: number;
	    shear_exponent: number;
	    weibull_k_50m: number;
	    weibull_c_50m_ms: number;
	    weibull_fit_check_50m: WindWeibullFitCheck;
	    energy_pattern_factor_50m: number;
	    wind_power_density_50m_w_m2: number;
	    air_density_mean_kg_m3: number;
	    air_density_min_kg_m3: number;
	    air_density_max_kg_m3: number;
	    monthly_mean_speed_50m: WindMonthlySpeed[];
	    direction: WindDirection;
	    direction_energy_rose_50m: WindRoseSector[];
	
	    static createFrom(source: any = {}) {
	        return new WindMeasured(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.qualifier = source["qualifier"];
	        this.mean_speed_10m_ms = source["mean_speed_10m_ms"];
	        this.mean_speed_50m_ms = source["mean_speed_50m_ms"];
	        this.shear_exponent = source["shear_exponent"];
	        this.weibull_k_50m = source["weibull_k_50m"];
	        this.weibull_c_50m_ms = source["weibull_c_50m_ms"];
	        this.weibull_fit_check_50m = this.convertValues(source["weibull_fit_check_50m"], WindWeibullFitCheck);
	        this.energy_pattern_factor_50m = source["energy_pattern_factor_50m"];
	        this.wind_power_density_50m_w_m2 = source["wind_power_density_50m_w_m2"];
	        this.air_density_mean_kg_m3 = source["air_density_mean_kg_m3"];
	        this.air_density_min_kg_m3 = source["air_density_min_kg_m3"];
	        this.air_density_max_kg_m3 = source["air_density_max_kg_m3"];
	        this.monthly_mean_speed_50m = this.convertValues(source["monthly_mean_speed_50m"], WindMonthlySpeed);
	        this.direction = this.convertValues(source["direction"], WindDirection);
	        this.direction_energy_rose_50m = this.convertValues(source["direction_energy_rose_50m"], WindRoseSector);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WindAnalysis {
	    lon: number;
	    lat: number;
	    grid_cell_centre: number[];
	    grid_note: string;
	    record_years: number;
	    record_window: string;
	    hub_height_m: number;
	    qualifier: string;
	    measured: WindMeasured;
	    hub: WindHub;
	    shear_sensitivity: WindShearRow[];
	    data_quality: WindDataQuality;
	    turbine: WindTurbine;
	    assumptions: WindAssumptions;
	    power_provenance?: PowerProvenance;
	
	    static createFrom(source: any = {}) {
	        return new WindAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.grid_cell_centre = source["grid_cell_centre"];
	        this.grid_note = source["grid_note"];
	        this.record_years = source["record_years"];
	        this.record_window = source["record_window"];
	        this.hub_height_m = source["hub_height_m"];
	        this.qualifier = source["qualifier"];
	        this.measured = this.convertValues(source["measured"], WindMeasured);
	        this.hub = this.convertValues(source["hub"], WindHub);
	        this.shear_sensitivity = this.convertValues(source["shear_sensitivity"], WindShearRow);
	        this.data_quality = this.convertValues(source["data_quality"], WindDataQuality);
	        this.turbine = this.convertValues(source["turbine"], WindTurbine);
	        this.assumptions = this.convertValues(source["assumptions"], WindAssumptions);
	        this.power_provenance = this.convertValues(source["power_provenance"], PowerProvenance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	
	
	
	
	export class WindRequest {
	    lon: number;
	    lat: number;
	    record_years?: number;
	    hub_height_m?: number;
	    calm_threshold_ms?: number;
	    record_max_floor_ms?: number;
	    roughness_band_m?: number[];
	
	    static createFrom(source: any = {}) {
	        return new WindRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.record_years = source["record_years"];
	        this.hub_height_m = source["hub_height_m"];
	        this.calm_threshold_ms = source["calm_threshold_ms"];
	        this.record_max_floor_ms = source["record_max_floor_ms"];
	        this.roughness_band_m = source["roughness_band_m"];
	    }
	}
	
	
	
	

}

export namespace main {
	
	export class OpenedProject {
	    path: string;
	    content: string;
	    run_dirs: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new OpenedProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.content = source["content"];
	        this.run_dirs = source["run_dirs"];
	    }
	}
	export class SidecarStatus {
	    ok: boolean;
	    python: string;
	    version?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new SidecarStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.python = source["python"];
	        this.version = source["version"];
	        this.error = source["error"];
	    }
	}

}

export namespace store {
	
	export class User {
	    id: string;
	    email: string;
	    display_name: string;
	    avatar_uri?: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new User(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.email = source["email"];
	        this.display_name = source["display_name"];
	        this.avatar_uri = source["avatar_uri"];
	        this.created_at = source["created_at"];
	    }
	}

}

