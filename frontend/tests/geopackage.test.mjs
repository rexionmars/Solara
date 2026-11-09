import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

async function controller(read, readFeature) {
  const timers = new Map()
  let timerId = 0
  const context = vm.createContext({ setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id) })
  const createStore = value => ({ get: () => value, set: next => { value = typeof next === "function" ? next(value) : next } })
  const calls = []
  const pickedLocal = createStore(null)
  const mocks = {
    "../../wailsjs/go/main/App": {
      GeoPackageFeatures: async (...args) => { calls.push(args); return read ? read(...args) : { geojson: { type: "FeatureCollection", features: [] }, indexed: true, limited: false, skipped: 0 } },
      GeoPackageFeature: async (...args) => readFeature ? readFeature(...args) : { type: "Feature", id: args[2], geometry: null, properties: { fid: args[2] } },
    },
    "./errors": { errorMessage: String }, "./store": { createStore },
    "./mapState": { pickedGeoPackage: pickedLocal },
    "./shell": { mapInsetRight: createStore(0) },
  }
  const compile = async filename => new vm.SourceTextModule(ts.transpileModule(await readFile(new URL(`../src/lib/${filename}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context })
  const module = await compile("geopackage")
  await module.link(async name => {
    if (name === "./geopackageStyle") { const style = await compile("geopackageStyle"); await style.link(() => {}); return style }
    return new vm.SyntheticModule(Object.keys(mocks[name]), function () { for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const frames = [], sources = new Map(), layers = new Map(), events = new Map()
  const map = {
    addSource: (id, opts) => sources.set(id, { data: opts.data, setData(data) { this.data = data } }),
    removeSource: id => sources.delete(id), removeLayer: id => layers.delete(id),
    addLayer: layer => layers.set(layer.id, layer), on: (event, fn) => events.set(event, fn),
    getSource: id => sources.get(id), getLayer: id => layers.get(id),
    setLayoutProperty: (id, key, value) => { layers.get(id)[key] = value },
    fitBounds: bounds => frames.push(bounds), queryRenderedFeatures: () => [],
    getBounds: () => ({ getWest: () => 6, getSouth: () => 35, getEast: () => 19, getNorth: () => 48 }),
    getZoom: () => 5.2,
  }
  const flush = async () => { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); await new Promise(setImmediate) }
  return { api: module.namespace, frames, map, sources, layers, calls, pickedLocal, events, flush }
}
const layer = (name, extra = {}) => ({ name, label: name, count: 12, geometry: "POINT", bbox: [6, 35, 19, 48], error: null, ...extra })
const file = layers => ({ name: "infra.gpkg", path: "/infra.gpkg", layers })

test("opening a file immediately displays and frames substations", async () => {
  const { api, map, frames } = await controller()
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([layer("support_pole"), layer("substation")]))
  assert.equal(api.geoPackage.get().views.substation.visible, true)
  assert.equal(api.geoPackage.get().views.support_pole.visible, false)
  assert.deepEqual(JSON.parse(JSON.stringify(frames)), [[[6, 35], [19, 48]]])
  api.closeGeoPackage()
})

test("a file opened before the map loads restores its extent and visible layers", async () => {
  const { api, map, frames, sources } = await controller()
  api.loadGeoPackage(file([layer("rivers"), layer("roads")]), "roads", { visibleLayers: ["rivers", "roads"], colors: { roads: "#123456" } })
  assert.equal(frames.length, 0)
  api.attachGeoPackage(map)
  assert.equal(frames.length, 1)
  assert.equal(sources.size, 2)
  assert.equal(api.geoPackage.get().views.roads.color, "#123456")
  api.closeGeoPackage()
})

test("several layers load together; hiding one neither hides another nor reframes", async () => {
  const { api, map, frames, sources, calls, flush } = await controller()
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([layer("substation"), layer("roads")]))
  api.choosePackageLayer("roads")
  await flush()
  assert.deepEqual(calls.map(args => args[1]).sort(), ["roads", "substation"])
  assert.equal(api.geoPackage.get().views.substation.visible, true)
  assert.equal(api.geoPackage.get().views.roads.visible, true)
  assert.notEqual(api.geoPackage.get().views.roads.color, api.geoPackage.get().views.substation.color)
  const before = frames.length
  api.togglePackageVisibility("roads")
  assert.equal(api.geoPackage.get().views.roads.visible, false)
  assert.equal(api.geoPackage.get().views.substation.visible, true)
  assert.equal(frames.length, before)
  api.closeGeoPackage()
  assert.equal(sources.size, 0)
})

test("a hidden layer never receives a late result and reloads when shown", async () => {
  let complete
  const result = { geojson: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [12, 42] }, properties: {} }] }, indexed: true, limited: false, skipped: 0 }
  const { api, map, sources, flush } = await controller(() => new Promise(resolve => { complete = resolve }))
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([layer("roads")]))
  await flush()
  api.togglePackageVisibility("roads")
  complete(result)
  await new Promise(setImmediate)
  assert.equal([...sources.values()][0].data.features.length, 0)
  api.togglePackageVisibility("roads")
  await flush()
  complete(structuredClone(result))
  await new Promise(setImmediate)
  assert.equal([...sources.values()][0].data.features.length, 1)
  api.closeGeoPackage()
})

test("picking identifies the source layer for the shared callout, independently of the analysis layer", async () => {
  const { api, map, layers, pickedLocal } = await controller()
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([layer("substation"), layer("roads")]))
  const first = [...layers.keys()][2]
  api.choosePackageLayer("roads")
  map.queryRenderedFeatures = () => [{ type: "Feature", layer: { id: first }, geometry: { type: "Point", coordinates: [12, 42] }, properties: { fid: 5 } }]
  const picked = api.pickGeoPackage(map, {}, [12, 42])
  assert.equal(picked.layer, "substation")
  assert.deepEqual(picked.at, [12, 42])
  pickedLocal.set(picked)
  api.togglePackageVisibility("substation")
  assert.equal(pickedLocal.get(), null)
  api.closeGeoPackage()
})

test("unsupported and empty layers are skipped; saved all-hidden state is respected", async () => {
  const { api } = await controller()
  api.loadGeoPackage(file([layer("bad", { error: "Unknown CRS" }), layer("substation", { count: 0 }), layer("roads")]))
  assert.equal(api.geoPackage.get().layer, "roads")
  api.loadGeoPackage(file([layer("roads")]), "roads", { visibleLayers: [] })
  assert.equal(api.geoPackage.get().views.roads.visible, false)
  api.closeGeoPackage()
})

const keyed = (name, extra = {}) => layer(name, { pk: "fid", fields: [{ name: "fid", type: "integer" }, { name: "name", type: "text" }, { name: "color", type: "text" }, { name: "notes", type: "text" }], ...extra })

test("a preview asks for the attributes it colours and names by; a layer without a key asks for all", async () => {
  const { api, map, calls, flush } = await controller()
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([keyed("substation"), keyed("roads", { pk: null })]), "substation", { visibleLayers: ["substation", "roads"] })
  await flush()
  const asked = JSON.parse(JSON.stringify(Object.fromEntries(calls.map(args => [args[1], args[3]]))))
  assert.deepEqual(asked.substation, ["color", "name"])
  assert.deepEqual(asked.roads, ["fid", "name", "color", "notes"])
  api.closeGeoPackage()
})

function clickOn(map, layers, props) {
  const id = [...layers.keys()][2]
  map.queryRenderedFeatures = () => [{ type: "Feature", layer: { id }, geometry: { type: "Point", coordinates: [12, 42] }, properties: props }]
}

test("a click shows the preview at once and the whole feature when it arrives", async () => {
  const whole = { type: "Feature", id: 5, geometry: { type: "Point", coordinates: [12, 42] }, properties: { fid: 5, name: "Station", notes: "x".repeat(9000) } }
  const { api, map, layers, pickedLocal } = await controller(undefined, async () => whole)
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([keyed("substation")]))
  clickOn(map, layers, { fid: 5, name: "Station", __solara_display_color: "#ff0000" })
  const picked = api.pickGeoPackage(map, {}, [12, 42])
  assert.equal(picked.fid, 5)
  assert.equal(picked.status, "reading")
  assert.deepEqual(Object.keys(picked.props), ["fid", "name"])
  pickedLocal.set(picked)
  await new Promise(setImmediate)
  assert.equal(pickedLocal.get().status, "whole")
  assert.equal(pickedLocal.get().props.notes.length, 9000)
  assert.deepEqual(pickedLocal.get().shape, whole.geometry)
  api.closeGeoPackage()
})

test("an earlier click's answer does not replace a later pick, and a failed read says so", async () => {
  const answers = []
  const { api, map, layers, pickedLocal } = await controller(undefined, () => new Promise((resolve, reject) => answers.push({ resolve, reject })))
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([keyed("substation")]))
  clickOn(map, layers, { fid: 1 })
  pickedLocal.set(api.pickGeoPackage(map, {}, [12, 42]))
  clickOn(map, layers, { fid: 2 })
  const later = api.pickGeoPackage(map, {}, [12, 42])
  pickedLocal.set(later)
  answers[0].resolve({ type: "Feature", id: 1, geometry: null, properties: { fid: 1, name: "First" } })
  await new Promise(setImmediate)
  assert.equal(pickedLocal.get(), later)
  answers[1].reject(new Error("The feature does not exist."))
  await new Promise(setImmediate)
  assert.equal(pickedLocal.get().status, "failed")
  assert.match(pickedLocal.get().error, /does not exist/)
  api.closeGeoPackage()
})

test("a layer without a primary key keeps its preview attributes on a click", async () => {
  let asked = false
  const { api, map, layers } = await controller(undefined, () => { asked = true })
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([keyed("substation", { pk: null })]))
  clickOn(map, layers, { fid: 3, name: "Station" })
  const picked = api.pickGeoPackage(map, {}, [12, 42])
  assert.equal(picked.status, "preview")
  assert.equal(picked.fid, null)
  assert.equal(asked, false)
  api.closeGeoPackage()
})

test("a crowded view draws its cells sized by count, and the outliner and legend learn it is counted", async () => {
  const cells = { zoom: 9, items: [[270, 190, 4000, 10.1, 44.2], [271, 190, 1000, 10.9, 44.3]] }
  const { api, map, sources, calls, flush } = await controller(async () => ({ geojson: { type: "FeatureCollection", features: [] }, cells, in_view: 5000, indexed: true, limited: false, skipped: 0 }))
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([keyed("substation")]))
  await flush()
  assert.equal(calls[0][4], 5.2)
  const drawn = [...sources.values()][0].data.features
  assert.equal(drawn.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(drawn[0].geometry.coordinates)), [10.1, 44.2])
  assert.equal(drawn[0].properties.__solara_count, 4000)
  assert.equal(drawn[0].properties.__solara_radius, api.countRadius(4000, 4000))
  assert.equal(drawn[1].properties.__solara_radius, 2 + 11 * 0.5)
  const view = api.geoPackage.get().views.substation
  assert.deepEqual(JSON.parse(JSON.stringify(view.counted)), { inView: 5000, largest: 4000 })
  assert.equal(view.message, "")
  api.togglePackageVisibility("substation")
  assert.equal(api.geoPackage.get().views.substation.counted, null)
  api.closeGeoPackage()
})

test("a view drawn whole says nothing, and one cut short says why", async () => {
  const { api, map, flush } = await controller(async (path, name) => ({ geojson: { type: "FeatureCollection", features: [] }, indexed: name !== "roads", limited: name === "roads", skipped: 0 }))
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([keyed("substation"), keyed("roads")]), "substation", { visibleLayers: ["substation", "roads"] })
  await flush()
  assert.equal(api.geoPackage.get().views.substation.message, "")
  assert.match(api.geoPackage.get().views.roads.message, /Preview limit reached.*No spatial index/)
  api.closeGeoPackage()
})

test("a click on a counted cell frames the cell instead of identifying a feature", async () => {
  const { api, map, layers, frames } = await controller()
  api.attachGeoPackage(map)
  api.loadGeoPackage(file([keyed("substation")]))
  const ids = [...layers.keys()]
  assert.equal(ids.length, 4)
  let asked = []
  map.queryRenderedFeatures = (point, options) => { asked = options.layers; return options.layers.includes(ids[3]) ? [{ properties: { __solara_cell: "1/0/0" } }] : [] }
  const before = frames.length
  assert.equal(api.frameCountedCell(map, {}), true)
  const [[west, south], [east, north]] = JSON.parse(JSON.stringify(frames[before]))
  assert.deepEqual([west, south, east], [-180, 0, 0])
  assert.ok(Math.abs(north - 85.0511) < 1e-3)
  api.pickGeoPackage(map, {}, [0, 0])
  assert.equal(asked.includes(ids[3]), false)
  map.queryRenderedFeatures = () => []
  assert.equal(api.frameCountedCell(map, {}), false)
  api.closeGeoPackage()
})

test("a file of many layers groups them by the prefix of their names, and a prefix of one stays a layer", async () => {
  const { api } = await controller()
  const few = ["a_1", "a_2", "b_1"].map(name => layer(name))
  assert.equal(api.groupLayers(few).length, 3)
  const names = ["gas_a", "gas_b", "other_pump", "substation", ...Array.from({ length: 13 }, (_, i) => `voltage_${i}`)]
  const grouped = JSON.parse(JSON.stringify(api.groupLayers(names.map(name => layer(name)))))
  assert.deepEqual(grouped.map(e => e.prefix ?? e.name), ["gas", "other_pump", "substation", "voltage"])
  assert.equal(grouped[3].layers.length, 13)
})
