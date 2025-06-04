import { call } from '@decky/api'
import { useEffect, useState } from 'react'

export type Settings = {
  defaultMuted: boolean
  useYtDlp: boolean
  downloadAudio: boolean
  prefetchEnabled: boolean
  prefetchRecentlyPlayedCount: number
  prefetchRecentlyAddedCount: number
  invidiousInstance: string
  volume: number
}

export const defaultSettings: Settings = {
  defaultMuted: false,
  useYtDlp: true,
  downloadAudio: false,
  prefetchEnabled: true,
  prefetchRecentlyPlayedCount: 10,
  prefetchRecentlyAddedCount: 10,
  invidiousInstance: 'https://inv.tux.pizza',
  volume: 1
}

export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(defaultSettings)

  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const getData = async () => {
      setIsLoading(true)
      const savedSettings = await call<[string, Settings], Settings>(
        'get_setting',
        'settings',
        settings
      )
      // get_setting returns the persisted blob verbatim — it does not merge in
      // keys added in newer plugin versions. Merge over defaults so settings
      // introduced later (e.g. prefetch*) aren't left undefined for users with
      // an older saved config.
      setSettings({ ...defaultSettings, ...savedSettings })
      setIsLoading(false)
    }
    getData()
  }, [])

  async function updateSettings(
    key: keyof Settings,
    value: Settings[keyof Settings]
  ) {
    setSettings((oldSettings) => {
      const newSettings = { ...oldSettings, [key]: value }
      call<[string, Settings], Settings>(
        'set_setting',
        'settings',
        newSettings
      ).catch(console.error)
      return newSettings
    })
  }

  function setDefaultMuted(value: Settings['defaultMuted']) {
    updateSettings('defaultMuted', value)
  }
  function setUseYtDlp(value: Settings['useYtDlp']) {
    updateSettings('useYtDlp', value)
    // Currently, downloads don't work with Invidious, so they can only be enabled iff yt-dlp is enabled.
    updateSettings('downloadAudio', value)
  }
  function setDownloadAudio(value: Settings['downloadAudio']) {
    updateSettings('downloadAudio', value)
  }
  function setPrefetchEnabled(value: Settings['prefetchEnabled']) {
    updateSettings('prefetchEnabled', value)
  }
  function setPrefetchRecentlyPlayedCount(
    value: Settings['prefetchRecentlyPlayedCount']
  ) {
    updateSettings('prefetchRecentlyPlayedCount', value)
  }
  function setPrefetchRecentlyAddedCount(
    value: Settings['prefetchRecentlyAddedCount']
  ) {
    updateSettings('prefetchRecentlyAddedCount', value)
  }
  function setInvidiousInstance(value: Settings['invidiousInstance']) {
    updateSettings('invidiousInstance', value)
  }
  function setVolume(value: Settings['volume']) {
    updateSettings('volume', value)
  }

  return {
    settings,
    setDefaultMuted,
    setUseYtDlp,
    setDownloadAudio,
    setPrefetchEnabled,
    setPrefetchRecentlyPlayedCount,
    setPrefetchRecentlyAddedCount,
    setInvidiousInstance,
    setVolume,
    isLoading
  }
}
