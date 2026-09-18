import {
  ClearAvatar,
  CurrentUser,
  Login,
  Logout,
  Register,
  SetAvatar,
  UpdateDisplayName,
} from "../../wailsjs/go/main/App"
import type { store } from "../../wailsjs/go/models"
import { info } from "./reports"
import { createStore } from "./store"

export type User = store.User

/** The signed-in account, or null for the guest; `loaded` is false until the Go side has answered. */
export type AccountState = { loaded: boolean; user: User | null }

export const account = createStore<AccountState>({ loaded: false, user: null })

let loading: Promise<void> | null = null

/** Read the account the Go side restored at startup. Concurrent calls share one request. */
export function loadAccount(): Promise<void> {
  if (!loading) {
    loading = CurrentUser()
      .then((u) => account.set({ loaded: true, user: u ?? null }))
      .catch(() => account.set({ loaded: true, user: null }))
  }
  return loading
}

export { errorMessage } from "./errors"

async function signedIn(call: Promise<User>, message: (u: User) => string): Promise<User> {
  const u = await call
  account.set({ loaded: true, user: u })
  info(message(u))
  return u
}

export const register = (email: string, password: string, displayName: string) =>
  signedIn(Register(email, password, displayName), (u) => `Account created. Signed in as ${u.display_name}.`)

export const login = (email: string, password: string) =>
  signedIn(Login(email, password), (u) => `Signed in as ${u.display_name}.`)

export const updateDisplayName = (name: string) =>
  signedIn(UpdateDisplayName(name), (u) => `Display name changed to ${u.display_name}.`)

export const setAvatar = (dataURI: string) => signedIn(SetAvatar(dataURI), () => "Profile photo updated.")

export const clearAvatar = () => signedIn(ClearAvatar(), () => "Profile photo removed.")

export async function logout(): Promise<void> {
  await Logout()
  account.set({ loaded: true, user: null })
  info("Signed out. Working as the guest.")
}
