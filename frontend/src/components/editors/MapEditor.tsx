import { useEffect, useRef } from "react"
import { CaretDown, CaretRight, House, MagnifyingGlassMinus, MagnifyingGlassPlus, Stack, Tag } from "@phosphor-icons/react"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { runSolar, runTerrain, runWind } from "../../lib/analysis"
import { BASEMAP_NAME } from "../../lib/basemap"
import { formatLat, formatLng } from "../../lib/format"
import { distanceKm } from "../../lib/geo"
import { mountMap, setBearing } from "../../lib/mapEngine"
import { mapView, measure } from "../../lib/mapState"
import { setSiteCoordinate } from "../../lib/objects"
import { findOperator, formatKeys, runOperator } from "../../lib/operators"
import { seasonLabel } from "../../lib/params"
import { PRODUCT_NAMES, findItem, isResult, project, renameItem, type TerrainResult } from "../../lib/project"
import { useActiveItem } from "../../lib/selection"
import { useStore } from "../../lib/store"
import { TOOLS, activeTool, overlays, type Overlays } from "../../lib/tools"
import { coordinatePrompt, lastOperation, lastOperationOpen, type MenuItem } from "../../lib/ui"
import { Legend } from "../energy/Legend"
import { StudioHeaderMenu, StudioHeaderPopover, StudioHeaderRule, StudioHeaderToggle } from "../studio/HeaderControls"
import { AreaHeader } from "../studio/StudioArea"
import { btnPrimary } from "../ui/buttons"
import { NumberField, TextField } from "../ui/Fields"
import { ParamFields } from "./ParamFields"

const op = (name: string, label?: string): MenuItem => ({ type: "op", op: name, label })
const sep: MenuItem = { type: "sep" }

const viewMenu = (): MenuItem[] => [op("FRAME_ALL"), op("FRAME_SELECTED"), sep, op("ZOOMIN"), op("ZOOMOUT"), op("NORTH"), sep, op("AREA_MAXIMIZE")]
const selectMenu = (): MenuItem[] => [op("TOOL_SELECT", "Select tool"), op("SELECT_NONE"), sep, op("FRAME_SELECTED")]
const addMenu = (): MenuItem[] => [
  op("TOOL_SITE", "Site, picked on the map"),
  { type: "action", label: "Site at coordinates…", run: () => coordinatePrompt.set(true) },
  op("TOOL_AREA", "Area, drawn on the map"),
]
const objectMenu = (): MenuItem[] => [
  op("RENAME"),
  op("HIDE"),
  op("UNHIDE_ALL"),
  op("DELETE"),
  { type: "heading", label: "Analyze" },
  op("SOLAR"),
  op("WIND"),
  op("TERRAIN"),
  op("RERUN"),
]

const OVERLAY_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "siteLabels", label: "Names" },
  { key: "areas", label: "Areas" },
  { key: "layers", label: "Result layers" },
  { key: "legend", label: "Legend" },
  { key: "statistics", label: "Credit and scale" },
]

const overlaysMenu = (): MenuItem[] => {
  const o = overlays.get()
  return [
    { type: "heading", label: "Overlays" },
    ...OVERLAY_ITEMS.map(
      (it): MenuItem => ({
        type: "action",
        label: it.label,
        checked: o[it.key],
        run: () => overlays.set((cur) => ({ ...cur, [it.key]: !cur[it.key] })),
      })
    ),
  ]
}

/** A plate floated over the map, as TERRA's reading cards over the globe. */
const PLATE = "pointer-events-auto rounded-sm border shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
const plateStyle = { background: "rgb(var(--p-ink) / 0.92)", borderColor: "rgb(var(--p-line) / 0.4)" }

/** The toolbar, down the area's left edge as Blender's T region. */
function Toolbar() {
  const tool = useStore(activeTool)
  return (
    <>
      {TOOLS.map((t) => {
        const operator = findOperator(t.operator)
        const IconC = operator?.icon
        const on = t.id === tool
        const key = operator?.keys?.[0]
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => void runOperator(t.operator)}
            title={`${t.label}${key ? ` (${formatKeys(key)})` : ""}\n${t.description}`}
            className={`flex size-6 items-center justify-center rounded-sm transition-colors ${
              on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
            }`}
          >
            {IconC && <IconC className="size-3.5" />}
          </button>
        )
      })}
    </>
  )
}

