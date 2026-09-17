import { useState } from "react"
import { MagnifyingGlass, Question } from "@phosphor-icons/react"
import { account } from "../../lib/account"
import { findCommand, runCommand, searchCommands } from "../../lib/commands"
import { DOCUMENT_TITLES, documents } from "../../lib/documents"
import { terrainLayer } from "../../lib/layers"
import { panels } from "../../lib/layout"
import { IS_MAC } from "../../lib/platform"
import { useStore } from "../../lib/store"
import { Avatar } from "../account/Avatar"
import { QUICK_ACCESS, RIBBON, type RibbonGroup, type RibbonItem } from "./ribbon"

const PRESSED =
  "aria-pressed:bg-accent/20 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-accent/60"

/** Whether a toggle command is on; the status bar reads the same state. */
export function usePressed(item: Pick<RibbonItem, "pressedWhen">): boolean | undefined {
  const shown = useStore(panels)
  const terrain = useStore(terrainLayer)
  if (item.pressedWhen === "terrainLayer") return terrain.visible
  return item.pressedWhen ? shown[item.pressedWhen] : undefined
}

function RibbonButton({ item }: { item: RibbonItem }) {
  const pressed = usePressed(item)
  const cmd = findCommand(item.command)
  // A ribbon entry naming no command is a mistake in ribbon.ts; say so on
  // screen rather than dropping the button silently.
  if (!cmd) {
    return <span className="self-center px-2 text-[10px] text-fail">{item.command}?</span>
  }
  const Icon = cmd.icon
  const title = `${cmd.label} (${cmd.name})\n${cmd.description}`
  const run = () => void runCommand(cmd.name)

  if (item.size === "small") {
    return (
      <button
        type="button"
        onClick={run}
        aria-pressed={pressed}
        title={title}
        className={`flex h-[22px] items-center gap-1.5 rounded-sm px-1.5 text-[12px] text-ink/90 hover:bg-hover active:bg-sunken ${PRESSED}`}
      >
        <Icon size={16} weight="duotone" className="shrink-0 text-glyph" aria-hidden="true" />
        <span className="whitespace-nowrap">{cmd.label}</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={run}
      aria-pressed={pressed}
      title={title}
      className={`flex min-w-[52px] max-w-[74px] flex-col items-center gap-0.5 rounded-sm px-1 pb-0.5 pt-1 text-ink/90 hover:bg-hover active:bg-sunken ${PRESSED}`}
    >
      <Icon size={30} weight="duotone" className="text-glyph" aria-hidden="true" />
      <span className="text-center text-[11.5px] leading-[1.15]">{cmd.label}</span>
    </button>
  )
}

/** Large items each take a column; consecutive small items stack three to one. */
function columns(items: RibbonItem[]): (RibbonItem | RibbonItem[])[] {
  const out: (RibbonItem | RibbonItem[])[] = []
  let small: RibbonItem[] = []
  const flush = () => {
    if (small.length) out.push(small)
    small = []
  }
  for (const item of items) {
    if (item.size === "small") {
      small.push(item)
      if (small.length === 3) flush()
    } else {
      flush()
      out.push(item)
    }
  }
  flush()
  return out
}

function Group({ group }: { group: RibbonGroup }) {
  return (
    <section className="flex flex-col border-r border-sunken/80">
      <div className="flex flex-1 items-start gap-0.5 px-1.5 pt-1">
        {columns(group.items).map((col, i) =>
          Array.isArray(col) ? (
            <div key={i} className="flex flex-col gap-px pt-0.5">
              {col.map((item) => (
                <RibbonButton key={item.command} item={item} />
              ))}
            </div>
          ) : (
            <RibbonButton key={col.command} item={col} />
          )
        )}
      </div>
      <h3 className="mx-px mb-px flex h-[18px] items-center justify-center rounded-[1px] bg-chrome/70 px-2 text-[11px] text-muted">
        {group.title}
      </h3>
    </section>
  )
}

/** Commands reached from any tab, beside the application mark. */
function QuickAccess() {
  return (
    <div className="app-no-drag relative z-10 flex items-center">
      {QUICK_ACCESS.map((name) => {
        const cmd = findCommand(name)
        if (!cmd) return null
        const Icon = cmd.icon
        return (
          <button
            key={name}
            type="button"
            onClick={() => void runCommand(name)}
            title={`${cmd.label} (${cmd.name})`}
            className="grid h-6 w-7 place-items-center rounded-sm hover:bg-hover"
          >
            <Icon size={16} weight="duotone" className="text-glyph" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

/**
 * Finds a command by name, alias, label or description and runs it. Enter
 * runs the first match; the list shows what each does, so a command can be
 * found without knowing its name.
 */
function CommandSearch() {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const matches = searchCommands(query).slice(0, 8)

  const run = (name: string) => {
    setQuery("")
    setOpen(false)
    void runCommand(name)
  }

  return (
    <div className="relative">
      <div className="flex h-6 w-60 items-center rounded-sm border border-line/70 bg-sunken/70 px-1.5 focus-within:border-accent">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) run(matches[0].name)
            if (e.key === "Escape") {
              setQuery("")
              e.currentTarget.blur()
            }
          }}
          placeholder="Type a command or keyword"
          aria-label="Search commands"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:italic placeholder:text-muted/70"
        />
        <MagnifyingGlass size={14} className="shrink-0 text-muted" aria-hidden="true" />
      </div>
      {open && matches.length > 0 && (
        <ul className="absolute right-0 top-7 z-50 w-80 rounded-sm border border-line bg-panel py-1 shadow-xl">
          {matches.map((c) => {
            const Icon = c.icon
            return (
              <li key={c.name}>
                <button
                  type="button"
                  // Before the input's blur closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(c.name)}
                  className="flex w-full items-start gap-2 px-2 py-1 text-left hover:bg-hover"
                >
                  <Icon size={16} weight="duotone" className="mt-0.5 shrink-0 text-glyph" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[12px] text-ink">
                      {c.label} <span className="font-mono text-[10px] text-muted">{c.name}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted">{c.description}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The signed-in account; opens the Account tab. */
function AccountButton() {
  const { user } = useStore(account)
  return (
    <button
      type="button"
      onClick={() => void runCommand("ACCOUNT")}
      title={user ? `${user.display_name} · ${user.email}` : "Sign in"}
      className="flex h-6 items-center gap-1.5 rounded-sm px-1 text-[12px] text-ink/90 hover:bg-hover"
    >
      <Avatar user={user} size={18} />
      <span className="max-w-[9rem] truncate">{user ? user.display_name : "Sign in"}</span>
    </button>
  )
}

/**
 * The title bar, the ribbon's tabs and the active tab's groups.
 *
 * The title bar is the window's drag region: on macOS the native title bar is
 * hidden and this row sits beside the traffic lights, so empty space in it
 * moves the window.
 */
export function RibbonBar() {
  const [tabId, setTabId] = useState(RIBBON[0].id)
  const tab = RIBBON.find((t) => t.id === tabId) ?? RIBBON[0]
  const { active } = useStore(documents)

  return (
    <div className="shrink-0">
      <div className={`app-draggable relative flex h-8 items-center gap-1.5 bg-chrome pr-2 ${IS_MAC ? "pl-20" : "pl-2"}`}>
        {/* The application mark, set in a tile as CAD sets its application button. */}
        <span className="grid h-6 w-7 shrink-0 place-items-center rounded-sm bg-raised ring-1 ring-inset ring-line/70">
          <img src="/terra-logo.png" alt="" className="h-4 w-4" />
        </span>
        <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
        <QuickAccess />
        <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
        <span className="pointer-events-none absolute inset-x-0 top-0 flex h-8 items-center justify-center text-[12px] text-ink/80">
          TERRA Energy Engine — <span className="ml-1 text-ink">{DOCUMENT_TITLES[active]}</span>
        </span>
        <div className="app-no-drag relative z-10 ml-auto flex items-center gap-1">
          <CommandSearch />
          <AccountButton />
          <button
            type="button"
            onClick={() => void runCommand("HELP")}
            title="Help (HELP)"
            className="grid h-6 w-6 place-items-center rounded-sm text-ink/90 hover:bg-hover"
          >
            <Question size={16} weight="duotone" className="text-glyph" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Ribbon" className="flex h-7 items-end bg-chrome px-1">
        {RIBBON.map((t) => {
          const isActive = t.id === tab.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTabId(t.id)}
              className={`h-6 rounded-t-sm px-3 text-[12.5px] ${isActive ? "bg-raised font-medium text-ink" : "text-ink/70 hover:bg-raised/50 hover:text-ink"}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="flex h-[94px] items-stretch border-b border-line bg-raised">
        {tab.groups.map((group) => (
          <Group key={group.title} group={group} />
        ))}
      </div>
    </div>
  )
}
