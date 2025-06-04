import { call } from '@decky/api'

import { getResolver } from './audio'
import { getCache, updateCache } from '../cache/musicCache'
import { Settings, defaultSettings } from '../hooks/useSettings'

type RecentApp = { appid: number; appName: string }

// Guard so the background prefetch only runs once per plugin load.
let hasRun = false

// Picks the N most recently played and N most recently added (purchased) games
// from the Steam library. The two lists are merged and de-duplicated.
export function getRecentLibraryApps(
  playedCount: number,
  addedCount: number
): RecentApp[] {
  const collection =
    collectionStore.GetCollection?.('type-games') ??
    collectionStore.allAppsCollection
  const allApps: SteamAppOverview[] = collection?.allApps ?? []

  const recentlyPlayed =
    playedCount > 0
      ? [...allApps]
          .filter((app) => (app.rt_last_time_played ?? 0) > 0)
          .sort((a, b) => b.rt_last_time_played - a.rt_last_time_played)
          .slice(0, playedCount)
      : []

  const recentlyAdded =
    addedCount > 0
      ? [...allApps]
          .filter((app) => (app.rt_purchase_time ?? 0) > 0)
          .sort((a, b) => b.rt_purchase_time - a.rt_purchase_time)
          .slice(0, addedCount)
      : []

  const seen = new Set<number>()
  const result: RecentApp[] = []
  for (const app of [...recentlyPlayed, ...recentlyAdded]) {
    if (seen.has(app.appid)) {
      continue
    }
    seen.add(app.appid)
    result.push({
      appid: app.appid,
      appName: app.display_name?.replace(/(™|®|©)/g, '')
    })
  }
  return result
}

// Downloads theme music for the recently played / added games so it is cached
// locally and plays without the streaming-URL fetch delay. For games without a
// chosen theme yet it auto-searches and picks the first result, mirroring the
// auto-resolution done when visiting a game page.
export async function prefetchRecentThemes(settings: Settings): Promise<void> {
  // Downloads only work through yt-dlp (Invidious can't download), so there is
  // nothing to prefetch otherwise.
  if (!settings.prefetchEnabled || !settings.useYtDlp) {
    return
  }

  const apps = getRecentLibraryApps(
    settings.prefetchRecentlyPlayedCount,
    settings.prefetchRecentlyAddedCount
  )
  if (apps.length === 0) {
    return
  }

  const resolver = getResolver(settings.useYtDlp)
  for (const app of apps) {
    try {
      const cache = await getCache(app.appid)
      // The user explicitly chose "No Music" for this game—leave it alone.
      if (cache?.videoId === '') {
        continue
      }

      let videoId = cache?.videoId
      if (!videoId?.length) {
        if (!app.appName?.length) {
          continue
        }
        const found = await resolver.getAudio(app.appName)
        if (!found?.videoId?.length) {
          continue
        }
        videoId = found.videoId
        await updateCache(app.appid, { videoId })
      }

      // download_yt_audio is a no-op when the file already exists.
      await resolver.downloadAudio({ id: videoId })
    } catch (err) {
      console.error('[GameThemeMusic] prefetch failed for', app.appid, err)
    }
  }
}

// Loads the saved settings and runs the prefetch once. Safe to call on every
// plugin load; subsequent calls within the same load are ignored.
export async function runStartupPrefetch(): Promise<void> {
  if (hasRun) {
    return
  }
  hasRun = true
  try {
    const savedSettings = await call<[string, Settings], Settings>(
      'get_setting',
      'settings',
      defaultSettings
    )
    // Merge over defaults: get_setting returns the persisted blob as-is, so a
    // config saved by an older build won't contain prefetch* keys and would
    // otherwise leave prefetchEnabled undefined (disabling prefetch entirely).
    const settings = { ...defaultSettings, ...savedSettings }
    await prefetchRecentThemes(settings)
  } catch (err) {
    console.error('[GameThemeMusic] startup prefetch failed', err)
  }
}
