import { ExportResultFile, RevealInFileManager, SaveTextFile } from "../../wailsjs/go/main/App"
import { errorMessage } from "./errors"
import { PRODUCT_NAMES, project, type Product, type ResultObject, type TerrainResult } from "./project"
import { fail, info } from "./reports"
import { toCsv } from "./table"

/**
 * Taking results out of the application. Every export goes through a save
 * dialog on the Go side; a cancelled dialog is not an error and says nothing.
 */

const fileSafe = (s: string) => s.replace(/[^\w.-]+/g, "_")

async function saveText(defaultName: string, filterName: string, pattern: string, content: string): Promise<void> {
  try {
    const path = await SaveTextFile(defaultName, filterName, pattern, content)
    if (path) info(`Exported "${path}".`, { label: "Reveal", run: () => void reveal(path) })
  } catch (e) {
    fail(`Export failed: ${errorMessage(e)}`)
  }
}

export function exportResultJson(r: ResultObject): Promise<void> {
  const doc = {
    product: r.kind,
    name: r.name,
    computed: r.createdAt,
    ...(r.kind === "terrain" ? { area: r.polygon } : { site: r.site }),
    parameters: r.params,
    result: r.data,
  }
  return saveText(`${fileSafe(r.name)}.json`, "JSON", "*.json", JSON.stringify(doc, null, 2))
}

export function exportResultCsv(r: ResultObject): Promise<void> {
  return saveText(`${fileSafe(r.name)}.csv`, "CSV", "*.csv", toCsv(r.kind, project.get().data, [r]))
}

export function exportTableCsv(product: Product): Promise<void> {
  const d = project.get().data
  const rows = d.results.filter((r) => r.kind === product)
  return saveText(`${fileSafe(PRODUCT_NAMES[product])}.csv`, "CSV", "*.csv", toCsv(product, d, rows))
}

export async function exportGeoTiff(r: TerrainResult): Promise<void> {
  try {
    const path = await ExportResultFile(r.data.raster_tif, `${fileSafe(r.name)}.tif`)
    if (path) info(`Exported "${path}".`, { label: "Reveal", run: () => void reveal(path) })
  } catch (e) {
    fail(`GeoTIFF export failed: ${errorMessage(e)}`)
  }
}

export async function reveal(path: string): Promise<void> {
  try {
    await RevealInFileManager(path)
  } catch (e) {
    fail(`Could not reveal "${path}": ${errorMessage(e)}`)
  }
}
