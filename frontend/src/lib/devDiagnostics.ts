import { LogError, LogWarning } from "../../wailsjs/runtime/runtime"

/**
 * Development only: copy the webview's errors into the `wails dev` terminal.
 *
 * The WKWebView console is not visible without opening its inspector, so an
 * error thrown there -- by a component, a rejected promise, or MapLibre, which
 * reports tile and style failures through console.error -- would otherwise go
 * unseen from the terminal that is running the application. Installed from
 * main.tsx behind import.meta.env.DEV, so a built application carries none of
 * it.
 */
export function forwardErrorsToTerminal(): void {
  const describe = (value: unknown): string => {
    if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`
    if (typeof value === "string") return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  window.addEventListener("error", (e) => {
    LogError(`[webview] ${describe(e.error ?? e.message)}`)
  })
  window.addEventListener("unhandledrejection", (e) => {
    LogError(`[webview] unhandled rejection: ${describe(e.reason)}`)
  })

  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    originalError(...args)
    LogError(`[webview] ${args.map(describe).join(" ")}`)
  }
  const originalWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    LogWarning(`[webview] ${args.map(describe).join(" ")}`)
  }
}