/** A compass whose N follows north: dragged, it turns the map; pressed, it puts north up. */
function Navigation() {
  const { bearing } = useStore(mapView)
  const drag = useRef<{ x: number; bearing: number; moved: boolean } | null>(null)
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1.5">
      <button
        type="button"
        title="Drag to turn the map · press for north up"
        aria-label="Compass"
        className="relative size-11 cursor-grab rounded-full active:cursor-grabbing"
        style={{ background: "rgb(var(--p-ink) / 0.72)", boxShadow: "inset 0 0 0 1px rgb(var(--p-line) / 0.4)" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, bearing, moved: false }
        }}
        onPointerMove={(e) => {
          const s = drag.current
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 2) s.moved = true
          if (s.moved) setBearing(s.bearing - dx * 0.8)
        }}
        onPointerUp={() => {
          const s = drag.current
          drag.current = null
          if (s && !s.moved) void runOperator("NORTH")
        }}
      >
        <svg viewBox="0 0 44 44" className="absolute inset-0" aria-hidden>
          <g style={{ transform: `rotate(${-bearing}deg)`, transformOrigin: "22px 22px" }}>
            <path d="M22 6 L26 22 L22 20 L18 22 Z" fill="rgb(97 167 255)" />
            <path d="M22 38 L26 22 L22 24 L18 22 Z" fill="rgb(145 145 145)" />
            <text x="22" y="5.5" textAnchor="middle" className="fill-[rgb(221_221_221)] font-mono text-[6px]">
              N
            </text>
          </g>
        </svg>
      </button>
      <div className="flex flex-col overflow-hidden rounded-sm border" style={{ background: "rgb(var(--p-ink) / 0.72)", borderColor: "rgb(var(--p-line) / 0.4)" }}>
        {[
          { name: "ZOOMIN", icon: MagnifyingGlassPlus },
          { name: "ZOOMOUT", icon: MagnifyingGlassMinus },
          { name: "FRAME_ALL", icon: House },
        ].map(({ name, icon: IconC }) => {
          const o = findOperator(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => void runOperator(name)}
              title={o ? `${o.label}${o.keys?.[0] ? ` (${formatKeys(o.keys[0])})` : ""}` : name}
              aria-label={o?.label}
              className="flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <IconC className="size-3.5" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The legend of the active terrain result, or of the newest one drawn. */
function LegendPlate() {
  const d = useStore(project).data
  const o = useStore(overlays)
  const active = useActiveItem()
  if (!o.legend || !o.layers) return null
  const drawn = d.results.filter((r): r is TerrainResult => r.kind === "terrain" && !r.hidden)
  const shown = active?.kind === "terrain" && !active.hidden ? active : drawn.at(-1)
  if (!shown) return null
  const source = findItem(d, shown.sourceId)
  return (
    <div className={`${PLATE} w-64 p-2.5`} style={plateStyle}>
      <p className="eyebrow !text-[9px]">Solar terrain</p>
      <p className="mb-1.5 text-emphasis italic text-foreground">{source?.name ?? shown.name}</p>
      <Legend scale={shown.data.scale} unit={shown.data.unit} title={seasonLabel(shown.data.season)} />
    </div>
  )
}

/** The distance being measured, while the Measure tool holds two points or one and the pointer. */
function MeasurePlate() {
  const pts = useStore(measure)
  const tool = useStore(activeTool)
  if (tool !== "measure") return null
  const km = pts.length === 2 ? distanceKm(pts[0], pts[1]) : null
  return (
    <div className={`${PLATE} px-2.5 py-2`} style={plateStyle}>
      <p className="eyebrow !text-[9px]">Measure</p>
      <p className="telemetry text-emphasis text-foreground">
        {km === null ? (pts.length ? "press the end point" : "press the start point") : km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`}
      </p>
    </div>
  )
}

/**
 * Adjust Last Operation, as Blender's redo panel: the last site added or
 * analysis run, with its fields. A site's fields edit it in place; an
 * analysis's fields are the settings, and Run again replaces its result.
 */
function RedoPlate() {
  const last = useStore(lastOperation)
  const open = useStore(lastOperationOpen)
  const d = useStore(project).data
  if (!last) return null
  const target = findItem(d, last.target)
  if (!target) return null
  const source = isResult(target) ? findItem(d, target.sourceId) : null
  const again = async () => {
    if (!isResult(target) || !source) return
    const id =
      target.kind === "terrain"
        ? source.kind === "area" && (await runTerrain(source, target.id))
        : source.kind === "site" && (await (target.kind === "solar" ? runSolar(source, target.id) : runWind(source, target.id)))
    if (id) lastOperation.set({ ...last, target: id })
  }
  return (
    <div className={`${PLATE} w-72 overflow-hidden`} style={plateStyle}>
      <button
        type="button"
        onClick={() => lastOperationOpen.set(!open)}
        aria-expanded={open}
        title={`Adjust last operation (${formatKeys("F9")})`}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-meta text-foreground hover:bg-hover"
      >
        {open ? <CaretDown className="size-2.5" /> : <CaretRight className="size-2.5" />}
        {last.label}
      </button>
      {open && (
        <div className="panel-scroll flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto border-t px-2 pb-2 pt-1.5" style={{ borderColor: "var(--hairline)" }}>
          {target.kind === "site" && (
            <>
              <TextField value={target.name} onCommit={(v) => renameItem(target.id, v)} ariaLabel="Name" />
              <NumberField
                label="Latitude"
                inlineLabel
                allowEmpty={false}
                value={target.lat}
                step={0.001}
                unit="°"
                onChange={(v) => v !== undefined && setSiteCoordinate(target.id, "lat", v)}
                validate={(v) => (Math.abs(v) <= 90 ? null : "Between -90 and 90")}
              />
              <NumberField
                label="Longitude"
                inlineLabel
                allowEmpty={false}
                value={target.lon}
                step={0.001}
                unit="°"
                onChange={(v) => v !== undefined && setSiteCoordinate(target.id, "lon", v)}
                validate={(v) => (Math.abs(v) <= 180 ? null : "Between -180 and 180")}
              />
            </>
          )}
          {isResult(target) && (
            <>
              <ParamFields group={target.kind} />
              <button type="button" className={btnPrimary} onClick={() => void again()} aria-disabled={!source} title={source ? undefined : "Its source has been deleted"}>
                Run {PRODUCT_NAMES[target.kind].toLowerCase()} again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const CREDITS = [
  { label: "MapLibre", href: "https://maplibre.org" },
  { label: "OpenFreeMap", href: "https://openfreemap.org" },
  { label: "© OpenMapTiles", href: "https://www.openmaptiles.org/" },
  { label: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
]

/** The zoom and the credit at the map's foot, as TERRA writes them under the globe. */
function Foot() {
  const { zoom } = useStore(mapView)
  const o = useStore(overlays)
  if (!o.statistics) return null
  return (
    <p className="telemetry pointer-events-auto absolute bottom-1.5 left-2 flex flex-wrap items-center gap-x-1.5 text-[9px] text-foreground/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
      <span>z{zoom.toFixed(1)}</span>
      {CREDITS.map((c, i) => (
        <span key={c.label} className="flex items-center gap-1.5">
          {i === 1 ? "|" : ""}
          {/* A button calling BrowserOpenURL: an anchor with a blank target opens nothing in this webview. */}
          <button type="button" onClick={() => BrowserOpenURL(c.href)} className="cursor-pointer hover:text-foreground hover:underline">
            {c.label}
          </button>
        </span>
      ))}
      <span className="text-muted-foreground">· {BASEMAP_NAME}</span>
    </p>
  )
}

export function MapEditor() {
  const container = useRef<HTMLDivElement>(null)
  const o = useStore(overlays)
  const view = useStore(mapView)

  useEffect(() => {
    const el = container.current
    if (!el) return
    return mountMap(el)
  }, [])

  return (
    <>
      <AreaHeader
        menus={
          <>
            <StudioHeaderMenu label="View" items={viewMenu} />
            <StudioHeaderMenu label="Select" items={selectMenu} />
            <StudioHeaderMenu label="Add" items={addMenu} />
            <StudioHeaderMenu label="Object" items={objectMenu} />
          </>
        }
        centre={
          <span className="telemetry header-label text-[9px] text-muted-foreground">
            {formatLat(view.lat, 3)} {formatLng(view.lng, 3)}
          </span>
        }
        options={
          <>
            <StudioHeaderToggle
              icon={Tag}
              label="Names"
              on={o.siteLabels}
              onToggle={() => overlays.set((c) => ({ ...c, siteLabels: !c.siteLabels }))}
              title="Draw the names of sites and areas"
            />
            <StudioHeaderRule />
            <StudioHeaderPopover icon={Stack} label="Overlays" items={overlaysMenu} align="end" />
          </>
        }
        toolbar={<Toolbar />}
      />
      <div className="relative min-h-0 flex-1" style={{ background: "var(--s-field)" }}>
        {/*
          The map's element is moved in and out of this container (mapEngine):
          one MapLibre instance for the application, never torn down on a
          workspace switch.
        */}
        <div ref={container} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute right-2 top-2">
            <Navigation />
          </div>
          <div className="absolute left-2 top-2 flex flex-col items-start gap-2">
            <LegendPlate />
            <MeasurePlate />
          </div>
          <div className="absolute bottom-7 left-2">
            <RedoPlate />
          </div>
          <Foot />
        </div>
      </div>
    </>
  )
}
