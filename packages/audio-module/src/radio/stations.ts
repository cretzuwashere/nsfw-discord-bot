/**
 * Built-in online radio stations. This is the SINGLE place to curate the
 * station list — command handlers never hardcode stations; they read this list
 * through the RadioRegistry.
 *
 * Requirements for a stream URL:
 *  - It must be a DIRECT audio stream (Icecast/Shoutcast `…-mp3`/`.aac`/`.ogg`),
 *    NOT a `.pls`/`.m3u` playlist file (those parse as audio at the HTTP layer
 *    but fail in ffmpeg). Resolve the playlist to its inner stream URL first.
 *  - If you set ALLOWED_AUDIO_DOMAINS, the stream host must be on that list.
 *
 * To add a station: append an entry below with a unique `id`. See
 * docs/music/online-radio.md for the full walkthrough.
 */
export interface RadioStation {
  /** Stable, lowercase, URL-safe identifier (used by `/radio play <id>`). */
  id: string;
  name: string;
  category: string;
  /** Direct audio stream URL. */
  streamUrl: string;
  websiteUrl?: string;
  description?: string;
  /** Disabled stations are hidden from listing and rejected on play. */
  enabled: boolean;
  /** Ascending display order within a category. */
  sort: number;
}

/**
 * A small, curated default set of SomaFM stations — listener-supported,
 * commercial-free, and served as direct MP3 streams (ideal for ffmpeg).
 */
export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'groovesalad',
    name: 'SomaFM: Groove Salad',
    category: 'Chillout',
    streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3',
    websiteUrl: 'https://somafm.com/groovesalad/',
    description: 'A nicely chilled plate of ambient/downtempo beats and grooves.',
    enabled: true,
    sort: 1,
  },
  {
    id: 'dronezone',
    name: 'SomaFM: Drone Zone',
    category: 'Ambient',
    streamUrl: 'https://ice1.somafm.com/dronezone-128-mp3',
    websiteUrl: 'https://somafm.com/dronezone/',
    description: 'Atmospheric textures with minimal beats. Served deep.',
    enabled: true,
    sort: 1,
  },
  {
    id: 'lush',
    name: 'SomaFM: Lush',
    category: 'Chillout',
    streamUrl: 'https://ice1.somafm.com/lush-128-mp3',
    websiteUrl: 'https://somafm.com/lush/',
    description: 'Sensuous and mellow vocals, mostly female, with an electronic influence.',
    enabled: true,
    sort: 2,
  },
  {
    id: 'indiepop',
    name: 'SomaFM: Indie Pop Rocks!',
    category: 'Indie',
    streamUrl: 'https://ice1.somafm.com/indiepop-128-mp3',
    websiteUrl: 'https://somafm.com/indiepop/',
    description: 'New and classic favorite indie pop tracks.',
    enabled: true,
    sort: 1,
  },
  {
    id: 'defcon',
    name: 'SomaFM: DEF CON Radio',
    category: 'Electronic',
    streamUrl: 'https://ice1.somafm.com/defcon-128-mp3',
    websiteUrl: 'https://somafm.com/defcon/',
    description: 'Music for hacking. The DEF CON soundtrack.',
    enabled: true,
    sort: 1,
  },
  {
    id: 'spacestation',
    name: 'SomaFM: Space Station Soma',
    category: 'Electronic',
    streamUrl: 'https://ice1.somafm.com/spacestation-128-mp3',
    websiteUrl: 'https://somafm.com/spacestation/',
    description: 'Tune in, turn on, space out. Spaced-out ambient and mid-tempo electronica.',
    enabled: true,
    sort: 2,
  },
  {
    id: 'secretagent',
    name: 'SomaFM: Secret Agent',
    category: 'Lounge',
    streamUrl: 'https://ice1.somafm.com/secretagent-128-mp3',
    websiteUrl: 'https://somafm.com/secretagent/',
    description: 'The soundtrack for your stylish, mysterious, dangerous life. Lounge and downtempo.',
    enabled: true,
    sort: 1,
  },
  {
    id: 'bootliquor',
    name: 'SomaFM: Boot Liquor',
    category: 'Americana',
    streamUrl: 'https://ice1.somafm.com/bootliquor-128-mp3',
    websiteUrl: 'https://somafm.com/bootliquor/',
    description: 'Americana roots music for cowhands, cowpokes and cowtippers.',
    enabled: true,
    sort: 1,
  },
];
