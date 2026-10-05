import { useEffect, useRef, useState } from "react"
import { MagnifyingGlass, MapPin, X } from "../../lib/icons"
import { errorMessage } from "../../lib/errors"
import { asCoordinates, searchAddress, type Found } from "../../lib/geocode"
import { framePolygon } from "../../lib/mapEngine"
import { mapView } from "../../lib/mapState"
import { addSite } from "../../lib/objects"
import { formatKeys } from "../../lib/operators"
import { useStore } from "../../lib/store"
import { addressSearchOpen } from "../../lib/ui"

/**
 * The map's address search: a field at the map's corner while the ribbon's
 * Locate has it open, and under it the places the text could be.
 *
 * A RESULT IS SOMEWHERE TO LOOK, AND ONLY BECOMES A SITE WHEN ASKED. Pressing
 * a row takes the map there and leaves the project as it was; the pin at the
 * row's end adds a site at that point, named for the place. Looking for a
 * street should not put anything in the project.
 *
 * IT ASKS AFTER A PAUSE, from three letters on, and drops the answer to a
 * question the reader has already typed past. Coordinates are read here and
 * not sent anywhere.
 */

type State =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "found"; places: Found[] }
  | { kind: "failed"; message: string }

const PAUSE_MS = 350
const MIN_LETTERS = 3

const PLATE = "pointer-events-auto rounded-sm border shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
const plateStyle = { background: "rgb(var(--p-ink) / 0.92)", borderColor: "rgb(var(--p-line) / 0.4)" }

function goTo(place: Found): void {
  const ring = place.extent
    ? [
        [place.extent[0], place.extent[1]],
        [place.extent[2], place.extent[1]],
        [place.extent[2], place.extent[3]],
        [place.extent[0], place.extent[3]],
      ]
    : [[place.lon, place.lat]]
  framePolygon({ type: "Polygon", coordinates: [ring] })
}

export function AddressSearch() {
  const open = useStore(addressSearchOpen)
  const [query, setQuery] = useState("")
  const [state, setState] = useState<State>({ kind: "idle" })
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) input.current?.select()
  }, [open])

  useEffect(() => {
    const text = query.trim()
    const typed = asCoordinates(text)
    setAt(0)
    if (typed) {
      setState({ kind: "found", places: [typed] })
      return
    }
    if (text.length < MIN_LETTERS) {
      setState({ kind: "idle" })
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ kind: "searching" })
      const { lng, lat } = mapView.get()
      searchAddress(text, { lng, lat }, abort.signal)
        .then((places) => setState({ kind: "found", places }))
        .catch((e) => {
          if (!abort.signal.aborted) setState({ kind: "failed", message: errorMessage(e) })
        })
    }, PAUSE_MS)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [query])

  const close = () => addressSearchOpen.set(false)
  const places = state.kind === "found" ? state.places : []

  const take = (place: Found) => {
    goTo(place)
    close()
  }
  const pin = (place: Found) => {
    addSite(place.lon, place.lat, place.name)
    goTo(place)
    close()
  }

  // Folded, it is not on the map at all: Locate, on the ribbon, is what opens it.
  if (!open) return null

  return (
    <div className={`${PLATE} w-72 overflow-hidden`} style={plateStyle} role="search">
      <div className="flex h-7 items-center gap-1.5 px-2">
        <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation()
              close()
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              if (places.length) setAt((i) => (i + (e.key === "ArrowDown" ? 1 : places.length - 1)) % places.length)
            } else if (e.key === "Enter" && places[at]) {
              // Shift keeps the place: a site at it, as the pin at the row's end does.
              if (e.shiftKey) pin(places[at])
              else take(places[at])
            }
          }}
          placeholder="Address, place, or latitude, longitude"
          aria-label="Find an address"
          spellCheck={false}
          className="selectable min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={close}
          title="Close (Esc)"
          aria-label="Close the search"
          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>

      {state.kind !== "idle" && (
        <div className="border-t py-1" style={{ borderColor: "var(--hairline)" }}>
          {state.kind === "searching" && <p className="px-2 py-1 text-meta text-muted-foreground">Searching…</p>}
          {state.kind === "failed" && (
            <p className="px-2 py-1 text-meta text-destructive-quiet">The address service did not answer: {state.message}</p>
          )}
          {state.kind === "found" && !places.length && (
            <p className="px-2 py-1 text-meta text-muted-foreground">Nothing by that name in OpenStreetMap.</p>
          )}
          {places.map((place, i) => (
            <div
              key={place.id}
              onPointerEnter={() => setAt(i)}
              className={`flex items-center gap-1 pl-2 pr-1 ${i === at ? "bg-accent-dim" : ""}`}
            >
              <button type="button" onClick={() => take(place)} title="Take the map there" className="min-w-0 flex-1 py-1 text-left">
                <span className="block truncate text-body text-foreground">{place.name}</span>
                {place.detail && <span className="block truncate text-meta text-muted-foreground">{place.detail}</span>}
              </button>
              <button
                type="button"
                onClick={() => pin(place)}
                title={`Add a site here (${formatKeys("Shift+Enter")})`}
                aria-label={`Add a site at ${place.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <MapPin className="size-3.5" />
              </button>
            </div>
          ))}
          {state.kind === "found" && places[0]?.id !== "coordinates" && (
            <p className="telemetry px-2 pt-1 text-[9px] text-muted-foreground">Photon by komoot · © OpenStreetMap</p>
          )}
        </div>
      )}
    </div>
  )
}
