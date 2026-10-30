# Changelog

What Solara can read, and when each reading became possible. Dates are the
unit rather than versions, because a date is what a reader can check against
the history. A date a release was cut from also names its version and tag.

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
- **The flood rule of usable ground is a lower bound.** The elevation model
  is read over the area and a buffer of 2 to 5 km, not over the watershed
  upstream. A channel entering from beyond the buffer arrives without its
  contributing area, so the ground beside it reads higher above the drainage
  than it is and less of it is excluded than should be. The figure is shown
  as "at least", with this said beside it.
- **The water of usable ground is permanent water as mapped in 2021.** It is
  the permanent water class of ESA WorldCover 2021 at 10 m, and a 30 m cell is
  water when most of it is. Seasonal water, a river narrower than a few
  cells, wetlands (a class of their own, not read) and anything that changed
  since are not in it, and stay under the two rules. Where the map holds
  nothing over an area the reading says so, and the sea is counted as ground.
- **The published register layers cannot be picked.** SIGEL and the
  nighttime lights arrive as pictures from their own services, so
  they say where something is and not what it is.

---

## Unreleased

### The studio's look

- **The colours come from the logo.** The sunflower leaf is the accent --
  the open tab, what is chosen, the button that commits -- and the olive leaf
  marks the Studio menu and what went well. The chassis is a graphite warmed
  towards both. A warning is orange, so it is never read as a selection.
  The logo and its wordmark are unchanged.
- **Panels are edged and cornered as one family**: 6 px apart, 8 px
  corners, a hairline edge, and the ribbon set as a card of the same cut, its
  open tab underlined rather than filled.
- **One face, in sentence case.** Labels, readouts and figures are all
  Inter, figures in tabular numerals; the terminal face and tracked capitals
  are gone from the interface, kept for code in the console.
- **A reading's cards and panels stand on their own step**, and in a narrow
  area its four figures stay abreast as one strip, with what each is over in
  its tooltip.
- **One legend, docked in the map's corner**, for every layer drawn and in
  view: a reading's ramp or classes and each GeoPackage layer, with the sizes
  of the circles where a layer is counted. It replaces the boxes anchored to
  each area, which piled up over the ground they explained.
- **The outliner can be filtered by name**, and a GeoPackage of more than 15
  layers lists them by the prefix of their names, each group saying how many
  of its layers are drawn.
- **The status bar says where the pointer is** and what the readings rely
  on: the engine, the grid store, the network, and the layers being read.

### Faster reads

- **A map layer or a clicked feature no longer waits for Python to start.**
  Every read started an interpreter and imported what it needed, about
  0.1 s on a development machine before any work. Reads now go to up to two
  interpreters kept running: a small GeoPackage layer answers in 9 ms
  instead of 119, a clicked feature in 3 ms instead of 110. Analyses still
  start a process of their own, so cancelling one stops it alone. A worker
  that dies under a read sends that read down the old path, so a fault there
  costs time and never a result.

### GeoPackage layers

- **A crowded view is counted, not cut.** A layer with more than 5,000
  features in view was drawn from whichever 5,000 rows came first. Over Brazil
  that put every transmission tower of an OpenStreetMap export in one corner
  of Rio Grande do Sul, and left the coast from Fortaleza to Salvador without
  a substation. Such a layer is now drawn as one circle per map cell, at the
  mean of its features, with its area grown with the count. A legend on the
  map gives the sizes, the Outliner marks the layer **counts**, and a click
  on a circle frames its cell.
  - The counts come from the layer's spatial index alone. A layer without
    one is still drawn from its first 50,000 records, and says so.
  - The total in view is exact. A feature near a cell's edge can be counted
    in the neighbouring cell, because the index is summed over a grid four
    times finer than the cells before the cells are formed.
- **Attributes read as their columns declare them.** An integer is never
  grouped, so an identifier or a municipality code reads as itself. A boolean
  reads yes or no, and a blob gives its size instead of vanishing. Columns
  keep the file's order and the aliases of `gpkg_data_columns`; the labels
  and order written for one OpenStreetMap export are gone.
- **A click reads the feature whole**, by its primary key: every attribute
  uncut, and the geometry neither clipped nor simplified. The preview now
  carries only the attributes the map colours and names by, which takes the
  substations of that export over Brazil from 4.2 MB to 1.3 MB.

---

## 2026-10-18 · 1.0.0

The first release, tagged `v1.0.0`. It is built for macOS on Apple Silicon and
Intel, Windows and Linux, with the calculation engine inside.

### Releases

- **Packages that run without Python.** Each platform's archive carries the
  calculation engine, frozen with Python 3.12 and its scientific and
  geospatial libraries. Besides the archive, only the system's webview has to
  be installed. GitHub Actions builds and publishes a release from a `v*` tag,
  and only when all four platforms pass their tests and a smoke test of the
  relocated engine. Each archive comes with its SHA-256.
  `4dca5db` `287f462` `14b862f` `98ce6cf` `731c609`
  - The packages are not signed. macOS is ad-hoc signed and not notarized;
    Windows has no Authenticode signature.
  - The grid store is not distributed. The grid products still need a PostGIS
    store loaded separately; `contract/` describes what it has to hold.

### Local GeoPackage layers

