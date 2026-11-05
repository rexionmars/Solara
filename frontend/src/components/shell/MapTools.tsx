import type { ReactNode } from "react"
import { ShellGlyph } from "../../lib/icons"
import { findOperator, runOperator, usePollTick } from "../../lib/operators"
import { shell, togglePanel, type ShellPanelId } from "../../lib/shell"
import { useStore } from "../../lib/store"
import { activeTool, setTool } from "../../lib/tools"
import { addressSearchOpen, coordinatePrompt } from "../../lib/ui"
import { useActiveItem } from "../../lib/selection"
import { MapBar, MapBarRule, MapButton } from "./MapChrome"

/** A button that runs an operator, and says why it cannot when its poll refuses. */
function OperatorMapButton({ name, label, active, children }: { name: string; label: string; active?: boolean; children: ReactNode }) {
  usePollTick()
  const polled = findOperator(name)?.poll?.() ?? true
  return (
    <MapButton label={label} active={active} disabled={polled === true ? false : polled} onClick={() => void runOperator(name)}>
      {children}
    </MapButton>
  )
}

/**
 * The column at the map's right edge.
 *
 * THE SHELL'S OWN PANELS FIRST, then the map's tools. The column reads in the
 * order the work happens: what can be computed here, what it read, what is
 * drawn; then find the place, put something on it, look at it.
 */
export function MapTools() {
  const { panel, destination } = useStore(shell)
  const tool = useStore(activeTool)
  const searching = useStore(addressSearchOpen)
  const active = useActiveItem()
  const on = (id: ShellPanelId) => destination === "explore" && panel === id
  return (
    <MapBar className="app-no-drag absolute right-3 top-3 z-30 flex flex-col">
      <MapButton label="Products: what can be computed at the site or area in hand" active={on("products")} onClick={() => togglePanel("products")}>
        <ShellGlyph.Sparkle className="size-4" />
      </MapButton>
      <MapButton label="Result: the reading of a run" active={on("result")} onClick={() => togglePanel("result")}>
        <ShellGlyph.ChartLine className="size-4" />
      </MapButton>
      <MapButton label="Layers: what the map draws" active={on("layers")} onClick={() => togglePanel("layers")}>
        <ShellGlyph.Stack className="size-4" />
      </MapButton>
      <MapBarRule />
      <MapButton label="Search for a place" active={searching} onClick={() => (searching ? addressSearchOpen.set(false) : void runOperator("LOCATE"))}>
        <ShellGlyph.MagnifyingGlass className="size-4" />
      </MapButton>
      <MapButton label="Place a site (P)" active={tool === "site"} onClick={() => (tool === "site" ? setTool("select") : void runOperator("TOOL_SITE"))}>
        <ShellGlyph.MapPin className="size-4" />
      </MapButton>
      <OperatorMapButton name="AREA_PLACE" label="Area from a place: a published boundary">
        <ShellGlyph.Pentagon className="size-4" />
      </OperatorMapButton>
      <MapButton label="Site at coordinates" onClick={() => coordinatePrompt.set(true)}>
        <ShellGlyph.Crosshair className="size-4" />
      </MapButton>
      <MapButton label="Measure a distance (M)" active={tool === "measure"} onClick={() => (tool === "measure" ? setTool("select") : void runOperator("TOOL_MEASURE"))}>
        <ShellGlyph.Ruler className="size-4" />
      </MapButton>
      <OperatorMapButton name="FRAME_ALL" label="Frame every site and area (Home)">
        <ShellGlyph.CornersOut className="size-4" />
      </OperatorMapButton>
      {/* Withheld with nothing in hand, rather than shown doing nothing. */}
      {active && (
        <OperatorMapButton name="DELETE" label={`Delete ${active.name}`}>
          <ShellGlyph.Trash className="size-4" />
        </OperatorMapButton>
      )}
    </MapBar>
  )
}

/** Zoom and north, in the corner the camera's controls keep in every map the reader has used. */
export function MapCamera() {
  return (
    <MapBar className="app-no-drag flex flex-col">
      <OperatorMapButton name="ZOOMIN" label="Zoom in">
        <ShellGlyph.Plus className="size-4" />
      </OperatorMapButton>
      <OperatorMapButton name="ZOOMOUT" label="Zoom out">
        <ShellGlyph.Minus className="size-4" />
      </OperatorMapButton>
      <OperatorMapButton name="NORTH" label="North up">
        <ShellGlyph.NavigationArrow className="size-4 -rotate-45" />
      </OperatorMapButton>
    </MapBar>
  )
}
