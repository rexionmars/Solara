import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

async function compile(name) {
  return new vm.SourceTextModule(ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
}

async function load(name) {
  const module = await compile(name)
  // Local modules are the real ones; the Wails runtime is the only stand-in.
  await module.link(async specifier => {
    if (specifier.startsWith("./")) { const local = await compile(specifier.slice(2)); await local.link(() => {}); return local }
    return new vm.SyntheticModule(["ClipboardSetText"], function () { this.setExport("ClipboardSetText", async () => true) })
  })
  await module.evaluate()
  return module.namespace
}

test("source colors and categories take precedence over generated fallback colors", async () => {
  const { featureColor, normalizeColor, paletteColor } = await load("geopackageStyle")
  const feature = { geometry: { type: "Point" }, properties: { "marker-color": "#ff2200", kind: "wind" } }
  assert.equal(featureColor(feature, undefined, "#123456"), "#ff2200")
  assert.equal(featureColor(feature, { field: "kind", categories: { wind: "#112233" } }, "#123456"), "#112233")
  assert.equal(normalizeColor("255,128,0,255"), "rgba(255, 128, 0, 1)")
  assert.equal(normalizeColor("url(javascript:alert(1))"), null)
  assert.equal(featureColor({ geometry: { type: "Point" }, properties: { color: "invalid" } }, undefined, "#123456"), "#123456")
  assert.notEqual(paletteColor(0, 30), paletteColor(1, 30))
})

test("the preview asks only for the attributes it colours by", async () => {
  const { drawnFields } = await load("geopackageStyle")
  const fields = [{ name: "fid", type: "integer" }, { name: "kind", type: "text" }, { name: "color", type: "text" }, { name: "notes", type: "text" }]
  assert.deepEqual(drawnFields({ field: "kind" }, fields), ["kind", "color"])
  assert.deepEqual(drawnFields(undefined, fields), ["color"])
})

const fields = [
  { name: "fid", type: "integer" }, { name: "name", type: "text" }, { name: "code", type: "integer" },
  { name: "load", type: "real", title: "Peak load (MW)" }, { name: "active", type: "boolean" },
  { name: "photo", type: "blob" }, { name: "tags", type: "text" },
]

test("values read as their column declares them", async () => {
  const { formatValue } = await load("geopackageCaption")
  assert.equal(formatValue(2408102, "integer"), "2408102")
  assert.equal(formatValue(53399), "53399")
  assert.equal(formatValue(1, "boolean"), "Yes")
  assert.equal(formatValue(0, "boolean"), "No")
  assert.equal(formatValue(300, "blob"), `Binary, ${(300).toLocaleString()} bytes`)
  assert.equal(formatValue(12.5, "real"), (12.5).toLocaleString())
  assert.equal(formatValue("Infinity", "real"), "Infinity")
  assert.equal(formatValue("2024-03-01", "date"), "2024-03-01")
})

test("attributes keep the file's column order and aliases; a JSON object becomes a section", async () => {
  const { featureDetails } = await load("geopackageCaption")
  const result = featureDetails({ tags: '{"power":"generator","generator:source":"wind"}', load: 3.5, fid: 8632, extra: "x", __solara_display_color: "#ff0000", empty: "", nil: null }, fields)
  assert.deepEqual(result.attributes.map(a => a.label), ["fid", "Peak load (MW)", "extra"])
  assert.equal(result.sections.length, 1)
  assert.deepEqual(result.sections[0].entries[0], ["power", "generator"])
  const broken = featureDetails({ tags: '{"truncated":', name: '<img src=x onerror=alert(1)>' }, fields)
  assert.equal(broken.sections.length, 0)
  assert.equal(broken.attributes.find(a => a.key === "name").value, '<img src=x onerror=alert(1)>')
})

const pick = extra => ({ layer: "gen_wind", label: "Wind generators", file: "infra.gpkg", geometry: "Point", color: "#ffa022", fields, fid: 8632, status: "whole", shape: null, ...extra })

test("GeoPackage attributes adapt to the existing stats callout model", async () => {
  const { featureCaption } = await load("geopackageCaption")
  const caption = featureCaption(pick({ props: { name: "Wind farm", fid: 8632, code: 2408102, load: 12.5, tags: '{"power":"generator"}' } }))
  assert.equal(caption.subject, "Wind generators · Point")
  assert.equal(caption.area, "Wind farm")
  assert.equal(caption.detail, "infra.gpkg")
  assert.equal(caption.body.kind, "stats")
  assert.equal(caption.body.rows.find(r => r.label === "code").value, "2408102")
  assert.equal(caption.body.rows.find(r => r.label === "Peak load (MW)").value, (12.5).toLocaleString())
  assert.equal(caption.body.rows.some(r => r.label === "name"), false)
  assert.equal(caption.body.sections[0].label, "tags (1)")
  assert.equal(caption.body.note, undefined)
  assert.equal(caption.color, "#ffa022")
  assert.equal(typeof caption.action.run, "function")
})

test("a callout says while the whole feature is read, and when it could not be", async () => {
  const { featureCaption } = await load("geopackageCaption")
  const reading = featureCaption(pick({ props: { fid: 8632 }, status: "reading" }))
  assert.equal(reading.area, "Feature 8632")
  assert.match(reading.body.note, /Reading/)
  const failed = featureCaption(pick({ props: { fid: 8632 }, status: "failed", error: "gone" }))
  assert.match(failed.body.note, /gone/)
})