- **A GeoPackage opens as map layers.** *Open project…* accepts a `.gpkg`.
  The outliner lists its vector layers, each with its own eye and colour.
  Each layer is read for the region in view and transformed to WGS84 from the
  file's declared reference system. Clicking a feature captions its
  attributes. `910056c` `ec3be4f`
  - The file is opened read-only. A `.solara` project keeps its path, the
    layers shown and their colours, not a copy of the file.
  - A view previews at most 5,000 features and 6 MB, and past that asks for a
    closer zoom. Without a spatial index, only the first 50,000 records are
    scanned. Raster layers are not read.
  - Colours come from the file's QGIS styles or colour attributes where it has
    them, and otherwise from a random palette.

### System planning

- **Economic dispatch and single-period capacity expansion with PyPSA**,
  solved locally with HiGHS. A study covers generation, storage and the
  ratings of existing lines over a chronological horizon of demand and
  availability, with costs and an optional CO₂ cap. The result gives dispatch
  by technology, optimised capacities, the cost decomposition, emissions, line
  utilisation and storage losses. It exports as a run report that carries its
  own inputs. `910056c` `ec3be4f` `0f7359c`
  - The network is entered, not inferred. A GeoPackage can be cited as a
    geographic reference, but its geometries do not make an electrical model.
  - A solve that is infeasible or not optimal is an error, never a partial
    result.
  - The synthetic example is fictional, and says so.
  - Draft studies are kept in the webview's storage, not in the `.solara`
    project.

### The studio

- **A permanent workspace bar**, with Default and Planning · PyPSA, and the
  other layouts under *More workspaces*. Each workspace keeps its own
  arrangement, and the last one used comes back at launch. `ec3be4f`
- **The ribbon follows the workspace.** Its tabs and the analyses it offers
  are those of the panels on screen, and a Map tab appears only where there is
  a map. `ec3be4f`
- **A panel is moved by its header.** Dropped on another panel's centre, it
  swaps places with it; dropped at an edge, it docks there. A preview shows
  the result before release, and the keyboard can make the same moves.
  `ec3be4f`

---

## 2026-10-02 to 2026-10-05

### Usable ground

- **How much of an area a plant could stand on, and what excludes the rest.**
  Two rules, typed by the reader and read off the Copernicus DEM at 30 m:
  ground steeper than a maximum slope (5° unless typed), and ground closer
  than a minimum height above its nearest drainage, HAND (5 m unless typed;
  zero switches the rule off). The reading gives the usable area and share,
  the ground each rule takes, a layer of classes on the map with its legend,
  a GeoTIFF of the classes, and two curves of what another rule would have
  left with the other held where it was typed.
  - It is the first product to call `terrain/hand.py`, which was written and
    tested but answered no action.
  - Set up and run from its card in Properties, or from the empty reading of
    its workspace. The ribbon's Ground group opens that workspace, not the
    run graph.
  - **Permanent water is a reason of its own, not ground that floods.** The
    elevation model carries the sea and the lakes as level surfaces, so the
    first coastal area tried came back 59% "flood". Water is now read from
    ESA WorldCover 2021 (10 m, CC BY 4.0, from the Planetary Computer) and
    taken out before the rules: its own class in the raster, the legend, the
    shares and the table. Over that same area: 31% water, 28% flood.
  - **The usable share is said twice**, of the area that was drawn and of the
    land inside it (28.4% and 41.3% there). The share each rule takes, the
    terrain figures and both curves are of the land, since the rules act on
    nothing else.
  - A run whose water map cannot be read fails, rather than answering without
    it.
  - A screening by terrain alone. Land cover as a rule, protected areas,
    wetlands and the distance to a connection are not read.

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
- **A wire into Run can no longer be cut, and a cut no longer changes a run.**
  A run reads every input its card in Properties lists, wherever it is
  started; the run graph draws that and withholds nothing. Cuts kept from
  before are dropped, and the Analysis tab's product buttons open the reading
  instead of the run graph.

### Reading a result

- **Every reading is laid out the same way.** The product and its standing,
  the one figure it answers with, and a line saying where and from what; up to
  four figures, each beside what it is read against; the panel that takes the
  answer apart across the full width; the panels behind it two abreast, one
  where the area is narrow; how it was read, last. Solar resource, wind
  screening, solar terrain and grid connection were pages of sections and are
  now this, as usable ground and area consumption already were.
  - The consumption reading's free board is gone, with the Grid/Board switch
    in its header: a result is read one way.
  - What explains a panel is behind the info button in its head. What changes
    how a figure is read — gross, unvalidated, at least, injected and not
    generated, unconfirmed — stays beside the figure.
  - A reading no longer carries a small picture of its layer. The layer is on
    the map, and when a run ends the map is brought to its ground if none of
    it is in view.
- **Properties says a result in one line**, the reading's own figure, with the
  button that opens the reading, on every product's card and on a selected
  result. It used to repeat the reading's figures as rows.
- **A voltage level is one colour** in the year's chart and in the table's
  bars of the consumption reading, by the level and not by its place in the
  list.
- The consumption register is named in English ("base year 2024").
- **When a result was computed is shown in local time**, in the comparison
  table, the result picker and Properties. It was the UTC moment cut short,
  so an evening run showed the next day. The JSON export keeps the full UTC
  moment, and a CSV carries the local one with its offset
  (`2026-10-04T22:46:00-03:00`): on screen the zone is the reader's own, in a
  file it has to be written.

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
