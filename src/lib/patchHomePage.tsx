import { routerHook } from '@decky/api'
import { useEffect, useState } from 'react'
import HomeThemePlayer from '../components/homeThemePlayer'
import {
  AudioLoaderCompatState,
  AudioLoaderCompatStateContextProvider
} from '../state/AudioLoaderCompatState'

const GLOBAL_COMPONENT_NAME = 'GameThemeMusicHomeMount'

/** True when the current in-app route is the library home/main screen. */
const isOnHome = (): boolean =>
  window.location?.pathname?.endsWith('/library/home') ?? false

/**
 * Mounts the focused-game theme player on the home/main screen.
 *
 * The home route exposes no nested renderFunc and its addPatch callback fires
 * repeatedly, so mutating the route's render/component/children caused remount
 * storms. Instead we register one stable always-mounted component and gate the
 * actual player on the current path. The outer component never remounts; only
 * HomeThemePlayer mounts/unmounts as the user enters/leaves the home screen,
 * which cleanly starts/stops the audio.
 */
function patchHomePage(state: AudioLoaderCompatState) {
  const HomeMount = () => {
    const [onHome, setOnHome] = useState(isOnHome())

    useEffect(() => {
      const check = () => {
        const next = isOnHome()
        setOnHome((prev) => (prev === next ? prev : next))
      }
      // Steam navigates via history.push (no popstate), so poll as a backstop
      // and also react to focus moves (every navigation shifts focus) for snap.
      window.addEventListener('focusin', check, true)
      window.addEventListener('popstate', check, true)
      const interval = window.setInterval(check, 1000)
      return () => {
        window.removeEventListener('focusin', check, true)
        window.removeEventListener('popstate', check, true)
        window.clearInterval(interval)
      }
    }, [])

    if (!onHome) {
      return null
    }
    return (
      <AudioLoaderCompatStateContextProvider
        AudioLoaderCompatStateClass={state}
      >
        <HomeThemePlayer />
      </AudioLoaderCompatStateContextProvider>
    )
  }

  routerHook.addGlobalComponent(GLOBAL_COMPONENT_NAME, HomeMount)

  return {
    unpatch() {
      routerHook.removeGlobalComponent(GLOBAL_COMPONENT_NAME)
    }
  }
}

export default patchHomePage
