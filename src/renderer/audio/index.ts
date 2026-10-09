import type { UserSounds } from '../../domain/sounds'
import { buildCatalog, withUserSounds, type AudioCatalog } from './catalog'
import { SoundPlayer, type SoundSettings } from './player'

// Every audio file under src/assets/audio is found at build time; see the README in that folder.
const files = import.meta.glob<string>('../../assets/audio/**/*.{mp3,MP3,ogg,OGG,wav,WAV,m4a,M4A}', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const audioCatalog = buildCatalog(files)

if (audioCatalog.unrecognized.length > 0) {
  console.warn(
    '[audio] These files don’t match a known sound name and are ignored:',
    audioCatalog.unrecognized,
  )
}

/** Built-in sounds with the user's own files on top, recomputed only when the user's sounds change. */
function userCatalog(userSounds: () => UserSounds): () => AudioCatalog {
  let lastSounds: UserSounds | null = null
  let merged = audioCatalog
  return () => {
    const sounds = userSounds()
    if (sounds !== lastSounds) {
      lastSounds = sounds
      merged = withUserSounds(audioCatalog, sounds)
    }
    return merged
  }
}

export function createSoundPlayer(
  settings: () => SoundSettings,
  userSounds: () => UserSounds,
  windowShown: () => boolean,
): SoundPlayer {
  return new SoundPlayer({
    catalog: userCatalog(userSounds),
    settings,
    isVisible: () => windowShown() && document.visibilityState === 'visible',
  })
}
