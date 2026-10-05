# The Solara store contract

Solara reads the electrical system of a country from a database you prepare.
This folder says what that database has to hold, and gives you a script to
fill one.

A **store** is a PostgreSQL database with PostGIS that has a schema named
`solara` containing the tables below. Solara only ever reads it. You can load
data into the tables, or define views with the same names over tables you
already have; Solara cannot tell the difference.

The contract is [`v1.sql`](v1.sql). It is version 1.

## What a store holds

Only `solara.contract` is required. Every other table is optional, and what is
present decides what Solara can do with the store.

| Table | One row is | What it gives you in Solara |
|---|---|---|
| `solara.contract` | The store itself: contract version and a name | The store is recognised and named on the Grid store card |
| `solara.plant` | A power plant | The plant layer on the map |
| `solara.substation` | A substation | The substation layer; the connection reading |
| `solara.line` | A line, or a section of one | The line layer; the connection reading |
| `solara.boundary` | A named area: a region, a province, a municipality | The catalogue of areas a reading is run over |

Solar resource, wind screening and solar terrain need no store at all: they
read global sources and work anywhere.

## The rules

**Units are fixed.** Capacity in MW, voltage in kV, line rating in MVA.
Converting is your work, done once when you load; Solara does no conversion
and offers no setting for it.

**Geometry is EPSG:4326.** Longitude and latitude, WGS84. Plants and
substations are points, lines are `LineString`, boundaries are `MultiPolygon`.

**Unknown is null.** A plant whose capacity is not published has a null
`capacity_mw`, never 0. A line with no published rating has a null
`capacity_mva`.

**Fuel types come from one list.** `solara.plant.fueltype` is one of:

    Hydro, Solar, Wind, Nuclear, Natural Gas, Hard Coal, Lignite, Oil,
    Solid Biomass, Biogas, Geothermal, Other

This is powerplantmatching's list. Anything that does not fit is `Other`; put
the detail in `technology`, which is free text.

**Say whether a line is a route.** `solara.line.routed` is true when the
geometry follows the conductor, and false when it is only the straight segment
between the line's two ends. A distance to a straight segment is a lower
bound, and Solara says so on the reading.

**Boundaries nest by level.** Level 1 is the first subdivision of the country,
level 2 the next, and so on. `parent_id` names the boundary one level up.
`level_name` is what the catalogue calls the level ("Region", "Province").

## Columns

The column names for plants follow
[powerplantmatching](https://powerplantmatching.readthedocs.io/en/stable/basics.html),
and for the network [PyPSA](https://docs.pypsa.org/) and
[earth-osm](https://github.com/pypsa-meets-earth/earth-osm), so data prepared
for those tools maps across with a rename.

| Table | Solara reads |
|---|---|
| `plant` | `id`, `name`, `fueltype`, `technology`, `capacity_mw`, `year_commissioned`, `operator`, `geom` |
| `substation` | `id`, `name`, `voltage_kv`, `operator`, `geom` |
| `line` | `id`, `name`, `voltage_kv`, `capacity_mva`, `circuits`, `in_service`, `routed`, `geom` |
| `boundary` | `id`, `level`, `level_name`, `name`, `parent_id`, `geom` |

A table that is present must have all of its columns, even if a column is
null on every row. Extra columns are ignored.

## Preparing a store

`load.py` fills a store from sources that are open for most countries. Run it
with the interpreter Solara's sidecar uses, which has the libraries it needs.

```sh
createdb solara_it
PY=.venv/bin/python3
DSN=postgresql:///solara_it

# 1. Create the contract's tables and name the store.
$PY contract/load.py init --dsn $DSN --name "Italia: WRI + OpenStreetMap"

# 2. Plants, from the WRI Global Power Plant Database (--format wri)
#    or a powerplantmatching export (--format ppm).
$PY contract/load.py plants --dsn $DSN --csv global_power_plant_database.csv \
    --format wri --country ITA

# 3. Boundaries, one level per GeoJSON file.
$PY contract/load.py boundaries --dsn $DSN --geojson regions.geojson \
    --level 1 --level-name Region --id-field reg_istat_code --name-field reg_name
$PY contract/load.py boundaries --dsn $DSN --geojson provinces.geojson \
    --level 2 --level-name Province --id-field prov_istat_code --name-field prov_name \
    --parent-field reg_istat_code

#    With no files of your own, any country's boundaries from geoBoundaries:
$PY contract/load.py boundaries-world --dsn $DSN --country ITA --levels 1,2

# 4. Lines and substations, from OpenStreetMap, for any country.
$PY contract/load.py osm --dsn $DSN --country IT

# 5. Read the store back against the contract.
$PY contract/load.py check --dsn $DSN
```

`check` prints what Solara will see: each table, its rows, and every departure
from the contract said as the thing to fix. It exits non-zero when there is
one. The Grid store card in Solara shows the same report after you connect.

Then connect in Solara: on the **Grid store** card of the run graph, fill in
the database and press **Connect**.

## What the contract does not carry

Curtailment, consumption by distributor and concession areas are read only
from the Brazilian record that TERRA loads (the schema `br`). They are not in
the contract, because no convention for them holds across countries yet. A
store prepared to the contract is not missing them; Solara says they are not
available from it.

Time series (load, generation, prices by zone) are not in version 1 either.

## Credits you owe

A store built from OpenStreetMap is under the ODbL and must credit
"OpenStreetMap contributors". The WRI database is CC BY 4.0. `load.py` writes
each source it loaded into `solara.contract.sources`.
