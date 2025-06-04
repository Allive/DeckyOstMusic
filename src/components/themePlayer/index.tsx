import { useParams } from '@decky/ui'
import { ReactElement } from 'react'

import useThemeMusic from '../../hooks/useThemeMusic'
import { useThemeAudio, useThemeVolume } from '../../lib/themeAudio'

export default function ThemePlayer(): ReactElement {
  const { appid } = useParams<{ appid: string }>()
  const id = parseInt(appid)
  const { audio } = useThemeMusic(id)
  const volume = useThemeVolume(id)

  useThemeAudio(audio.audioUrl, volume)

  return <></>
}
