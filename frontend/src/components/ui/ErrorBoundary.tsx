import { Component, type ReactNode } from "react"
import { fail } from "../../lib/reports"

/**
 * Keeps a failure inside the area it happened in. Without it, one editor
 * throwing while it renders (a result with an unexpected shape, say) blanks
 * the whole window and every unsaved change with it; with it, the other areas
 * go on working and the failed one says what went wrong.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    fail(`${this.props.label} failed to draw: ${error.message}`)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-[12px] text-destructive-quiet">{this.props.label} could not be drawn.</p>
        <p className="selectable max-w-md break-words font-mono text-[11px] text-muted-foreground">{error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="h-[22px] rounded-[4px] bg-control px-2 text-[12px] text-foreground hover:bg-hover"
        >
          Try Again
        </button>
      </div>
    )
  }
}
