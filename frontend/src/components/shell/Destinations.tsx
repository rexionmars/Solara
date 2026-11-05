import type { ReactNode } from "react"
import { shell, type Destination } from "../../lib/shell"
import { useStore } from "../../lib/store"
import { RunGraphEditor } from "../editors/RunGraphEditor"
import { SystemPlanningEditor } from "../editors/SystemPlanningEditor"
import { TableEditor } from "../editors/TableEditor"
import { ErrorBoundary } from "../ui/ErrorBoundary"
import { HostStrip } from "./HeaderHosts"

/**
 * A destination: what a map cannot hold, filling the window beside the rail.
 *
 * KEPT MOUNTED ONCE OPENED, hidden behind the map, so a study's edits and a
 * table's sort survive a look at the ground. The header carries its name and
 * the controls its editor offers, in the places HostStrip gives it.
 */
function DestinationScreen({ id, title, subtitle, children }: { id: Destination; title: string; subtitle: string; children: ReactNode }) {
  const { destination } = useStore(shell)
  return (
    <section
      hidden={destination !== id}
      aria-label={title}
      className="app-no-drag absolute inset-0 z-[35] flex flex-col"
      style={{ background: "var(--s-app)", containerType: "inline-size" }}
    >
      <HostStrip
        className="h-12 border-b px-4"
        lead={
          <>
            <h1 className="text-heading font-medium text-foreground">{title}</h1>
            <span className="hidden truncate text-body text-muted-foreground @[56rem]:inline">{subtitle}</span>
            <span aria-hidden className="mx-1 h-5 w-px" style={{ background: "var(--border)" }} />
          </>
        }
      >
        <div className="relative flex min-h-0 flex-1 flex-col" style={{ background: "var(--s-panel)" }}>
          <ErrorBoundary label={title}>{children}</ErrorBoundary>
        </div>
      </HostStrip>
    </section>
  )
}

/** The destinations opened so far; each mounts the first time it is visited. */
export function Destinations() {
  const { opened } = useStore(shell)
  return (
    <>
      {opened.includes("compare") && (
        <DestinationScreen id="compare" title="Compare" subtitle="Every result of one product side by side, in the columns the CSV writes. A row press puts that result in hand.">
          <TableEditor areaId="shell:compare" />
        </DestinationScreen>
      )}
      {opened.includes("planning") && (
        <DestinationScreen id="planning" title="System planning" subtitle="Economic dispatch and capacity expansion with PyPSA and HiGHS, over an explicit network, demand and costs.">
          <SystemPlanningEditor />
        </DestinationScreen>
      )}
      {opened.includes("graph") && (
        <DestinationScreen id="graph" title="Run graph" subtitle="One product's request laid out as cards, each card one of its settings.">
          <RunGraphEditor areaId="shell:graph" />
        </DestinationScreen>
      )}
    </>
  )
}

