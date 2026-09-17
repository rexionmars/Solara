import { User as UserIcon } from "@phosphor-icons/react"
import type { User } from "../../lib/account"

/**
 * The account's photo in a circle; its initial when there is no photo; a
 * person glyph for the guest.
 */
export function Avatar({ user, size }: { user: User | null; size: number }) {
  const box = { width: size, height: size }
  if (user?.avatar_uri) {
    return <img src={user.avatar_uri} alt="" className="shrink-0 rounded-full object-cover" style={box} />
  }
  const initial = user?.display_name.trim().charAt(0).toUpperCase()
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-hover font-semibold text-foreground/90"
      style={{ ...box, fontSize: size * 0.42 }}
    >
      {initial || <UserIcon size={size * 0.6} />}
    </span>
  )
}
