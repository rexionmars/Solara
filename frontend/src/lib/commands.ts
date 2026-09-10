import {
  Compass,
  Eraser,
  Heartbeat,
  House,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  MapPin,
  Question,
  SidebarSimple,
  SignOut,
  StopCircle,
  Sun,
  TerminalWindow,
  UserCircle,
  Wind,
  type Icon,
} from "@phosphor-icons/react"
import { account, logout } from "./account"
import { cancelRun, runSolar, runWind } from "./analysis"
import { clearLog, print } from "./commandLog"
import { activateDocument, openDocument } from "./documents"
import { errorMessage } from "./errors"
import { togglePanel } from "./layout"
import { flyHome, flyToSite, resetNorth, zoomIn, zoomOut } from "./mapController"
import { checkSidecar } from "./sidecarStatus"
import { placeSite, startPicking } from "./site"

/**
 * Every action the workbench can perform, in one registry.
 *
 * The ribbon, the command line and the viewport toolbar all start commands by
 * name from here, as a CAD program does: a button is a shortcut for typing the
 * command, and the history shows the same line whichever was used. A tool
 * added to the ribbon is therefore also available to type, with no second
 * implementation to keep in step.
 */
export type Command = {
  /** Upper case, as typed on the command line. */
  name: string
  aliases: string[]
  /** Label under the ribbon button. */
  label: string
  description: string
  /** How to type it with arguments. Absent for a command that takes none. */
  usage?: string
  icon: Icon
  run: (args: string[]) => void | Promise<void>
}

function requireMap(action: () => boolean): void {
  if (!action()) print("No map is open.", "error")
}

const SITE_USAGE = "SITE [lat lon]"

/** SITE with no arguments picks on the map; with two, places the site directly. */
function site(args: string[]): void {
  if (args.length === 0) {
    activateDocument("map")
    startPicking()
    print("Click the map to place the site. Esc cancels.")
    return
  }
  // "SITE -15.79 -47.88" and "SITE -15.79,-47.88" both read as latitude, longitude.
  const parts = args.length === 1 ? args[0].split(",") : args
  const [lat, lon] = parts.map(Number)
  if (
    parts.length !== 2 ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    print(`Usage: ${SITE_USAGE}, in decimal degrees, e.g. SITE -15.79 -47.88`, "error")
    return
  }
  activateDocument("map")
  placeSite({ lon, lat })
  requireMap(() => flyToSite(lon, lat))
}

