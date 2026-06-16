import { useEffect, useState } from 'react'

import { getCache } from '../cache/musicCache'
import { useSettings } from '../hooks/useSettings'
import { useAudioLoaderCompatState } from '../state/AudioLoaderCompatState'

/**
 * A single, navigation-surviving audio element shared by the home and app-page
 * theme players. Because both players render on different routes (and unmount
 * when you navigate between them), tying the audio to a component would restart
 * the track on every transition. Keeping one element here — switched only when
 * the track URL actually changes — lets the same game's theme play seamlessly
 * across home → game → home.
 */
class ThemeAudioManager {
  private audio: HTMLAudioElement | null = null
  private currentUrl = ''
  private refCount = 0
  private stopTimer: number | undefined
  private suspended = false
  // Bridge the unmount→remount gap during navigation so audio isn't cut.
  private readonly stopDelayMs = 1500

  private ensure(): HTMLAudioElement {
    if (!this.audio) {
      const audio = new Audio()
      audio.preload = 'auto'
      audio.loop = true
      this.audio = audio
    }
    return this.audio
  }

  /** A player mounted: keep audio alive and cancel any pending stop. */
  acquire() {
    this.refCount++
    if (this.stopTimer !== undefined) {
      window.clearTimeout(this.stopTimer)
      this.stopTimer = undefined
    }
  }

  /** A player unmounted: stop shortly after, unless another player takes over. */
  release() {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount === 0 && this.stopTimer === undefined) {
      this.stopTimer = window.setTimeout(() => {
        this.stopTimer = undefined
        if (this.refCount === 0) this.stop()
      }, this.stopDelayMs)
    }
  }

  play(url: string, volume: number) {
    const audio = this.ensure()
    audio.volume = volume
    if (url !== this.currentUrl) {
      this.currentUrl = url
      audio.src = url
      audio.loop = true
      audio.currentTime = 0
      // Load the track but keep it paused while suspended; setSuspended(false)
      // will resume it once no game is running.
      if (!this.suspended) audio.play().catch(() => undefined)
    } else if (audio.paused && !this.suspended) {
      audio.play().catch(() => undefined)
    }
  }

  /**
   * Suspend playback while a game is running (it owns the audio) and resume the
   * loaded track when no game remains. While suspended, play()/ensurePlaying()
   * will not start the element, so the watchdog can't fight this state.
   */
  setSuspended(suspended: boolean) {
    if (this.suspended === suspended) return
    this.suspended = suspended
    if (suspended) {
      if (this.audio && !this.audio.paused) this.audio.pause()
    } else if (this.audio && this.currentUrl && this.audio.paused) {
      this.audio.play().catch(() => undefined)
    }
  }

  setVolume(volume: number) {
    if (this.audio) this.audio.volume = volume
  }

  /**
   * Re-assert playback if the element was paused out from under us. The system
   * pauses audio on suspend; after resume the focused game is unchanged, so
   * play() would otherwise never be called and the music would stay silent
   * until the user moved the selection. A loaded track that is paused while we
   * still hold a currentUrl is always meant to be playing.
   */
  ensurePlaying() {
    if (this.suspended) return
    if (this.audio && this.currentUrl && this.audio.paused) {
      this.audio.play().catch(() => undefined)
    }
  }

  private stop() {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
      this.audio.removeAttribute('src')
    }
    this.currentUrl = ''
  }
}

const themeAudio = new ThemeAudioManager()

/**
 * Resolves the playback volume for a game: its per-game override from cache,
 * falling back to the global setting.
 */
export const useThemeVolume = (appId: number | undefined): number => {
  const { settings, isLoading } = useSettings()
  const [volume, setVolume] = useState(settings.volume)

  useEffect(() => {
    let ignore = false
    async function run() {
      if (typeof appId !== 'number') return
      const cache = await getCache(appId)
      if (ignore) return
      if (typeof cache?.volume === 'number' && isFinite(cache.volume)) {
        setVolume(cache.volume)
      } else {
        setVolume(settings.volume)
      }
    }
    if (!isLoading) run()
    return () => {
      ignore = true
    }
  }, [isLoading, appId, settings.volume])

  return volume
}

/**
 * Plays the given theme URL through the shared audio element. Switching tracks
 * only happens when the URL changes, so navigating between the home and game
 * pages for the same game continues playback instead of restarting it. An empty
 * URL is ignored (the previous track keeps playing) rather than stopped, which
 * also avoids cutting audio during the brief load on the next page.
 */
export const useThemeAudio = (url: string | undefined, volume: number) => {
  const { setOnThemePage, gamesRunning } = useAudioLoaderCompatState()
  const gameRunning = gamesRunning.length > 0

  useEffect(() => {
    themeAudio.acquire()
    // Recover playback after the system pauses audio (e.g. on suspend/resume).
    const watchdog = window.setInterval(() => themeAudio.ensurePlaying(), 1000)
    return () => {
      window.clearInterval(watchdog)
      themeAudio.release()
      setOnThemePage(false)
    }
  }, [])

  // A running game owns the audio: suspend the theme so they don't overlap when
  // the user returns to the menu without quitting the game.
  useEffect(() => {
    themeAudio.setSuspended(gameRunning)
  }, [gameRunning])

  useEffect(() => {
    if (url?.length) {
      themeAudio.play(url, volume)
      setOnThemePage(true)
    }
  }, [url])

  useEffect(() => {
    themeAudio.setVolume(volume)
  }, [volume])
}
