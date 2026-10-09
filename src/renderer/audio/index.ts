import { buildCatalog } from './catalog'
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

export function createSoundPlayer(settings: () => SoundSettings, windowShown: () => boolean): SoundPlayer {
  return new SoundPlayer({
    catalog: audioCatalog,
    settings,
    isVisible: () => windowShown() && document.visibilityState === 'visible',
  })
}
