import { useState } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import {
  ChartBar, Database, Fan, Graph, MapTrifold, Mountains, PlugsConnected,
  Scroll, Sun, Table, TerminalWindow, Export as ExportIcon, ArrowClockwise,
} from "./lib/icons"
import type { energy, grid } from "../wailsjs/go/models"
import { DemandBoard } from "./components/energy/DemandBoard"
import { Chip, Panel, Stat } from "./components/energy/primitives"
import { AppSidebar, type NavGroup } from "./components/shell/AppSidebar"
import { HeaderAction, PageHeader } from "./components/shell/PageHeader"
import { Empty } from "./components/editors/ReadingEditor"
import { ProductCard, ResultLayer } from "./components/editors/PropertiesEditor"
import { GroundBody } from "./components/energy/GroundDocument"
import { lastFailure, running } from "./lib/analysis"
import { defaults } from "./lib/defaults"
import { gridStore, reachByArea } from "./lib/grid"
import { emptyProject, project, type AreaObject, type Polygon, type Product, type ResultObject } from "./lib/project"
import { select } from "./lib/selection"

/**
 * A reading document on its own, over invented figures shaped like the real
 * register's.
 *
 * WHY THIS EXISTS. Judging a panel means looking at it, and looking at it
 * through the desktop app costs a 25-second `wails build`, a project to open
 * and a run to wait for. This route renders the same components against a
 * fixture, at a width you can drag, with hot reload. It is a workshop, not a
 * product surface: nothing here reaches the app.
 */

