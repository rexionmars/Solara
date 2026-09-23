import { clearReports } from "../../lib/reports"
import { AreaHeader } from "../studio/StudioArea"
import { ConsoleBody } from "./ConsoleBody"

/**
 * Operators by name, as a console: Enter runs, Enter on an empty line repeats
 * the last, Tab completes, the arrows walk back. HELP lists them all.
 *
 * An area around ConsoleBody, which is the console the run graph's footer
 * holds as well.
 */
export function ConsoleEditor() {
  return (
    <>
      <AreaHeader
        centre={<span className="telemetry header-label text-[9px] text-muted-foreground">operators by name · HELP lists them</span>}
        options={
          <button type="button" onClick={clearReports} className="flex h-5 items-center rounded-sm px-1.5 text-meta text-muted-foreground hover:bg-hover hover:text-foreground">
            Clear
          </button>
        }
      />
      <div className="h-full min-h-0" style={{ background: "var(--s-field)" }}>
        <ConsoleBody />
      </div>
    </>
  )
}
