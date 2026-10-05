import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { MagnifyingGlass, X } from "../../lib/icons"
import { errorMessage } from "../../lib/errors"
import { frameItem } from "../../lib/mapEngine"
import { addArea, addSite, validLonLat } from "../../lib/objects"
import { catalogue, outline, search, type Boundary } from "../../lib/places"
import { note } from "../../lib/reports"
import { artSrc, operatorArt } from "../../lib/art"
import { formatKeys, pollOperator, runOperator, searchOperators, usePollTick } from "../../lib/operators"
import { useStore } from "../../lib/store"
import { confirmRequest, coordinatePrompt, lastOperation, operatorSearch, placePrompt } from "../../lib/ui"
import { btnGhost, btnIcon, btnPrimary, fieldInput } from "../ui/buttons"

/**
 * A dialog, as TERRA's ModalShell: a scrim, a panel with the container
 * radius, Escape and the scrim to dismiss, focus kept inside and handed back.
 */
export function ModalShell({
  label,
  onDismiss,
  children,
  className = "",
}: {
  label: string
  onDismiss: () => void
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.querySelector<HTMLElement>("input, select, button:not([data-dismiss])")?.focus()
    // A dialog is open, so nothing underneath acts on Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      e.preventDefault()
      onDismiss()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [onDismiss])

  return createPortal(
    <div
      className="app-no-drag fixed inset-0 z-[2000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onPointerDown={(e) => e.target === e.currentTarget && onDismiss()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return
          const nodes = ref.current?.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex='0']")
          if (!nodes?.length) return
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            last.focus()
            e.preventDefault()
          } else if (!e.shiftKey && document.activeElement === last) {
            first.focus()
            e.preventDefault()
          }
        }}
        className={`flex max-h-[88vh] flex-col overflow-hidden rounded-md border bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.55)] ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

/** A dialog's head: what it is, and the way out. */
export function DialogHead({ eyebrow, title, onDismiss }: { eyebrow?: string; title: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b px-4 pb-3 pt-3.5" style={{ borderColor: "var(--hairline)" }}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-0.5 truncate text-heading font-semibold text-foreground">{title}</h2>
      </div>
      <button type="button" data-dismiss onClick={onDismiss} aria-label="Close" className={btnIcon}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function ConfirmDialog() {
  const req = useStore(confirmRequest)
  if (!req) return null
  return (
    <ModalShell label={req.title} onDismiss={() => req.resolve("cancel")} className="w-[26rem]">
      <DialogHead title={req.title} onDismiss={() => req.resolve("cancel")} />
      <p className="px-4 py-3 text-body leading-relaxed text-muted-foreground">{req.message}</p>
      <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
        {req.buttons.map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => req.resolve(b.value)}
            className={
              b.primary
                ? btnPrimary
                : b.danger
                  ? `${btnGhost} hover:!bg-destructive hover:!text-destructive-foreground`
                  : btnGhost
            }
          >
            {b.label}
          </button>
        ))}
      </div>
    </ModalShell>
  )
}

/** A site typed rather than picked. */
export function CoordinatesDialog() {
  const open = useStore(coordinatePrompt)
  const [lat, setLat] = useState("")
  const [lon, setLon] = useState("")
  const [name, setName] = useState("Site")
  if (!open) return null
  const close = () => coordinatePrompt.set(false)
  const la = Number(lat.replace(",", "."))
  const lo = Number(lon.replace(",", "."))
  const valid = lat.trim() !== "" && lon.trim() !== "" && validLonLat(lo, la)
  const add = () => {
    if (!valid) return
    const id = addSite(lo, la, name.trim() || "Site")
    lastOperation.set({ operator: "SITE_ADD", label: "Add Site", kind: "site", target: id })
    close()
  }
  return (
    <ModalShell label="Site at coordinates" onDismiss={close} className="w-[22rem]">
      <DialogHead eyebrow="Add" title="Site at coordinates" onDismiss={close} />
      <form
        className="flex flex-col gap-3 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="eyebrow !text-[9px]">Name</span>
          <input className={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="eyebrow !text-[9px]">Latitude</span>
            <input className={`${fieldInput} telemetry`} inputMode="decimal" placeholder="-15.79" value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow !text-[9px]">Longitude</span>
            <input className={`${fieldInput} telemetry`} inputMode="decimal" placeholder="-47.88" value={lon} onChange={(e) => setLon(e.target.value)} />
          </label>
        </div>
        <p className="text-meta text-muted-foreground">Decimal degrees, WGS 84. South and west are negative.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={close}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} aria-disabled={!valid} title={valid ? undefined : "A latitude within ±90 and a longitude within ±180"}>
            Add site
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

/**
 * An area taken from a published boundary, found by name.
 *
 * WHY THIS AND NOT A DRAWING. A drawn polygon is ground nobody published: it
 * crosses whatever boundary the register answering the question ends at, and
 * the reading comes back about the part that register happened to reach. A
 * municipality or a state is the shape the official figures are computed on,
 * so a reading over it can be compared with a published number.
 *
 * The catalogue is fetched once and searched here, so the list answers while
 * the name is typed. The outline is fetched only for the entry chosen.
 */
function PlaceDialogBody() {
  const [all, setAll] = useState<Boundary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState<number | string | null>(null)
  const close = () => placePrompt.set(false)

  useEffect(() => {
    let alive = true
    catalogue().then(
      (rows) => alive && setAll(rows),
      (e) => alive && setError(errorMessage(e))
    )
    return () => {
      alive = false
    }
  }, [])

  const hits = all ? search(all, query) : []

  const take = async (place: Boundary) => {
    setBusy(place.id)
    setError(null)
    try {
      const { polygon, parts } = await outline(place)
      const id = addArea(polygon, place.level === "estados" ? place.name : `${place.name} (${place.uf})`)
      if (parts > 1) {
        // The area is one ring, so the islands and exclaves of this boundary
        // are not in it. Said here rather than left for the reading to be
        // quietly short by them.
        note(`${place.name} is published in ${parts} parts; the largest is the area, the rest are not in it.`)
      }
      frameItem({ kind: "area", id, name: place.name, polygon, hidden: false })
      lastOperation.set(null)
      close()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ModalShell label="Area from a place" onDismiss={close} className="w-[26rem]">
      <DialogHead eyebrow="Add" title="Area from a place" onDismiss={close} />
      <div className="flex flex-col gap-2 px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow !text-[9px]">State or municipality</span>
          <input
            autoFocus
            className={fieldInput}
            placeholder={all ? "Natal, Ceará, RN…" : "Reading the IBGE catalogue…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!all}
          />
        </label>

        <div className="max-h-64 overflow-y-auto">
          {hits.map((p) => (
            <button
              key={`${p.level}-${p.id}`}
              type="button"
              disabled={busy !== null}
              onClick={() => void take(p)}
              className="flex w-full items-baseline justify-between gap-3 rounded-[4px] px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40"
            >
              <span className="truncate text-[13px] text-foreground">{p.name}</span>
              <span className="shrink-0 text-meta text-muted-foreground">
                {busy === p.id ? "reading the outline…" : p.level === "estados" ? "State" : `Municipality · ${p.uf}`}
              </span>
            </button>
          ))}
          {all && query.trim().length >= 2 && !hits.length ? (
            <p className="px-2 py-1.5 text-meta text-muted-foreground">Nothing in the catalogue by that name.</p>
          ) : null}
        </div>

        <p className="text-meta text-muted-foreground">
          Boundaries from IBGE, the register the official figures are drawn on. Needs the internet; the catalogue is
          read once per session.
        </p>
        {error ? <p className="text-meta text-destructive-quiet">{error}</p> : null}
      </div>
    </ModalShell>
  )
}

export function PlaceDialog() {
  return useStore(placePrompt) ? <PlaceDialogBody /> : null
}

/** Every operator by name, with where it lives, its shortcut, and why it cannot run when it cannot. */
export function OperatorSearch() {
  const open = useStore(operatorSearch)
  return open ? <OperatorSearchBody /> : null
}

function OperatorSearchBody() {
  usePollTick()
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const results = useMemo(() => searchOperators(query), [query])
  const close = () => operatorSearch.set(false)

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" })
  }, [index])

  const run = (i: number) => {
    const op = results[i]
    if (!op || pollOperator(op) !== true) return
    close()
    void runOperator(op.name)
  }

  return createPortal(
    <div className="app-no-drag fixed inset-0 z-[2000] bg-black/40" onPointerDown={close}>
      <div
        role="dialog"
        aria-label="Search operators"
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-1/2 top-[14%] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-md border shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{ background: "var(--s-float)", borderColor: "rgb(var(--p-line-strong) / 0.5)" }}
      >
        <div className="flex items-center gap-2 border-b px-3" style={{ borderColor: "var(--hairline)" }}>
          <MagnifyingGlass className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search operators"
            role="combobox"
            aria-expanded="true"
            aria-controls="operator-search-list"
            aria-activedescendant={results[index] ? `op-${results[index].name}` : undefined}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIndex((i) => Math.min(results.length - 1, i + 1))
              else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1))
              else if (e.key === "Enter") run(index)
              else if (e.key === "Escape") close()
              else return
              e.preventDefault()
              e.stopPropagation()
            }}
            className="h-9 flex-1 bg-transparent text-emphasis text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="telemetry text-[9px] text-muted-foreground">{formatKeys("F3")}</span>
        </div>
        <ul ref={list} id="operator-search-list" role="listbox" className="panel-scroll max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && <li className="px-3 py-2 text-meta text-muted-foreground">No operator matches.</li>}
          {results.map((op, i) => {
            const poll = pollOperator(op)
            const disabled = poll !== true
            const IconC = op.icon
            const on = i === index
            return (
              <li
                key={op.name}
                id={`op-${op.name}`}
                data-index={i}
                role="option"
                aria-selected={on}
                aria-disabled={disabled || undefined}
                title={disabled ? poll : op.description}
                onPointerEnter={() => setIndex(i)}
                onClick={() => run(i)}
                className={`flex items-center gap-2 px-3 py-[5px] text-meta ${on ? "bg-accent-dim" : ""} ${disabled ? "text-muted-foreground/50" : "text-foreground"}`}
              >
                <span className="flex size-3 shrink-0 items-center justify-center">
                  {artSrc(operatorArt(op.name)) ? (
                    <img src={artSrc(operatorArt(op.name))} alt="" draggable={false} className={`size-3.5 max-w-none ${disabled ? "opacity-40 grayscale" : ""}`} />
                  ) : (
                    IconC && <IconC className="size-3 text-muted-foreground" />
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground">{op.menu} ›</span>
                <span className="min-w-0 flex-1 truncate">{op.label}</span>
                {disabled && on && <span className="max-w-[45%] truncate text-[9px] text-warning">{poll}</span>}
                {op.keys?.[0] && <span className="telemetry shrink-0 text-[9px] text-muted-foreground">{formatKeys(op.keys[0])}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body
  )
}
