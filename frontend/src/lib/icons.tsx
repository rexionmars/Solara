import { forwardRef } from "react"
import * as P from "@phosphor-icons/react"
import type { Icon, IconProps } from "@phosphor-icons/react"
import { artSrc } from "./art"

/**
 * The interface's glyphs, under the names Phosphor gives them, so that a set
 * of drawings can stand in for them across the whole application at once.
 *
 * EVERY COMPONENT IMPORTS ITS GLYPHS FROM HERE, not from Phosphor. A glyph
 * that stands for a THING or a COMMAND -- a site, a terrain reading, save,
 * undo -- answers with Breeze's drawing (lib/art.ts) and falls
 * back to Phosphor's own where Breeze has none. A glyph that is a CONTROL
 * of the interface -- a caret, a close mark, the eye, a transport button -- is
 * Phosphor's unchanged: colour there would be noise, and a GIS desktop keeps
 * those in one ink too.
 *
 * A drawing is a picture and takes no ink: the colour and weight a caller
 * asks for apply only to the glyph it falls back to. Its size is the caller's
 * className, as before.
 */

export type { Icon, IconProps }

/** A glyph that draws `art` when Breeze has it. */
function drawn(Glyph: Icon, art: string): Icon {
  const Drawn = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
    const src = artSrc(art)
    if (!src) return <Glyph {...props} ref={ref} />
    return <img src={src} alt="" draggable={false} className={props.className} style={{ ...props.style, color: undefined }} />
  })
  Drawn.displayName = `Drawn(${art})`
  return Drawn as unknown as Icon
}

// ---- Things and commands: drawn ----------------------------------------------------
export const ArrowClockwise = drawn(P.ArrowClockwise, "run-again")
export const ArrowCounterClockwise = drawn(P.ArrowCounterClockwise, "undo")
export const ArrowsClockwise = drawn(P.ArrowsClockwise, "run-again")
export const ChartBar = drawn(P.ChartBar, "demand")
export const CloudSun = drawn(P.CloudSun, "weather")
export const CodeSimple = drawn(P.CodeSimple, "scripting")
export const Compass = drawn(P.Compass, "north")
export const CornersOut = drawn(P.CornersOut, "frame-selected")
export const Crosshair = drawn(P.Crosshair, "coordinates")
export const Cursor = drawn(P.Cursor, "select")
export const Database = drawn(P.Database, "store")
export const Download = drawn(P.Download, "export")
export const Export = drawn(P.Export, "export")
export const Fan = drawn(P.Fan, "wind")
export const FileArrowDown = drawn(P.FileArrowDown, "export")
export const FilePlus = drawn(P.FilePlus, "new")
export const FloppyDisk = drawn(P.FloppyDisk, "save")
export const FlowArrow = drawn(P.FlowArrow, "run-graph")
export const Folder = drawn(P.Folder, "folder")
export const FolderOpen = drawn(P.FolderOpen, "folder-open")
export const FolderSimple = drawn(P.FolderSimple, "folder")
export const Gear = drawn(P.Gear, "adjust")
export const Globe = drawn(P.Globe, "basemap")
export const GlobeHemisphereWest = drawn(P.GlobeHemisphereWest, "basemap")
export const Graph = drawn(P.Graph, "run-graph")
export const Heartbeat = drawn(P.Heartbeat, "check")
export const House = drawn(P.House, "frame-all")
export const Info = drawn(P.Info, "about")
export const Keyboard = drawn(P.Keyboard, "keymap")
export const MagnifyingGlass = drawn(P.MagnifyingGlass, "locate")
export const MagnifyingGlassMinus = drawn(P.MagnifyingGlassMinus, "zoom-out")
export const MagnifyingGlassPlus = drawn(P.MagnifyingGlassPlus, "zoom-in")
export const MapPin = drawn(P.MapPin, "site")
export const MapTrifold = drawn(P.MapTrifold, "area")
export const Mountains = drawn(P.Mountains, "terrain")
export const Pencil = drawn(P.Pencil, "rename")
export const PencilSimple = drawn(P.PencilSimple, "rename")
export const Pentagon = drawn(P.Pentagon, "area")
export const PlugsConnected = drawn(P.PlugsConnected, "connection")
export const Question = drawn(P.Question, "help")
export const Ruler = drawn(P.Ruler, "measure")
export const Scroll = drawn(P.Scroll, "reports")
export const SignIn = drawn(P.SignIn, "account")
export const SignOut = drawn(P.SignOut, "logout")
export const SlidersHorizontal = drawn(P.SlidersHorizontal, "adjust")
export const Stack = drawn(P.Stack, "layers")
export const StopCircle = drawn(P.StopCircle, "cancel")
export const Sun = drawn(P.Sun, "solar")
export const Swatches = drawn(P.Swatches, "legend")
export const Table = drawn(P.Table, "data")
export const TerminalWindow = drawn(P.TerminalWindow, "scripting")
export const Trash = drawn(P.Trash, "delete")
export const TreeStructure = drawn(P.TreeStructure, "run-graph")
export const TreeView = drawn(P.TreeView, "legend")
export const User = drawn(P.User, "account")
export const UserCircle = drawn(P.UserCircle, "account")
export const Wind = drawn(P.Wind, "wind")
/** The project's data-block: Phosphor's Stack, drawn as a project and not as map layers. */
export const ProjectStack = drawn(P.Stack, "project")

// ---- Controls of the interface: Phosphor's own --------------------------------------
export const ArrowSquareOut = P.ArrowSquareOut
export const ArrowsIn = P.ArrowsIn
export const ArrowsOut = P.ArrowsOut
export const CaretDoubleLeft = P.CaretDoubleLeft
export const CaretDown = P.CaretDown
export const CaretLeft = P.CaretLeft
export const CaretRight = P.CaretRight
export const CaretUp = P.CaretUp
export const Check = P.Check
export const CircleNotch = P.CircleNotch
export const Columns = P.Columns
export const Cube = P.Cube
export const Eye = P.Eye
export const EyeSlash = P.EyeSlash
export const Minus = P.Minus
export const Pause = P.Pause
export const Play = P.Play
export const Plus = P.Plus
export const PushPin = P.PushPin
export const Rows = P.Rows
export const SidebarSimple = P.SidebarSimple
export const SkipBack = P.SkipBack
export const SkipForward = P.SkipForward
export const Square = P.Square
export const Stop = P.Stop
export const Warning = P.Warning
export const WarningOctagon = P.WarningOctagon
export const X = P.X
