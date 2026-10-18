import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

async function controller(read) {
  const timers = new Map()
  let timerId = 0
  const context = vm.createContext({ setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id) })
  const createStore = value => ({ get: () => value, set: next => { value = typeof next === "function" ? next(value) : next } })
  const calls = []
  const pickedLocal = createStore(null)
  const mocks = {
    "../../wailsjs/go/main/App": { GeoPackageFeatures: async (...args) => { calls.push(args); return read ? read(...args) : { geojson: { type: "FeatureCollection", features: [] }, indexed: true, limited: false, skipped: 0 } } },
    "./errors": { errorMessage: String }, "./store": { createStore },
    "./mapState": { pickedGeoPackage: pickedLocal },
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
