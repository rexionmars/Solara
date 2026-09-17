import type { energy } from "../../../wailsjs/go/models"

/**
 * What the ramp's endpoints are the endpoints OF.
 *
 * Three answers, not interchangeable: a fixed domain is comparable between
 * runs, a shared one is wider than this layer so the pair can be compared, and
 * a layer's own range fills the ramp however narrow the spread. Saying the
 * wrong one turns a 1% spread into what looks like a strong gradient, or the
 * reverse. Ported from TERRA's scaleBasisNote.
 */
export function basisNote(scale: energy.RenderScale): string {
  if (scale.basis === "fixed") return "fixed domain, comparable with other runs of this layer"
  if (scale.basis === "shared" && scale.shared_with) {
    return `domain shared with the ${scale.shared_with} layer, wider than this layer's own range`
  }
  return "domain is this layer's own range; contrast is relative, not absolute"
}

/**
 * The colour ramp a layer was drawn on, from the stops the sidecar drew it
 * with, labelled with the endpoints of its domain and marking the reference
 * value where the quantity has one.
 */
export function Legend({ scale, unit, title }: { scale: energy.RenderScale; unit: string; title: string }) {
  const gradient = scale.stops?.length
    ? `linear-gradient(to right, ${scale.stops.join(", ")})`
    : "rgb(var(--p-line))"
  const ref = scale.reference
  const refPos =
    ref != null && scale.max > scale.min ? ((ref - scale.min) / (scale.max - scale.min)) * 100 : null
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <div className="relative h-2.5 w-full rounded-sm" style={{ background: gradient }}>
        {refPos !== null && refPos >= 0 && refPos <= 100 && (
          <span
            className="absolute -top-0.5 h-3.5 w-px bg-ink"
            style={{ left: `${refPos}%` }}
            title={`reference ${ref}`}
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-foreground">
        <span>{scale.min.toFixed(scale.decimals)}</span>
        {refPos !== null && <span className="text-muted-foreground">ref {ref}</span>}
        <span>{scale.max.toFixed(scale.decimals)}</span>
      </div>
      <div className="text-[10px] leading-snug text-muted-foreground">
        {unit} · {basisNote(scale)}
      </div>
    </div>
  )
}
