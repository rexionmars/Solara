import { CaretDown, CaretUp, Fan, Mountains, Sun, Warning } from "@phosphor-icons/react"
import { PRODUCT_NAMES, project, staleReason, type Product } from "../../lib/project"
import { areaStates, setAreaState } from "../../lib/screen"
import { select, selection } from "../../lib/selection"
import { useStore } from "../../lib/store"
import { COLUMNS, formatCell } from "../../lib/table"
import { StudioHeaderRadio } from "../studio/HeaderControls"
import { AreaHeader } from "../studio/StudioArea"
import { OperatorButton } from "../ui/Fields"

/**
 * Every result of one product side by side, as TERRA's Data table: sortable,
 * and the same columns the CSV export writes. A row press makes that result
 * active everywhere else.
 */
export function TableEditor({ areaId }: { areaId: string }) {
  const d = useStore(project).data
  const { id: selected } = useStore(selection)
  const state = useStore(areaStates)[areaId] ?? {}
  const product = (state.product as Product | undefined) ?? "solar"
  const sortKey = (state.sort as string | undefined) ?? "created"
  const descending = (state.desc as boolean | undefined) ?? true

  const columns = COLUMNS[product]
  const sortColumn = columns.find((c) => c.key === sortKey) ?? columns[0]
  const rows = d.results
    .filter((r) => r.kind === product)
    .sort((a, b) => {
      const x = sortColumn.value(a, d)
      const y = sortColumn.value(b, d)
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))
      return descending ? -cmp : cmp
    })

  return (
    <>
      <AreaHeader
        menus={
          <StudioHeaderRadio
            value={product}
            onChange={(p) => setAreaState(areaId, { product: p })}
            options={[
              { id: "solar", label: "Solar", icon: Sun, title: PRODUCT_NAMES.solar },
              { id: "wind", label: "Wind", icon: Fan, title: PRODUCT_NAMES.wind },
              { id: "terrain", label: "Terrain", icon: Mountains, title: PRODUCT_NAMES.terrain },
            ]}
          />
        }
        options={<OperatorButton name="EXPORT_TABLE" args={[product]} label="CSV" className="!h-5" />}
      />
      <div className="panel-scroll h-full min-h-0 overflow-auto">
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-body leading-relaxed text-muted-foreground">
            No {PRODUCT_NAMES[product].toLowerCase()} results. Run it at several {product === "terrain" ? "areas" : "sites"} to set them side by side here.
          </p>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-meta">
            <thead className="sticky top-0 z-10">
              <tr>
                {columns.map((c) => {
                  const sorted = c.key === sortColumn.key
                  const numeric = c.decimals !== undefined
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={sorted ? (descending ? "descending" : "ascending") : "none"}
                      className="whitespace-nowrap border-b p-0 font-normal"
                      style={{ background: "var(--s-panel-head)", borderColor: "rgb(var(--p-line) / 0.4)" }}
                    >
                      <button
                        type="button"
                        onClick={() => setAreaState(areaId, { sort: c.key, desc: sorted ? !descending : numeric })}
                        className={`flex w-full items-center gap-1 px-2 py-1.5 transition-colors hover:bg-hover ${numeric ? "justify-end" : ""} ${sorted ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        <span className="eyebrow !text-[9px] !text-inherit">{c.label}</span>
                        {c.unit && <span className="telemetry text-[9px] text-muted-foreground">{c.unit}</span>}
                        {sorted && (descending ? <CaretDown className="size-2.5" /> : <CaretUp className="size-2.5" />)}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = r.id === selected
                const stale = staleReason(d, r)
                return (
                  <tr key={r.id} onClick={() => select(r.id)} aria-selected={on} className={`cursor-default transition-colors ${on ? "bg-selected" : "hover:bg-hover"}`}>
                    {columns.map((c) => {
                      const v = c.value(r, d)
                      const numeric = c.decimals !== undefined
                      return (
                        <td
                          key={c.key}
                          className={`whitespace-nowrap border-b px-2 py-1 ${numeric ? "telemetry text-right" : ""} ${
                            c.key === "name" && on ? "text-accent" : "text-foreground"
                          }`}
                          style={{ borderColor: "var(--hairline)" }}
                        >
                          {c.key === "stale" ? (
                            stale ? (
                              <span className="flex items-center gap-1" style={{ color: "var(--warning)" }} title={stale}>
                                <Warning className="size-3" weight="fill" /> stale
                              </span>
                            ) : (
                              <span className="text-muted-foreground">current</span>
                            )
                          ) : (
                            <span className="selectable">{formatCell(c, v)}</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