/** A deterministic hash. `i * prime % m` walks a lattice and draws fake combs. */
const rnd = (i: number, salt: number) => {
  let h = Math.imul(i ^ salt, 2654435761)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const CEILING = 1610

const months = (peak: number, trough: number) =>
  Array.from({ length: 12 }, (_, i) =>
    Number((trough + (peak - trough) * (0.5 + 0.5 * Math.cos(((i - 11) / 12) * 2 * Math.PI))).toFixed(1))
  )

const sample = (n: number, overRate: number) =>
  Array.from({ length: n }, (_, i) => {
    const kwp = Number((Math.exp(rnd(i, 1) * 5.2) * 1.2).toFixed(3))
    const over = rnd(i, 2) < overRate
    const y = CEILING * (over ? 1.05 + rnd(i, 3) * 2.6 : 0.22 + rnd(i, 3) * 0.72)
    return [kwp, Number(((kwp * y) / 1000).toFixed(3))]
  })

const demand = {
  register: { distribuidora: "Neoenergia_Cosern", ano: 2024, base: "BDGD Neoenergia_Cosern, ano-base 2024", holdings: [] },
  consumo: {
    bt: { unidades: 540_611, energia_ano_mwh: 1_300_400, energia_mensal_mwh: months(121900, 97100) },
    mt: { unidades: 1_727, energia_ano_mwh: 648_800, energia_mensal_mwh: months(56100, 50200) },
    at: { unidades: 7, energia_ano_mwh: 223_300, energia_mensal_mwh: months(19400, 17900) },
  },
  geracao: {
    bt: {
      unidades: 23_084, potencia_instalada_kw: 499_111, potencia_instalada_plausivel_kw: 482_501,
      energia_injetada_ano_mwh: 192_400,
      acima_do_teto: { teto_kwh_kwp_ano: CEILING, unidades: 6_591, potencia_kw: 16_610, nota: "" },
      amostra: sample(2200, 0.29),
    },
    mt: {
      unidades: 367, potencia_instalada_kw: 8_154, potencia_instalada_plausivel_kw: 6_529,
      energia_injetada_ano_mwh: 25_700,
      acima_do_teto: { teto_kwh_kwp_ano: CEILING, unidades: 231, potencia_kw: 1_625, nota: "" },
      amostra: sample(340, 0.62),
    },
  },
  // A drawn area the concession only clips, which is the case the band is for.
  cobertura: { area_km2: 49_987.2, concessao_km2: 53_501.0, dentro_km2: 1_449.6, cobertura_pct: 2.9, nota: "" },
  totais: { energia_consumida_ano_mwh: 2_172_500, energia_injetada_ano_mwh: 410_000, injetada_sobre_consumida_pct: 18.9 },
  analise: {
    sazonalidade: { mes_pico: 12, mes_vale: 8, pico_mwh: 121900, vale_mwh: 97100, amplitude_pct: 22.9 },
    concentracao: { celulas_com_metade: 38, km2_com_metade: 38, pct_das_celulas_ocupadas: 10.1, decil_superior_pct: 50.5 },
    centro_de_carga: { lon: -35.234, lat: -5.812, desloc_km: 1.7, rumo: "sudoeste" },
    mix: { classe: "RE1", pct_da_energia: 62.4, pct_das_unidades: 76.9 },
    confianca_do_registro: { geradores_impossiveis: 6824, geradores: 23453, pct_dos_geradores: 29.1, pct_da_potencia: 3.6 },
  },
  density: {
    overlay_url: "", extent: {} as never,
    scale: { min: 3.4, max: 35992.7, decimals: 1, basis: "own", stops: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"], reference: null, shared_with: "" },
    cell_km: 1, cells: 375, grid: { nx: 28, ny: 22 }, unit: "MWh/ano por célula",
    note: "Each cell holds the year of the units whose connection point falls in it, so a block fed from one transformer lands on one cell. Empty cells are transparent, not zero.",
  },
  por_classe: [
    { clas_sub: "RE1", unidades: 415_000, energia_ano_mwh: 812_400 },
    { clas_sub: "RE2", unidades: 61_200, energia_ano_mwh: 188_900 },
    { clas_sub: "CO1", unidades: 32_800, energia_ano_mwh: 141_200 },
    { clas_sub: "IN1", unidades: 8_900, energia_ano_mwh: 96_700 },
    { clas_sub: "PP1", unidades: 12_400, energia_ano_mwh: 44_100 },
    { clas_sub: "RU1", unidades: 6_100, energia_ano_mwh: 18_300 },
    { clas_sub: "SP1", unidades: 3_900, energia_ano_mwh: 12_800 },
  ],
  por_municipio: [
    { mun: "2408102", unidades: 388_400, energia_ano_mwh: 902_100 },
    { mun: "2403251", unidades: 74_900, energia_ano_mwh: 171_400 },
    { mun: "2407104", unidades: 41_200, energia_ano_mwh: 98_800 },
    { mun: "2412005", unidades: 22_600, energia_ano_mwh: 54_300 },
    { mun: "2404606", unidades: 13_500, energia_ano_mwh: 31_900 },
  ],
  assumptions: {
    energia_da_geracao: "what reached the network, not what was generated",
    potencia_instalada: "normalised across rows that mix kW and W",
    posicao: "the connection point, not the door",
    teto_de_rendimento: { valor_kwh_kwp_ano: CEILING, origem: "the solar product at this place", nota: "A rooftop in the sunniest place in Brazil, at the modelled performance ratio and no shading: nothing fixed can beat it." },
  },
} as unknown as grid.DemandAnalysis

const area: Polygon = {
  type: "Polygon",
  coordinates: [[[-35.30, -5.72], [-35.15, -5.72], [-35.15, -5.88], [-35.30, -5.88], [-35.30, -5.72]]],
}

/** The places the application has, grouped the way the work is grouped. */
const NAV: NavGroup[] = [
  {
    label: "Analysis",
    items: [
      { id: "map", label: "Map", icon: MapTrifold },
      { id: "demand", label: "Area consumption", icon: ChartBar, badge: "1" },
      { id: "solar", label: "Solar resource", icon: Sun },
      { id: "wind", label: "Wind screening", icon: Fan },
      { id: "terrain", label: "Terrain", icon: Mountains, empty: true },
      { id: "connection", label: "Connection", icon: PlugsConnected, empty: true },
    ],
  },
  {
    label: "Build",
    items: [
      { id: "graph", label: "Run graph", icon: Graph },
      { id: "table", label: "Tables", icon: Table },
      { id: "reports", label: "Reports", icon: Scroll, empty: true },
    ],
  },
  {
    label: "Data",
    items: [
      { id: "registers", label: "Registers", icon: Database },
      { id: "console", label: "Console", icon: TerminalWindow },
    ],
  },
]

/**
 * Where the Outliner and Properties go once the shell has a page: a rail on
 * the selected thing, not two more panes of the mosaic competing with the
 * reading for the screen.
 */
function SelectionRail() {
  return (
    <aside className="hidden w-[248px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-border bg-chrome p-2.5 2xl:flex">
      <Panel title="Selected">
        <div className="flex items-center gap-2 pb-1">
          <span className="size-2 rounded-[2px] bg-kind-area" />
          <span className="truncate text-[13px] text-foreground">Natal</span>
          <span className="ml-auto text-[10px] text-muted-foreground">Area</span>
        </div>
        <Stat label="Area" value="616.43 km²" />
        <Stat label="Vertices" value="4" />
        <Stat label="Centre" value="5.800° S 35.225° W" />
      </Panel>
      <Panel title="Runs on this area">
        <Stat label="Area consumption" value="2 min ago" />
        <Stat label="Solar resource" value="—" />
        <Stat label="Wind screening" value="—" />
      </Panel>
      <Panel title="Now" right={<span className="text-[10px] text-muted-foreground">modelled</span>}>
        <Stat label="Irradiance, horizontal" value="46 W/m²" />
        <Stat label="Cloud cover" value="27 %" />
        <Stat label="Temperature" value="27.0 °C" />
        <Stat label="Wind at 120 m" value="7.7 m/s" />
      </Panel>
    </aside>
  )
}

function App() {
  const [active, setActive] = useState("demand")
  const [collapsed, setCollapsed] = useState(false)
  const [places, setPlaces] = useState<Record<string, { x: number; y: number }>>({})
  const move = (id: string, place: { x: number; y: number }) => setPlaces((p) => ({ ...p, [id]: place }))
  return (
    <div className="flex h-screen bg-app text-foreground">
      <AppSidebar
        groups={NAV}
        active={active}
        onSelect={setActive}
        onSearch={() => {}}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        brand="solara"
        brandSub="Natal · unsaved"
        account={{ name: "fox", detail: "opensource.leonardi@gmail.com" }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          title="Area consumption"
          crumbs={[{ label: "Natal" }, { label: "Grid" }]}
          badge={<Chip>18.9% injected back</Chip>}
          subtitle="BDGD Neoenergia_Cosern, ano-base 2024 · 616 km² · read 2 minutes ago"
          status={{ label: "engine ready", tone: "ok" }}
          actions={<HeaderAction icon={<ExportIcon size={14} />}>Export</HeaderAction>}
          primary={{ label: "Run again", onClick: () => {}, icon: <ArrowClockwise size={14} /> }}
        />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-hidden">
            <DemandBoard demand={demand} area={area} places={places} onMove={move} onReset={() => setPlaces({})} />
          </main>
          <SelectionRail />
        </div>
      </div>
    </div>
  )
}

// ---- The product card's inputs, in each state a run can leave them ----------------

/**
 * `preview.html?inputs=<state>`: the real product card and the real empty
 * reading over seeded stores, since both read the stores and not props.
 *
 *   pending   an area chosen, nothing run
 *   read      a run read everything, then the layer cell was changed
 *   reading   a run in progress
 *   failed    the last attempt failed
 *   nostore   no store connected
 *   nosource  nothing selected (the empty reading only)
 */
type InputsState = "pending" | "read" | "reading" | "failed" | "nostore" | "nosource"

const natal: AreaObject = { id: "a1", kind: "area", name: "Natal", polygon: area, hidden: false } as unknown as AreaObject

function seedInputs(state: InputsState) {
  const ran = { yieldCeilingKWhKWp: 1610, cellKm: 1 }
  const result = { id: "r1", kind: "demand", name: "Area consumption", sourceId: natal.id, polygon: area, params: ran, createdAt: new Date().toISOString(), data: demand } as unknown as ResultObject
  defaults.set({
    solar: { hourly_years: 3, climatology_years: 20, surface_azimuth: 0, performance_ratio: 0.8 },
    wind: { record_years: 10, record_max_floor_ms: 12, hub_height_m: 120, calm_threshold_ms: 3, roughness_band_m: [0.03, 0.3] },
    terrain: { hourly_years: 3, season: "annual", seasons: ["annual"] },
    connection: { search_radius_km: 50 },
    demand: { yield_ceiling_kwh_kwp: CEILING, cell_km: 1 },
    ground: { slope_max_deg: 5, hand_min_m: 5 },
  } as never)
  project.set((p) => ({
    ...p,
    data: {
      ...emptyProject(),
      name: "Natal",
      areas: [natal],
      results: state === "read" ? [result] : [],
      // Changed after the run, so one row of a read list goes back to pending.
      settings: { ...emptyProject().settings, demand: state === "read" ? { ...ran, cellKm: 2 } : state === "failed" ? ran : {} },
    },
  }))
  if (state !== "nostore") {
    gridStore.set({
      kind: "known",
      report: { reachable: true, dsn: "", coverage: { store: { capabilities: { brazil: true, connection: true, network: true, plants: true } } } },
    } as never)
  } else {
    gridStore.set({ kind: "known", report: { reachable: false, dsn: "" } } as never)
  }
  reachByArea.set({
    [natal.id]: {
      key: JSON.stringify(area.coordinates),
      state: { kind: "ready", data: { holdings: [], note: "", coberturas: [{ distribuidora: "Neoenergia_Cosern", ano: 2024, unidades: 542_345, area_km2: 290, concessao_km2: 53_501, dentro_km2: 290, cobertura_pct: 100 }] } },
    },
  })
  if (state === "reading") running.set({ product: "demand", sourceId: natal.id, progress: 40, message: "Counting the units inside the area" } as never)
  if (state === "failed") lastFailure.set({ product: "demand", sourceId: natal.id, source: natal, params: ran, at: Date.now() })
  select(state === "nosource" ? null : natal.id)
}

const AREA_PRODUCTS: Product[] = ["demand", "connection", "terrain"]

function Inputs({ state }: { state: InputsState }) {
  return (
    <div className="flex h-screen gap-6 bg-app p-6 text-foreground">
      {state !== "nosource" && (
        <div className="w-[272px] shrink-0 overflow-y-auto border border-border bg-chrome">
          {AREA_PRODUCTS.map((p) => (
            <ProductCard key={p} product={p} source={natal} />
          ))}
        </div>
      )}
      <div className="min-w-0 flex-1 overflow-y-auto border border-border">
        <Empty product="demand" />
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto border border-border">
        <Empty product="solar" />
      </div>
    </div>
  )
}

// ---- The usable-ground reading, over the figures a real run returned ---------------

/**
 * `preview.html?ground`: the reading and the product's card, over the result
 * of a run on this very area (Natal, 5 degrees and 5 m). The layer is drawn
 * as a flat swatch here: the workshop has no run directory to serve a raster.
 */
const ground = {
  area_km2: 293.2715, land_km2: 202.2344, water_km2: 91.0371, usable_km2: 83.4169, usable_pct: 28.44, usable_of_land_pct: 41.25, no_data_km2: 0,
  classes: [
    { key: "usable", code: 0, colour: "#009e73", area_km2: 83.4169, pct: 28.44, pct_of_land: 41.25 },
    { key: "slope", code: 1, colour: "#e69f00", area_km2: 30.2865, pct: 10.33, pct_of_land: 14.98 },
    { key: "flood", code: 2, colour: "#0072b2", area_km2: 81.8422, pct: 27.91, pct_of_land: 40.47 },
    { key: "slope_and_flood", code: 3, colour: "#cc79a7", area_km2: 6.6889, pct: 2.28, pct_of_land: 3.31 },
    { key: "water", code: 4, colour: "#56b4e9", area_km2: 91.0371, pct: 31.04, pct_of_land: null },
  ],
  excluded_by_slope_pct: 18.28, excluded_by_flood_pct: 43.78,
  water: { source: "ESA WorldCover 2021, 10 m", attribution: "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium", mapped: true, unmapped_km2: 0 },
  sensitivity: {
    slope: [[1, 8.34], [2, 20.57], [3, 29.5], [4, 36.14], [5, 41.25], [6, 44.68], [8, 48.9], [10, 51.28], [12, 52.87], [15, 54.38], [20, 55.62], [30, 56.22]].map(([value, usable_pct]) => ({ value, usable_pct })),
    hand: [[0, 74.54], [1, 65.25], [2, 58.5], [3, 52.23], [4, 46.39], [5, 41.25], [6, 36.7], [8, 29.85], [10, 25.22], [15, 17.94], [20, 13.76], [30, 7.48]].map(([value, usable_pct]) => ({ value, usable_pct })),
  },
  rules: { slope_max_deg: 5, hand_min_m: 5, drainage_km2: 0.5 },
  slope_mean_deg: 3.27, slope_max_deg: 31.42, hand_median_m: 6.22, pixels: 310464,
  cell_m: [30.76, 30.71], buffer_m: 3537.3, dem_source: "Copernicus DEM GLO-30",
  caveats: {
    hand: "The flood rule is a lower bound. The elevation model is read over the area and a buffer of 3.5 km, not over the watershed upstream, so a channel entering from beyond the buffer arrives without its contributing area and the ground beside it reads higher above the drainage than it is.",
    water: "Water is the permanent water class of ESA WorldCover 2021, at 10 m. Seasonal water, rivers narrower than a few cells, wetlands and anything that changed since are not in it, and stay under the two rules.",
  },
  overlay_url: new URLSearchParams(location.search).get("ground") || "", raster_tif: "/results/8f3a/usable_ground.tif",
  extent: { lon_min: -35.3, lat_min: -5.88, lon_max: -35.15, lat_max: -5.72 },
} as unknown as energy.UsableGroundAnalysis

function seedGround() {
  seedInputs("pending")
  const result = { id: "g1", kind: "ground", name: "Usable ground", sourceId: natal.id, polygon: area, params: {}, opacity: 0.7, hidden: false, createdAt: new Date().toISOString(), data: ground } as unknown as ResultObject
  project.set((p) => ({ ...p, data: { ...p.data, results: [result] } }))
}

function Ground() {
  return (
    <div className="flex h-screen gap-6 bg-app p-6 text-foreground">
      <div className="w-[272px] shrink-0 overflow-y-auto border border-border bg-chrome">
        <PropertiesAreaCards />
      </div>
      <div className="panel-scroll @container min-w-0 flex-1 overflow-y-auto border border-border">
        <div className="mx-auto max-w-4xl px-6 pb-12 pt-5">
          <GroundBody ground={ground} area={area} />
        </div>
      </div>
    </div>
  )
}

function PropertiesAreaCards() {
  const latest = project.get().data.results.find((r) => r.kind === "ground")
  return (
    <>
      <ProductCard product="ground" source={natal} />
      {latest?.kind === "ground" && <ResultLayer result={latest} />}
    </>
  )
}

const wantsGround = new URLSearchParams(location.search).has("ground")
if (wantsGround) seedGround()

const inputs = wantsGround ? null : (new URLSearchParams(location.search).get("inputs") as InputsState | null)
if (inputs) seedInputs(inputs)

createRoot(document.getElementById("root")!).render(wantsGround ? <Ground /> : inputs ? <Inputs state={inputs} /> : <App />)
