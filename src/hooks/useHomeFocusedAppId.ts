/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { Router } from '@decky/ui'

const FIBER_KEY_PREFIX = '__reactFiber$'

/**
 * Returns the React fiber that Steam attaches to a DOM node, or null if the
 * node carries no fiber (e.g. text nodes or detached elements).
 */
const getFiber = (node: any): any => {
  if (!node || typeof node !== 'object') return null
  const key = Object.keys(node).find((k) => k.startsWith(FIBER_KEY_PREFIX))
  return key ? node[key] : null
}

/**
 * Coerces a Steam appid value to a number. Steam stores appids as either a
 * number (SteamAppOverview) or a numeric string (AppOverview), depending on the
 * object, so accept both.
 */
const toAppId = (value: any): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value))
    return parseInt(value, 10)
  return undefined
}

/**
 * Walks up the fiber tree from the focused node looking for a game's appid.
 * The home grid carries the appid in different shapes depending on the Steam
 * client version (`overview.appid`, `app.appid`, a bare `appid`, …), so rather
 * than hard-coding key names we take the nearest ancestor prop that either is
 * an appid itself or holds an object with one. Walking upwards and returning
 * the first hit yields the focused capsule's own appid.
 */
const resolveAppId = (node: EventTarget | null): number | undefined => {
  let fiber = getFiber(node as any)
  let depth = 0
  while (fiber && depth < 40) {
    const props = fiber.memoizedProps ?? fiber.pendingProps
    if (props && typeof props === 'object') {
      const direct = toAppId(props.appid)
      if (typeof direct === 'number') return direct
      for (const value of Object.values(props)) {
        const nested = toAppId((value as any)?.appid)
        if (typeof nested === 'number') return nested
      }
    }
    fiber = fiber.return
    depth++
  }
  return undefined
}

/**
 * The plugin runs in the SharedJSContext window, whose document is nearly empty
 * — the actual library/home UI (and its game grid) renders in separate Steam UI
 * windows. So we resolve focus against those windows' documents, not ours.
 */
const getUIDocuments = (): Document[] => {
  const docs: Document[] = []
  const add = (doc: Document | undefined | null) => {
    if (doc && !docs.includes(doc)) docs.push(doc)
  }
  try {
    const ws: any = (Router as any)?.WindowStore
    add(ws?.GamepadUIMainWindowInstance?.BrowserWindow?.document)
    for (const w of ws?.SteamUIWindows ?? []) {
      add(w?.BrowserWindow?.document)
    }
  } catch {
    /* noop */
  }
  if (!docs.length) docs.push(document)
  return docs
}

/**
 * Returns the element Steam's gamepad navigation currently highlights, searched
 * across the real UI windows. Navigation is "virtual": it does not move DOM
 * focus, it tags the highlighted element with `gpfocus` (ancestors get
 * `gpfocuswithin`); the deepest match is the focused leaf. Falls back to real
 * DOM focus for mouse/keyboard.
 */
const getFocusedElement = (docs: Document[]): Element | null => {
  for (const doc of docs) {
    const gp = doc.querySelectorAll('.gpfocus, .gpfocuswithin')
    if (gp.length) return gp[gp.length - 1]
  }
  for (const doc of docs) {
    const active = doc.activeElement
    if (active && active !== doc.body) return active
  }
  return null
}

// How long the highlight must rest on a game before we commit to it. Prevents
// scrolling through the library from firing music lookups for every passed
// game and briefly playing intermediate tracks.
const SETTLE_MS = 400
const POLL_MS = 250

/**
 * Tracks the appid of the game currently highlighted on the home page.
 *
 * The home page has no `:appid` in its route, so we resolve the appid from the
 * highlighted capsule's React fiber (see getFocusedElement). The value is
 * debounced: it is committed only once the highlight has rested on the same
 * game for SETTLE_MS, so fast scrolling doesn't start music mid-flight. Moving
 * to a non-game element leaves the last committed appid in place so the music
 * keeps playing while the user navigates buttons/tabs.
 */
const useHomeFocusedAppId = (): number | undefined => {
  const [appId, setAppId] = useState<number | undefined>(undefined)

  useEffect(() => {
    let seen: number | undefined = undefined
    let settleTimer: number | undefined

    const apply = (resolved: number | undefined) => {
      if (typeof resolved !== 'number' || resolved === seen) return
      // Highlight moved to a new game: restart the settle timer.
      seen = resolved
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined
        setAppId((prev) => (prev === seen ? prev : seen))
      }, SETTLE_MS)
    }

    const onFocus = (e: FocusEvent) => apply(resolveAppId(e.target))
    // Gamepad navigation is virtual (no focus events), so poll the highlighted
    // element; focusin still covers mouse/keyboard.
    const poll = () => {
      try {
        apply(resolveAppId(getFocusedElement(getUIDocuments())))
      } catch {
        /* noop */
      }
    }

    window.addEventListener('focusin', onFocus, true)
    const interval = window.setInterval(poll, POLL_MS)
    poll()

    return () => {
      window.removeEventListener('focusin', onFocus, true)
      window.clearInterval(interval)
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    }
  }, [])

  return appId
}

export { useHomeFocusedAppId }
