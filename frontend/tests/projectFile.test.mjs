import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

async function projectController(opened, options = {}) {
  const storage = new Map()
  const context = vm.createContext({ localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } })
  const createStore = value => ({ get: () => value, set: next => { value = typeof next === "function" ? next(value) : next } })
  const emptyProject = () => ({ name: "Untitled", sites: [], areas: [], results: [], settings: {} })
  const project = createStore({ data: { ...emptyProject(), name: "Before" }, path: "/before.solara", dirty: !!options.dirty })
  const geoPackage = createStore({ file: options.previous ?? null, layer: "before", opening: false, views: {} })
  const calls = { open: [], save: [], inspect: [], errors: [] }
  const mocks = {
    "../../wailsjs/go/main/App": {
      OpenProject: async path => { calls.open.push(path); return opened },
      InspectGeoPackage: async path => { calls.inspect.push(path); return options.catalog },
      SaveProject: async (...args) => { calls.save.push(args); return "/study.solara" }, SetProjectDirty() {},
    },
    "../../wailsjs/runtime/runtime": { WindowSetTitle() {} },
    "./errors": { errorMessage: String },
    "./project": { emptyProject, project, runIdOf: () => null,
      loadProject: (data, path) => project.set({ data, path, dirty: false }),
      markSaved: (path, name) => project.set(p => ({ ...p, path, data: { ...p.data, name }, dirty: false })),
    },
    "./reports": { fail: message => calls.errors.push(message), info() {}, note() {}, warn() {} },
    "./selection": { select() {} }, "./store": { createStore },
    "./ui": { ask: async () => options.answer ?? "cancel", lastOperation: createStore(null) },
    "./geopackage": { geoPackage,
      closeGeoPackage: () => geoPackage.set(s => ({ ...s, file: null, layer: "" })),
      loadGeoPackage: (file, layer, display) => geoPackage.set(s => ({ ...s, file, layer: layer ?? file.layers[0].name, views: display?.visibleLayers ? Object.fromEntries(file.layers.map(l => [l.name, { visible: display.visibleLayers.includes(l.name), color: display.colors?.[l.name] }])) : {} })),
    },
  }
  const source = await readFile(new URL("../src/lib/projectFile.ts", import.meta.url), "utf8")
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context })
  await module.link(name => new vm.SyntheticModule(Object.keys(mocks[name]), function () {
    for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value)
  }, { context }))
  await module.evaluate()
  return { api: module.namespace, project, geoPackage, calls }
}

const catalog = { path: "/infra.GPKG", name: "infra.GPKG", layers: [{ name: "substation", count: 12 }] }

test("Open project recognizes a GeoPackage without parsing it as JSON", async () => {
  const { api, project, geoPackage, calls } = await projectController({ path: catalog.path, geopackage: catalog })
  await api.openProject()
  assert.equal(project.get().data.name, "infra")
  assert.equal(project.get().path, null) // Saving must never target the source database.
  assert.equal(geoPackage.get().file, catalog)
  assert.equal(api.recentFiles.get()[0], catalog.path)
  assert.equal(calls.errors.length, 0)
  await api.saveProject()
  assert.equal(calls.save[0][0], "")
  assert.equal(JSON.parse(calls.save[0][1]).geopackage.path, catalog.path)
})

test("saving keeps every layer's color and visibility, independent of the selected analysis layer", async () => {
  const { api, geoPackage, calls } = await projectController({ path: catalog.path, geopackage: catalog })
  await api.openProject()
  geoPackage.set(s => ({ ...s, layer: "roads", views: {
    substation: { visible: true, color: "#ff2200" }, roads: { visible: true, color: "#0088ff" }, wind: { visible: false, color: "#44aa22" },
  } }))
  await api.saveProject()
  const display = JSON.parse(calls.save[0][1]).geopackage
  assert.deepEqual(display.visibleLayers, ["substation", "roads"])
  assert.deepEqual(display.colors, { substation: "#ff2200", roads: "#0088ff", wind: "#44aa22" })
  assert.equal(display.layer, "roads")
})

test("cancelled dialog and unsaved-work cancellation preserve the current project", async () => {
  const cancelled = await projectController(null, { previous: catalog })
  await cancelled.api.openProject()
  assert.equal(cancelled.project.get().data.name, "Before")
  assert.equal(cancelled.geoPackage.get().file, catalog)
  const unsaved = await projectController({ path: catalog.path, geopackage: catalog }, { dirty: true })
  await unsaved.api.openProject()
  assert.equal(unsaved.calls.open.length, 0)
  assert.equal(unsaved.project.get().data.name, "Before")
})

test("a Solara project restores its GeoPackage reference and New clears it", async () => {
  const doc = { format: "terra-energy-project", version: 1, name: "Study", geopackage: { path: catalog.path, layer: "substation" } }
  const { api, geoPackage, calls } = await projectController({ path: "/study.solara", content: JSON.stringify(doc) }, { catalog })
  await api.openProject("/study.solara")
  assert.equal(calls.inspect[0], catalog.path)
  assert.equal(geoPackage.get().file, catalog)
  assert.equal(geoPackage.get().layer, "substation")
  await api.newProject()
  assert.equal(geoPackage.get().file, null)
})

test("opening a plain Solara project clears the previous GeoPackage", async () => {
  const doc = { format: "terra-energy-project", version: 1 }
  const { api, geoPackage } = await projectController({ path: "/study.solara", content: JSON.stringify(doc) }, { previous: catalog })
  await api.openProject()
  assert.equal(geoPackage.get().file, null)
})
