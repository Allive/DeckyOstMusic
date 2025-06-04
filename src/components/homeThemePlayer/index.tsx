import { ReactElement } from 'react'

import useThemeMusic from '../../hooks/useThemeMusic'
import { useHomeFocusedAppId } from '../../hooks/useHomeFocusedAppId'
import { useThemeAudio, useThemeVolume } from '../../lib/themeAudio'

/**
 * Plays the theme music of the game currently highlighted on the home page.
 * Behaves like ThemePlayer, but the appid comes from the highlighted capsule
 * (see useHomeFocusedAppId) instead of the route params, and changes as the
 * user moves through the library grid. Playback goes through the shared
 * themeAudio so it continues seamlessly into the game page and back.
 */
export default function HomeThemePlayer(): ReactElement {
  const appId = useHomeFocusedAppId()
  const { audio } = useThemeMusic(appId ?? 0)
  const volume = useThemeVolume(appId)

  useThemeAudio(audio.audioUrl, volume)

  return <></>
}
