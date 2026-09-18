/** Wails rejects a bound method's promise with the Go error's text. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e
  if (e instanceof Error) return e.message
  return String(e)
}
