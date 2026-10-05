# Changelog

What Solara can read, and when each reading became possible. Dates are the
unit rather than versions: there is no release yet, and a date is what a
reader can check against the history.

Entries say what became possible, not which files moved. Where a reading
carries a caveat that changes how its numbers must be read, the caveat is
recorded with the entry that introduced it, and repeated under **Standing
caveats** for as long as it holds.

---

## Standing caveats

These are true of the current readings. They are not defects to be fixed;
they are what the sources say, and a reading that ignores them is wrong.

- **The distributed generation in the BDGD is injection, not generation.**
  The register carries what crossed the distributor's meter. Self-consumption
  never did, so the figure is roughly half of what the roofs produce. It is
  the right quantity for a network question and the wrong one for a
  generation question. The definition is well supported but unconfirmed: the
  Annex of REN 956/2021 answers 403, and the BDGD manual sits behind an
  ArcGIS item that does not answer by API.
- **`POT_INST` mixes units between rows.** Part of the column is in kW and
  part in W. Readings normalise by treating values above 75 as W, which is a
  heuristic and does not catch everything; a reading that reports installed
  power says that it normalised.
- **A municipality is the floor of an area.** Areas come from IBGE's
  published boundaries, and the service refuses to subdivide a municipality,
  so a neighbourhood is not an area a reading can be asked for.
- **"Where each register reaches" is the union of the register's `conj`, not
  a concession area.** It answers where this register holds data, which is
  what decides whether a reading can be asked here. It is not a statement
  about who holds the concession in law.
- **The published register layers cannot be picked.** SIGEL and the
  nighttime lights arrive as pictures from their own services, so
  they say where something is and not what it is.

---

## Unreleased

In the working tree, not yet committed.

### What a run reads, where it is started

- **A product's card in Properties lists everything a run of it reads** — the
  ground with its area, the store, each setting — with the value held now and
  whether the newest run read it: not set, pending, reading, read or error.
  They are the run graph's wires as rows, computed by the same functions, so
  the two cannot disagree. The consumption reading also says, before it is
  run, how much of the area the register covers.
- **Area consumption has a card in Properties**, offered like the connection
  card only over a store that could answer it.
- **An empty reading shows the same list and runs from it**, over the site or
  area that is active, instead of sending the reader to the run graph.
  - A wire cut on the run graph still withholds its value from a run started
    anywhere; the row says "cut".

### The ground a reading sits on

- **A basemap that can be switched.** The dark street map is now one of two
  grounds; the other is Sentinel-2 cloudless imagery, for the times when the
  question is what is actually on the ground rather than how it is named.
  Switching hides the vector fills that would sit on top of the photograph,
  and rewrites the labels and roads in ink that survives it.
  - The imagery is the **2016** layer, which EOX releases under CC BY 4.0.
    Every year from 2017 on is CC BY-NC-SA, which a tool that may be used
    commercially cannot take. Moving to a newer year is a licensing
    decision, not a code change.
- **Hillshade** from the global elevation tiles, under everything the map
  draws, so relief is present away from the areas a terrain reading has
  already covered.
- **Two registers that publish themselves**, each drawn straight from its
  own service and each off until asked for:
  - nighttime lights (NASA GIBS, Black Marble day/night band), as a check on
    where load is that does not come from the consumption record;
  - turbines one by one and the strips already declared of public utility
    (SIGEL, ANEEL), neither of which the local store holds.
- **The credit at the foot follows what is drawn** — the ground in use and
  every register switched on — and says when the map is stretched past the
  zoom its tiles carry.

---

## 2026-09-23

- Named **Solara**, with its own mark and wordmark. `450d51e`
- A project file carries its own icon and a type the system knows. `55c23ea`

## 2026-09-22

### Demand over an area

- **An area's demand, read out of the BDGD.** The first reading that is about
  consumption rather than generation: what the area draws from the network,
  and what it already generates behind the meter, from the register in the
  local grid store. `8315493` `bcbac33`
- **A demand result reads as a board**, not as a page of stacked rows — a
  panel surface with charts, which is what the figures are. `5d4fa21`
- Introduced the two caveats about the BDGD now listed under **Standing
  caveats**: the energy is injection, and `POT_INST` mixes units.

### Where a reading makes sense, before running it

- **Where each register reaches**, drawn on the map and on by default. A
  demand reading is always of one distributor and only exists where that
  register holds data, so this answers "can I ask the question here" before
  the query is spent. The layer is 29 kB. `00fe487` `8200af4`
- **Every register's municipalities**, as a layer of consumption by
  municipality. `00fe487`
- **A layer can be scoped to a region** from the run graph. `8200af4`
- The ground layers of the grid now draw **under the basemap's own labels**,
  as the rest of the map already did; before this a choropleth at 0.55
  opacity could bury a city name. `8200af4`
- `demand` joined the products the run graph can set up, which is the only
  place that shows every input of a run at once. `8200af4`

### Workshop

- A workshop route for the readings, rendering the panels against a fixture
  at a draggable width, so judging a panel no longer costs a full build and a
  project to open. `8906dad`

## 2026-09-18

- **The weather now**: clouds from GOES-East, rain from the radar composite,
  and the conditions at a point. `46d2251`
- **The GFS wind field**, read in the sidecar, bound, and drawn over the map
  as speed under particles carried along the direction. This is the weather
  now and not a climatology: it answers what the wind is doing, not what a
  site is worth. `38d54c6` `9b02bf0` `2a0f103`

## 2026-09-17

- **The grid store**: a local PostgreSQL/PostGIS database holding the
  Brazilian electrical record, checked and chosen from the interface.
  `390e1db` `1ea101c`
- **Where an area could join the transmission network**, as a reading.
  `5af0b10` `ab4dd16`
- **The plant register and the transmission network** drawn on the map, lines
  coloured by voltage and plants sized by capacity. `994c128`
- A terrain layer's legend is tied to the layer on the map. `16cf0a3`

## 2026-09-16

- **Plane-of-array irradiation over an area**, across the relief, with
  horizon and shading, from the Copernicus DEM read through the Planetary
  Computer. The first raster product, and the first reading that needs an
  area rather than a point. `3a368eb` `1d0096c` `e6585d8`
  - The area is validated before anything is downloaded, and capped at four
    million cells (about 55×55 km).
  - The raster is served from a results directory rather than passed through
    the bridge as a data URI.
- The shell became a studio with a project file, an undo history, and a run
  graph that describes a run as the values it reads. `585a1f8` `2d4a8ea`

## 2026-09-10

- **Solar resource and photovoltaic yield at a site**: annual and monthly
  GHI, P10/P90, optimal tilt, specific yield and capacity factor, from NASA
  POWER through pvlib. `42e91bd` `a33eef8` `f89c028`
- **Wind screening at hub height**: shear, roughness, Weibull, density, power
  curve and rose, from POWER's hourly record. Declaredly **not validated**.
  `42e91bd`

---

## Not in the changelog, and why

Two things that matter to these features are tracked elsewhere, and are named
here so the omission is deliberate rather than an oversight.

- **The BDGD loader.** The demand reading depends on a `bdgd` schema that
  something has to load, one file geodatabase per distributor per base year.
  That loader is not in this repository, so nothing above is reproducible by
  someone who does not already have the store. Until it is brought in, the
  demand entries describe what this machine can do, not what the project can
  do.
- **Open work.** What is wrong or missing belongs in the backlog, not here. A
  changelog records what happened.
