import { useEffect, useRef } from "react"
import { Map as MapLibreMap, Marker } from "maplibre-gl"
import { BASEMAP_NAME, BASEMAP_STYLE } from "../../lib/basemap"
import { findCommand, runCommand } from "../../lib/commands"
import { HOME_VIEW, attachMap, mapView, onMapClick } from "../../lib/mapController"
import { placeSite, site } from "../../lib/site"
import { useStore } from "../../lib/store"

// The viewport toolbar, top to bottom. Each entry is a command name.
const TOOLBAR = ["ZOOMIN", "ZOOMOUT", "HOME"]

/** Needle that keeps pointing north as the map rotates; pressing it resets. */
function CompassButton() {
  const { bearing } = useStore(mapView)
  return (
    <button
      type="button"
      onClick={() => void runCommand("NORTH")}
      title="North Up (NORTH)"
      className="absolute right-3 top-3 grid h-14 w-14 place-items-center rounded-full border border-line bg-raised/85 shadow-lg backdrop-blur hover:bg-hover"
    >
      <svg
        viewBox="0 0 40 40"
        className="h-10 w-10"
        style={{ transform: `rotate(${-bearing}deg)` }}
        aria-hidden="true"
      >
        <polygon points="20,4 25,20 15,20" className="fill-accent" />
        <polygon points="20,36 25,20 15,20" className="fill-muted/60" />
        <text x="20" y="3.5" textAnchor="middle" className="fill-ink text-[7px] font-semibold">
          N
        </text>
      </svg>
    </button>
  )
}

function Toolbar() {
  return (
    <div className="absolute right-3 top-20 flex flex-col overflow-hidden rounded border border-line bg-raised/85 shadow-lg backdrop-blur">
      {TOOLBAR.map((name) => {
        const cmd = findCommand(name)
        if (!cmd) return null
        const IconComponent = cmd.icon
        return (
          <button
            key={name}
            type="button"
            onClick={() => void runCommand(name)}
            title={`${cmd.label} (${cmd.name})`}
            className="grid h-9 w-9 place-items-center text-ink/90 hover:bg-hover"
          >
            <IconComponent size={18} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

/** The prompt shown while SITE waits for a click. */
function PickingHint() {
  const { picking } = useStore(site)
  if (!picking) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
      <span className="rounded border border-accent/60 bg-raised/90 px-3 py-1.5 text-xs text-ink shadow-lg backdrop-blur">
        Click the map to place the site · Esc cancels
      </span>
    </div>
  )
}

export function Viewport() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const map = new MapLibreMap({
      container: el,
      style: BASEMAP_STYLE,
      ...HOME_VIEW,
      attributionControl: { compact: true },
    })
    const detach = attachMap(map)
    // MapLibre follows the window's size, not its container's. Showing or
    // hiding a panel resizes the viewport without resizing the window.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(el)

    // The site marker and the picking cursor follow the site store.
    const markerEl = document.createElement("div")
    markerEl.className = "site-marker"
    const marker = new Marker({ element: markerEl })
    const showSite = () => {
      const { point, picking } = site.get()
      if (point) marker.setLngLat([point.lon, point.lat]).addTo(map)
      else marker.remove()
      map.getCanvas().style.cursor = picking ? "crosshair" : ""
    }
    showSite()
    const unsubscribeSite = site.subscribe(showSite)
    const unsubscribeClick = onMapClick((at) => {
      if (site.get().picking) placeSite({ lon: at.lng, lat: at.lat })
    })

    return () => {
      unsubscribeClick()
      unsubscribeSite()
      marker.remove()
      observer.disconnect()
      detach()
      // remove() releases the WebGL context. Without it every remount leaks
      // one, and the webview stops creating contexts after a small number.
      map.remove()
    }
  }, [])

  return (
    <div className="relative min-w-0 flex-1 bg-surface">
      <div ref={container} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-2 top-2 flex gap-1 text-[11px]">
        <span className="rounded-sm border border-line bg-raised/85 px-1.5 py-0.5 text-ink/90">Map</span>
        <span className="rounded-sm border border-line bg-raised/85 px-1.5 py-0.5 text-ink/90">
          {BASEMAP_NAME}
        </span>
      </div>
      <CompassButton />
      <Toolbar />
      <PickingHint />
    </div>
  )
}