export const COMMANDS: Command[] = [
  {
    name: "ZOOMIN",
    aliases: ["ZI"],
    label: "Zoom In",
    description: "Zoom the map in by one level",
    icon: MagnifyingGlassPlus,
    run: () => requireMap(zoomIn),
  },
  {
    name: "ZOOMOUT",
    aliases: ["ZO"],
    label: "Zoom Out",
    description: "Zoom the map out by one level",
    icon: MagnifyingGlassMinus,
    run: () => requireMap(zoomOut),
  },
  {
    name: "HOME",
    aliases: ["ZE", "EXTENTS"],
    label: "Home",
    description: "Return to the view of the whole of Brazil",
    icon: House,
    run: () => requireMap(flyHome),
  },
  {
    name: "NORTH",
    aliases: ["N"],
    label: "North Up",
    description: "Reset the map's bearing and pitch",
    icon: Compass,
    run: () => requireMap(resetNorth),
  },
  {
    name: "SITE",
    aliases: ["PT"],
    label: "Site",
    description: "Pick the analysis site on the map, or give it as latitude and longitude",
    usage: SITE_USAGE,
    icon: MapPin,
    run: site,
  },
  {
    name: "SOLAR",
    aliases: ["SR"],
    label: "Solar Resource",
    description: "Solar resource and photovoltaic yield at the site (NASA POWER, pvlib)",
    icon: Sun,
    run: runSolar,
  },
  {
    name: "WIND",
    aliases: ["WR"],
    label: "Wind Screening",
    description: "Wind resource screening at the site (NASA POWER, MERRA-2); unvalidated",
    icon: Wind,
    run: runWind,
  },
  {
    name: "CANCEL",
    aliases: ["STOP"],
    label: "Cancel",
    description: "Stop the analysis in progress",
    icon: StopCircle,
    run: cancelRun,
  },
  {
    name: "PING",
    aliases: [],
    label: "Check",
    description: "Start the Python sidecar and report its version",
    icon: Heartbeat,
    run: async () => {
      print("Checking the sidecar…")
      const s = await checkSidecar()
      if (s.kind === "ready") print(`Sidecar ready · Python ${s.version} · ${s.python}`)
      else if (s.kind === "failed") print(`Sidecar unavailable: ${s.message}`, "error")
    },
  },
  {
    name: "ACCOUNT",
    aliases: ["PROFILE"],
    label: "Account",
    description: "Open the account tab: sign in, or edit the signed-in profile",
    icon: UserCircle,
    run: () => openDocument("account"),
  },
  {
    name: "LOGOUT",
    aliases: ["SIGNOUT"],
    label: "Sign Out",
    description: "Sign out and continue as the guest",
    icon: SignOut,
    run: async () => {
      if (!account.get().user) {
        print("Not signed in; working as the guest.", "error")
        return
      }
      try {
        await logout()
      } catch (e) {
        print(`Sign out failed: ${errorMessage(e)}`, "error")
      }
    },
  },
  {
    name: "PROPERTIES",
    aliases: ["PR"],
    label: "Properties",
    description: "Show or hide the properties panel",
    icon: SidebarSimple,
    run: () => togglePanel("properties"),
  },
  {
    name: "COMMANDLINE",
    aliases: ["CL"],
    label: "Command Line",
    description: "Show or hide the command line",
    icon: TerminalWindow,
    run: () => togglePanel("commandLine"),
  },
  {
    name: "HELP",
    aliases: ["?"],
    label: "Help",
    description: "List the commands",
    icon: Question,
    run: () => {
      for (const c of COMMANDS) {
        const aliases = c.aliases.length ? ` (${c.aliases.join(", ")})` : ""
        print(`${((c.usage ?? c.name) + aliases).padEnd(26)} ${c.description}`)
      }
    },
  },
  {
    name: "CLEAR",
    aliases: ["CLS"],
    label: "Clear",
    description: "Clear the command history",
    icon: Eraser,
    run: clearLog,
  },
]

const BY_NAME = new Map<string, Command>()
for (const c of COMMANDS) {
  for (const key of [c.name, ...c.aliases]) BY_NAME.set(key, c)
}

export function findCommand(name: string): Command | undefined {
  return BY_NAME.get(name.trim().toUpperCase())
}

/**
 * Command names that start with `prefix`, for completion on the command line.
 * Only the command name completes; once an argument is being typed there is
 * nothing to suggest.
 */
export function completions(prefix: string): string[] {
  const p = prefix.trimStart().toUpperCase()
  if (!p || /\s/.test(p)) return []
  return COMMANDS.map((c) => c.name).filter((n) => n.startsWith(p))
}

/**
 * Run a command line: a command name, then its arguments separated by spaces.
 * It is echoed to the history as typed, so a mistyped name is visible beside
 * the error it produced.
 */
export async function runCommand(input: string): Promise<void> {
  const typed = input.trim()
  if (!typed) return
  const [name, ...args] = typed.split(/\s+/)
  const cmd = findCommand(name)
  print(`Command: ${cmd ? [cmd.name, ...args].join(" ") : typed.toUpperCase()}`, "input")
  if (!cmd) {
    print(`Unknown command "${name.toUpperCase()}". Type HELP for the list.`, "error")
    return
  }
  if (args.length && !cmd.usage) {
    print(`${cmd.name} takes no arguments.`, "error")
    return
  }
  try {
    await cmd.run(args)
  } catch (e) {
    print(`${cmd.name}: ${errorMessage(e)}`, "error")
  }
}
