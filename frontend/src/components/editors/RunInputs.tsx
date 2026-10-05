import { useEffect } from "react"
import { lastFailure, running } from "../../lib/analysis"
import { productBlocked } from "../../lib/capabilities"
import { defaults } from "../../lib/defaults"
import { polygonAreaKm2 } from "../../lib/geo"
import { checkGridStore, gridStore, loadReach, reachByArea, reachSaid, storeReachable } from "../../lib/grid"
import { Warning } from "../../lib/icons"
import { isAreaProduct, project, type AreaObject, type Product, type SiteObject } from "../../lib/project"
import { runComparison, runInputRows, type RunInputRow } from "../../lib/runGraph"
import { STATE_COLOUR, STATE_NOTE } from "../../lib/runValue"
import { useStore } from "../../lib/store"

/**
 * Everything a run of one product would read, each with what it holds now and
 * whether the newest run read it: the run graph's wires, as rows.
 *
 * WHY IT IS HERE AS WELL. A run is started from the product's card in
 * Properties, and a button with none of its inputs beside it is pressed
 * without knowing over what ground, from which register, with which values.
 * The graph answered that on a board of its own; this answers it where the
 * button is. Both read runGraph.ts, so they cannot say different things.
 */

const READS_STORE: readonly Product[] = ["connection", "demand"]

type Listed = {
  rows: RunInputRow[]
  /** Why the store row is not supplied, where the store itself is the reason. */
  storeWhy: string | null
  /** How much of the ground the register covers: asked only by the product whose register is partial. */
  coverage: { said: string; low: boolean } | null
  failed: boolean
}

export function useRunInputs(product: Product, source: SiteObject | AreaObject | null): Listed {
  const d = useStore(project).data
  const engine = useStore(defaults)
  const run = useStore(running)
  const failure = useStore(lastFailure)
  const store = useStore(gridStore)
  const area = source?.kind === "area" ? source : null

  const readsStore = READS_STORE.includes(product)
  useEffect(() => {
    if (readsStore && gridStore.get().kind === "unknown") void checkGridStore()
  }, [readsStore])
  const storeWhy = readsStore ? productBlocked(product, store) : null
  // Asked only of a store that can answer: one that cannot is already said on its own row.
  const measured = product === "demand" && !!area && !storeWhy
  const probe = useStore(reachByArea)[area?.id ?? ""]?.state
  useEffect(() => {
    if (measured && area) loadReach(area.id, area.polygon)
  }, [measured, area?.id, area?.polygon])

  const busy = !!run && run.product === product && run.sourceId === source?.id
  const compared = runComparison(d, product, source, storeReachable(store) && !storeWhy, engine, failure)
  const rows = runInputRows(product, compared, busy).map((row) =>
    row.id === "area" && area ? { ...row, reading: `${row.reading} · ${polygonAreaKm2(area.polygon).toFixed(0)} km²` } : row
  )
  return {
    rows,
    storeWhy,
    coverage: measured && area ? reachSaid(area.name, probe) : null,
    failed: !busy && !!compared.last && !compared.last.ok,
  }
}

const EMPTY: Partial<Record<RunInputRow["id"], string>> = { site: "no site selected", area: "no area selected" }

export function RunInputs({ product, source }: { product: Product; source: SiteObject | AreaObject | null }) {
  const { rows, storeWhy, coverage, failed } = useRunInputs(product, source)
  return (
    <div className="flex flex-col gap-1">
      <p className="eyebrow !text-[9px]">Reads</p>
      <ul className="flex flex-col" aria-label={`What a run reads over ${isAreaProduct(product) ? "the area" : "the site"}`}>
        {rows.map((row) => (
          <li key={row.id} className="grid grid-cols-[minmax(4.25rem,30%)_1fr_auto] items-baseline gap-2 py-px">
            <span className="min-w-0 truncate text-meta text-muted-foreground">{row.label}</span>
            <span className="telemetry selectable min-w-0 truncate text-body text-foreground" title={row.reading}>
              {row.reading || <span className="text-muted-foreground">{EMPTY[row.id] ?? "—"}</span>}
            </span>
            <span className="telemetry flex items-center gap-1 whitespace-nowrap text-[9px] text-muted-foreground" style={{ color: STATE_COLOUR[row.state] }}>
              <span className="size-1.5 rounded-full bg-current" style={{ opacity: row.state === "missing" || row.state === "pending" ? 0.45 : 1 }} aria-hidden />
              {STATE_NOTE[row.state]}
            </span>
          </li>
        ))}
      </ul>
      {storeWhy && <p className="text-micro leading-snug text-muted-foreground">{storeWhy}.</p>}
      {coverage && (
        <p className="text-micro leading-snug text-muted-foreground" style={coverage.low ? { color: "var(--warning)" } : undefined}>
          {coverage.said}
        </p>
      )}
      {failed && (
        <p className="flex items-start gap-1 text-micro leading-snug text-destructive-quiet">
          <Warning className="mt-px size-3 shrink-0" />
          The last attempt failed. Reports has the reason.
        </p>
      )}
    </div>
  )
}
