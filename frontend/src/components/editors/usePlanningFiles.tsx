import { useRef } from "react"
import { SavePlanningDocument } from "../../../wailsjs/go/main/App"
import {
  emptyStudy,
  exampleStudy,
  parseStudy,
  planning,
  replacePlanningStudy,
  type Study,
  type PlanningResult,
} from "../../lib/planning"
import { useStore } from "../../lib/store"
import { errorMessage } from "../../lib/errors"

/** Panel menus and the workspace ribbon share the same file actions and validation. */
export function usePlanningFiles() {
  const state = useStore(planning)
  const input = useRef<HTMLInputElement>(null)
  const result = state.results.find((r) => r.created_at === state.selectedResult) ?? state.results[0]
  const save = async (document: Study | PlanningResult) => {
    try {
      const path = await SavePlanningDocument(document)
      if (path) planning.set((s) => ({ ...s, notice: `Saved ${path}`, error: "" }))
    } catch (error) {
      planning.set((s) => ({ ...s, error: errorMessage(error) }))
    }
  }
  return {
    newStudy: () => replacePlanningStudy(emptyStudy()),
    example: () => replacePlanningStudy(exampleStudy()),
    replace: replacePlanningStudy,
    importStudy: () => {
      if (!state.busy) input.current?.click()
    },
    save,
    exportStudy: () => void save(state.study),
    exportReport: () => {
      if (result) void save(result)
    },
    result,
    input: (
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Import planning study"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          try {
            if (file.size > 32_000_000) throw new Error("Study import supports up to 32 MB.")
            replacePlanningStudy(parseStudy(JSON.parse(await file.text())))
          } catch (error) {
            planning.set((s) => ({ ...s, error: errorMessage(error) }))
          }
        }}
      />
    ),
  }
}
