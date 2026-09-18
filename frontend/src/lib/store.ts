import { useSyncExternalStore } from "react"

/**
 * A value that components can subscribe to without sharing a parent.
 *
 * The workbench panels read state that changes outside React -- the map moves
 * every frame, the sidecar answers when it answers -- and each panel needs only
 * its own slice. A store per subject keeps a map pan from re-rendering the
 * ribbon, which a context at the root would do.
 */
export type Store<T> = {
  get(): T
  set(next: T | ((prev: T) => T)): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      value = typeof next === "function" ? (next as (prev: T) => T)(value) : next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}
