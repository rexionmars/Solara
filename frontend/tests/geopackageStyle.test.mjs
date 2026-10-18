import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

async function load(name) {
  const module = new vm.SourceTextModule(ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  await module.link(() => new vm.SyntheticModule(["ClipboardSetText"], function () { this.setExport("ClipboardSetText", async () => true) }))
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

test("feature cards organize JSON tags, preserve ordinary attributes and hide internal display data", async () => {
  const { featureDetails } = await load("geopackageCaption")
  const result = featureDetails({ fid: 8632, method: "wind_turbine", tags: '{"power":"generator","generator:source":"wind"}', __solara_display_color: "#ff0000", empty: "", nil: null })
  assert.equal(result.attributes.length, 2)
  assert.equal(result.tags.length, 2)
  assert.equal(result.tags[0][0], "power")
  const broken = featureDetails({ tags: '{"truncated":', name: '<img src=x onerror=alert(1)>' })
  assert.equal(broken.tags.length, 0)
  assert.equal(broken.attributes.find(([k]) => k === "name")[1], '<img src=x onerror=alert(1)>')
})


test("GeoPackage attributes adapt to the existing stats callout model", async () => {
  const { featureCaption } = await load("geopackageCaption")
  const caption = featureCaption({ layer: "gen_wind", label: "Wind generators", file: "infra.gpkg", geometry: "Point", color: "#ffa022", props: { name: "Wind farm", fid: 8632, output_mw: 12.5, tags: '{"power":"generator"}' } })
  assert.equal(caption.subject, "Wind generators · Point")
  assert.equal(caption.area, "Wind farm")
  assert.equal(caption.detail, "infra.gpkg")
  assert.equal(caption.body.kind, "stats")
  assert.equal(caption.body.rows.find(r => r.label === "Output (MW)").value, "12.5")
  assert.equal(caption.body.sections[0].rows[0].label, "power")
  assert.equal(caption.color, "#ffa022")
  assert.equal(typeof caption.action.run, "function")
})
