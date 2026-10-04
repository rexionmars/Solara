-- The Solara store contract, version 1.
--
-- A PostgreSQL database with PostGIS that holds these tables, in a schema
-- named `solara`, is a store Solara can read. Whoever prepares the store fills
-- them; Solara only ever reads. Run this file once in an empty database (or
-- beside your own tables) and load your data into what it creates, or create
-- VIEWS with these names and columns over tables you already have: Solara
-- cannot tell the difference and does not need to.
--
-- EVERY TABLE EXCEPT solara.contract IS OPTIONAL. What is present is what the
-- store can do: with no solara.line there is no line layer and no connection
-- reading, and Solara says so rather than failing.
--
-- UNITS AND PROJECTION ARE FIXED, and converting is the preparer's work: MW,
-- kV, MVA, and every geometry in EPSG:4326 (longitude, latitude; WGS84).
--
-- The column names for plants follow powerplantmatching, and for the network
-- PyPSA and earth-osm, so data already prepared for those tools maps across
-- with a rename. See contract/README.md.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS solara;

-- One row: which contract this store follows and what it is.
CREATE TABLE IF NOT EXISTS solara.contract (
    version     integer     NOT NULL,           -- 1
    name        text        NOT NULL,           -- "Italia: WRI + OSM", shown on the Grid store card
    prepared_at timestamptz NOT NULL DEFAULT now(),
    sources     text,                           -- where the data came from, and its licences
    notes       text                            -- anything a reader of this store should know
);

-- Power plants, one row per plant.
CREATE TABLE IF NOT EXISTS solara.plant (
    id                text PRIMARY KEY,
    name              text,
    -- One of: Hydro, Solar, Wind, Nuclear, Natural Gas, Hard Coal, Lignite,
    -- Oil, Solid Biomass, Biogas, Geothermal, Other.
    fueltype          text NOT NULL,
    technology        text,                     -- free: "CCGT", "Run-Of-River", "PV", ...
    capacity_mw       double precision,         -- null where unpublished; never 0 for "unknown"
    year_commissioned integer,
    operator          text,
    source            text,                     -- the register this row came from
    geom              geometry(Point, 4326)     -- null where the plant is not located
);
CREATE INDEX IF NOT EXISTS plant_geom_idx ON solara.plant USING gist (geom);

-- Substations, one row per station (not per busbar).
CREATE TABLE IF NOT EXISTS solara.substation (
    id         text PRIMARY KEY,
    name       text,
    voltage_kv double precision,                -- the highest voltage of the station
    operator   text,
    source     text,
    geom       geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS substation_geom_idx ON solara.substation USING gist (geom);

-- Transmission and distribution lines, one row per line or circuit section.
CREATE TABLE IF NOT EXISTS solara.line (
    id              text PRIMARY KEY,
    name            text,
    voltage_kv      double precision,
    capacity_mva    double precision,           -- null where unpublished
    circuits        integer,
    in_service      boolean NOT NULL DEFAULT true,
    substation_from text,                       -- solara.substation.id, where known
    substation_to   text,
    -- Whether geom follows the conductor's route, or is only the straight
    -- segment between its two ends. Distances to a straight segment are a
    -- lower bound, and Solara says so on the reading.
    routed          boolean NOT NULL DEFAULT true,
    operator        text,
    source          text,
    geom            geometry(LineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS line_geom_idx ON solara.line USING gist (geom);

-- Administrative boundaries: the areas a reader picks instead of drawing one.
CREATE TABLE IF NOT EXISTS solara.boundary (
    id         text PRIMARY KEY,
    level      integer NOT NULL,                -- 1 for the first subdivision of the country, 2 for the next, ...
    level_name text    NOT NULL,                -- "Region", "Province", "State", "Municipality"
    name       text    NOT NULL,
    parent_id  text,                            -- solara.boundary.id of the level above
    geom       geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS boundary_geom_idx ON solara.boundary USING gist (geom);
CREATE INDEX IF NOT EXISTS boundary_level_idx ON solara.boundary (level);
