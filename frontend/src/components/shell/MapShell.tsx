import { useEffect, useRef, useState } from "react"
import { loadAccount } from "../../lib/account"
import { listenForProgress } from "../../lib/analysis"
import { loadDefaults } from "../../lib/defaults"
import { checkGridStore } from "../../lib/grid"
import { mountMap } from "../../lib/mapEngine"
import { cursor } from "../../lib/mapState"
import { installKeymap } from "../../lib/operators"
import { watchProjectState } from "../../lib/projectFile"
import { hoveredArea } from "../../lib/screen"
import { shell } from "../../lib/shell"
import { checkSidecar } from "../../lib/sidecarStatus"
import { useStore } from "../../lib/store"
import { overlays } from "../../lib/tools"
import { AddressSearch } from "../editors/AddressSearch"
import { BasemapSwitch, Foot, MeasurePlate, RedoPlate, WindReadout } from "../editors/MapEditor"
import { MapLegend } from "../editors/MapLegend"
import { OverlayCallouts } from "../editors/OverlayCallouts"
import { WeatherTimeline } from "../editors/WeatherTimeline"
import { ConfirmDialog, CoordinatesDialog, OperatorSearch, PlaceDialog } from "../studio/Dialogs"
import { ContextMenuHost, StudioSurface } from "../studio/Popover"
import { Settings } from "../studio/Settings"
import { StartSplash } from "../studio/StartSplash"
import { Toasts } from "../studio/Toasts"
import { ErrorBoundary } from "../ui/ErrorBoundary"
import { Destinations } from "./Destinations"
import { MapCamera, MapTools } from "./MapTools"
import { ActivityPanel, LayersPanel, PlacesPanel, ProductsPanel, ResultPanel } from "./Panels"
import { ShellRail, ShellTopBar } from "./ShellChrome"

/**
 * The main window, as TERRA's map shell: the map fills it, a rail on the left
 * says where a reader can go, a column on the right holds the tools for what is
 * on the map, and one panel shows at a time. Compare, planning and the run
 * graph are destinations that fill the window beside the rail.
 *
 * THE MAP IS THE GROUND, NOT AN EDITOR. The studio held it in one area among
 * others and covered it to do anything; here everything else is held up in
 * front of it, and the camera frames what it is sent to clear of what covers it.
 */
export function MapShell() {
  const s = useStore(shell)
  const o = useStore(overlays)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    return mountMap(el)
  }, [])

  useEffect(() => {
    void checkSidecar().then((st) => {
      if (st.kind === "ready") {
        void loadDefaults()
        // Quietly: a missing store is a state Settings and the run graph show, not news at launch.
        void checkGridStore()
      }
    })
    void loadAccount()
  }, [])

  // One of each for the application; each cleanup keeps StrictMode's second mount from adding another.
  useEffect(() => listenForProgress(), [])
  useEffect(() => installKeymap(), [])
  useEffect(() => watchProjectState(), [])

  // A desktop window offers no webview menu (Reload, Inspect), except in fields, where Copy and Paste live.
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, .selectable, .telemetry")) e.preventDefault()
    }
    window.addEventListener("contextmenu", onContext)
    return () => window.removeEventListener("contextmenu", onContext)
  }, [])

  const panel = s.destination === "explore" ? s.panel : null

  const weather = o.weatherSatellite || o.weatherRadar || o.weatherWind

  return (
    <div ref={setRoot} className="app-shell-enter flex h-full" style={{ background: "var(--s-app)" }}>
      <StudioSurface.Provider value={root}>
        {/*
          The rail runs the full height and the band starts beside it, so the
          traffic lights sit on the rail's head and the header's contents start
          clear of them whatever the rail's width.
        */}
        <ShellRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ShellTopBar />
          <main className="app-no-drag relative min-h-0 min-w-0 flex-1 overflow-hidden" style={{ background: "var(--s-field)" }}>
            {/*
              The map's element is moved in and out of this container (mapEngine):
              one MapLibre instance for the application.
            */}
            <div
              ref={container}
              className="absolute inset-0"
              onMouseEnter={() => hoveredArea.set({ id: "shell:map", editor: "map" })}
              onMouseLeave={() => {
                if (hoveredArea.get().id === "shell:map") hoveredArea.set({ id: null, editor: null })
              }}
            />
            <OverlayCallouts />
            <div className="pointer-events-none absolute inset-0 z-20">
              <WindReadout />
              <div className="absolute left-3 top-3 flex flex-col items-start gap-2">
                <AddressSearch />
                <MeasurePlate />
              </div>
              {/* Every layer's key in one place, over the ground's tile, where the ground is least often the subject. */}
              <div className="absolute bottom-7 left-3 flex flex-col items-start gap-2">
                <MapLegend />
                <div className="flex items-end gap-2">
                  <BasemapSwitch />
                  <RedoPlate />
                </div>
              </div>
              <Foot />
            </div>
            <Coordinates />
            <div className="absolute bottom-3 right-3 z-30">
              <MapCamera />
            </div>
            {weather && (
              <div className="map-chrome absolute bottom-10 left-1/2 z-30 w-[min(40rem,calc(100%-30rem))] -translate-x-1/2 overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)]">
                <WeatherTimeline />
              </div>
            )}
            <MapTools />
            <ErrorBoundary key={panel ?? "none"} label="The panel">
              {panel === "places" && <PlacesPanel />}
              {panel === "products" && <ProductsPanel />}
              {panel === "result" && <ResultPanel />}
              {panel === "layers" && <LayersPanel />}
              {panel === "activity" && <ActivityPanel />}
            </ErrorBoundary>
            <Destinations />
            <StartSplash />
            <ContextMenuHost />
          </main>
        </div>
      </StudioSurface.Provider>
      <OperatorSearch />
      <CoordinatesDialog />
      <PlaceDialog />
      <Settings />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}

/** Where the pointer is, beside the camera's corner: the status bar's one reading that belongs on the map. */
function Coordinates() {
  const at = useStore(cursor)
  if (!at) return null
  return (
    <span className="telemetry pointer-events-none absolute bottom-3 right-[3.5rem] z-30 rounded-sm px-2 py-1 text-meta tabular-nums text-foreground" style={{ background: "rgb(var(--p-ink) / 0.82)" }}>
      {at.lat.toFixed(5)}, {at.lng.toFixed(5)}
    </span>
  )
}
