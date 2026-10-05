/**
 * One precision per energy quantity, chosen from what the quantity is measured
 * on rather than from what a given panel happened to print.
 *
 * Copied from TERRA's lib/energyFormat.ts, which was written after the same
 * measurement appeared twice on one screen at two roundings. The wind subset
 * is what the wind screening uses; the plant quantities arrive with the plant
 * model.
 */

/** Installed direct-current capacity. */
export const capacityMw = (v: number) => `${v.toFixed(2)} MW`

/** Wind speed. Two decimals; the shear table keeps four on its own column,
 *  where consecutive rows genuinely differ below a centimetre per second. */
export const speedMs = (v: number) => `${v.toFixed(2)} m/s`

/** Gross capacity factor. One decimal: the figure is gross and unvalidated,
 *  and the losses it excludes are far larger than a third decimal. */
export const capacityFactorPct = (v: number) => `${v.toFixed(1)}%`

/** Gross annual energy per turbine, in whole megawatt-hours. */
export const energyMwh = (v: number) => `${v.toFixed(0)} MWh`

/** Wind power density, in whole watts per square metre. */
export const powerDensityWm2 = (v: number) => `${v.toFixed(0)} W/m²`

/** Weibull shape: k moves between about 1.5 and 3 across a continent. */
export const weibullK = (v: number) => v.toFixed(2)

/** Air density: the whole range is 1.05 to 1.25, so the third decimal matters. */
export const airDensityKgM3 = (v: number) => `${v.toFixed(3)} kg/m³`

/** A share of the record's hours, as a screening figure. */
export const sharePct = (v: number) => `${v.toFixed(1)}%`

/** How far a fitted distribution sits from its record, read as a check. */
export const fitErrorPct = (v: number) => `${v.toFixed(2)}%`

/** The power-law shear exponent: 0.143 is the open-country value. */
export const shearExponent = (v: number) => v.toFixed(3)

/** Energy pattern factor: near 1.9 for a Rayleigh wind. */
export const patternFactor = (v: number) => v.toFixed(2)

/** Mean of the cube of the speed, compared with the fitted one beside it. */
export const meanCubeM3S3 = (v: number) => `${v.toFixed(1)} m³/s³`

/**
 * A unit as it is written, whatever the result carries: a result computed
 * before the engine wrote "kWh/m² per year" holds "kWh/m2/year", and it is
 * read as what it meant.
 */
export const unitLabel = (unit: string) => unit.replace(/m2\b/g, "m²").replace(/\/year\b/g, " per year")

/**
 * A whole number as a reading writes it: four digits stand alone (1991), five
 * or more are grouped by a thin space (310 464), never by a comma or a point
 * that another language reads as the decimal mark.
 */
export const grouped = (n: number) => {
  const digits = Math.round(Math.abs(n)).toString()
  const body = digits.length < 5 ? digits : digits.replace(/\B(?=(\d{3})+$)/g, "\u202f")
  return n < 0 ? `−${body}` : body
}

