import type { ReactNode } from "react"

export const number = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 3 })
export const selectStyle =
  "h-8 w-full min-w-0 rounded-sm border border-line/40 bg-transparent px-2 text-meta text-foreground outline-none focus:border-accent/55"
export const thStyle =
  "whitespace-nowrap border-b border-line/30 px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-normal text-muted-foreground"
export const tdStyle = "border-b border-line/20 px-2 py-1 text-foreground"

export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-b border-line/30 py-2">
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className="telemetry selectable mt-0.5 break-words text-[14px] text-foreground">{children}</p>
    </div>
  )
}
