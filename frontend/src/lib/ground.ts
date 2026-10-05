import type { energy } from "../../wailsjs/go/models"

/**
 * The words for the classes of the usable-ground layer.
 *
 * The sidecar sends each class with the colour it drew it in; the name is
 * here, once, because the reading, the legend in Properties and the legend on
 * the map all say it and must say the same thing.
 */
export const GROUND_CLASS_LABEL: Record<string, string> = {
  usable: "Usable",
  slope: "Too steep",
  flood: "Too low above drainage",
  slope_and_flood: "Too steep and too low",
  water: "Permanent water",
}

export const groundClassLabel = (key: string): string => GROUND_CLASS_LABEL[key] ?? key

/** The two rules a run applied, as they are written beside its figures. */
export function groundRules(g: energy.UsableGroundAnalysis): string {
  const flood = g.rules.hand_min_m > 0 ? `at least ${g.rules.hand_min_m} m above drainage` : "flood rule off"
  return `slope at most ${g.rules.slope_max_deg}° · ${flood}`
}
