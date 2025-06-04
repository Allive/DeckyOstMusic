/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  afterPatch,
  fakeRenderComponent,
  findInReactTree,
  findModuleByExport,
  MenuItem,
  Navigation,
  Patch
} from '@decky/ui'
import useTranslations from '../hooks/useTranslations'

function ChangeMusicButton({ appId }: { appId: number }) {
  const t = useTranslations()
  return (
    <MenuItem
      key="game-theme-music-change-music"
      onSelected={() => {
        Navigation.Navigate(`/gamethememusic/${appId}`)
      }}
    >
      {t('changeThemeMusic')}...
    </MenuItem>
  )
}

/**
 * Resolves the game's appid from the context-menu component.
 * Older Steam clients exposed it on the owner fiber as
 * `_owner.pendingProps.overview.appid`; newer clients (Oct 2025+) instead
 * carry it as `app.appid` somewhere in the `props.children` tree. We try the
 * legacy path first, then fall back to a tree search, so both keep working.
 */
const getAppId = (component: any): number | undefined => {
  const legacy = component?._owner?.pendingProps?.overview?.appid
  if (typeof legacy === 'number') return legacy

  const foundApp = findInReactTree(
    component?.props?.children,
    (x: any) => typeof x?.app?.appid === 'number'
  )
  return foundApp?.app?.appid
}

// Always add before "Properties..."
const spliceChangeMusic = (children: any[], appid: number) => {
  children.find((x: any) => x?.key === 'properties')
  const propertiesMenuItemIdx = children.findIndex((item) =>
    findInReactTree(
      item,
      (x) => x?.onSelected && x.onSelected.toString().includes('AppProperties')
    )
  )
  children.splice(
    propertiesMenuItemIdx,
    0,
    <ChangeMusicButton key="game-theme-music-change-music" appId={appid} />
  )
}

/**
 * Patches the game context menu.
 * @param LibraryContextMenu The game context menu.
 * @returns A patch to remove when the plugin dismounts.
 */
const contextMenuPatch = (LibraryContextMenu: any) => {
  const patches: {
    outer?: Patch
    inner?: Patch
    unpatch: () => void
  } = {
    unpatch: () => {
      return null
    }
  }
  patches.outer = afterPatch(
    LibraryContextMenu.prototype,
    'render',
    (_: Record<string, unknown>[], component: any) => {
      const appid = getAppId(component)
      // If we can't resolve the appid, leave the menu untouched rather than
      // throwing — a throw here surfaces as a Decky error overlay.
      if (typeof appid !== 'number') {
        return component
      }

      if (!patches.inner) {
        patches.inner = afterPatch(
          component.type.prototype,
          'shouldComponentUpdate',
          ([nextProps]: any, shouldUpdate: any) => {
            try {
              const gtmIdx = nextProps.children.findIndex(
                (x: any) => x?.key === 'game-theme-music-change-music'
              )
              if (gtmIdx != -1) nextProps.children.splice(gtmIdx, 1)
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
              return component
            }

            if (shouldUpdate === true) {
              let updatedAppid: number = appid
              // find the first menu component that has the correct appid assigned to _owner
              const parentOverview = nextProps.children.find(
                (x: any) =>
                  x?._owner?.pendingProps?.overview?.appid &&
                  x._owner.pendingProps.overview.appid !== appid
              )
              // if found then use that appid
              if (parentOverview) {
                updatedAppid = parentOverview._owner.pendingProps.overview.appid
              }
              spliceChangeMusic(nextProps.children, updatedAppid)
            }

            return shouldUpdate
          }
        )
      } else {
        spliceChangeMusic(component.props.children, appid)
      }

      return component
    }
  )
  patches.unpatch = () => {
    patches.outer?.unpatch()
    patches.inner?.unpatch()
  }
  return patches
}

/**
 * Safely stringifies a webpack module export and checks for a substring.
 * Steam's bundle contains exports (e.g. arrays holding Symbols) whose
 * `.toString()` throws "Cannot convert a Symbol value to a string". An
 * unguarded throw aborts the whole module scan and the plugin fails to load,
 * so every stringify is wrapped in try/catch and skipped on failure.
 */
const exportIncludes = (e: any, needle: string): boolean => {
  try {
    return typeof e?.toString === 'function' && e.toString().includes(needle)
  } catch {
    return false
  }
}

/**
 * Game context menu component.
 */
export const LibraryContextMenu = fakeRenderComponent(
  Object.values(
    findModuleByExport((e) => exportIncludes(e, '().LibraryContextMenu')) ?? {}
  ).find((sibling) => exportIncludes(sibling, 'navigator:')) as any
).type

export default contextMenuPatch
