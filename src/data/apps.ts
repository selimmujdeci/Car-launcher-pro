/* ─────────────────────────────────────────────────────────
   Merkezi Uygulama Konfigürasyonu
   Tüm uygulama verileri buradan yönetilir.
   Yeni uygulama eklemek için sadece ALL_APPS'e satır ekle.
───────────────────────────────────────────────────────── */

export type AppCategory =
  | 'communication'
  | 'navigation'
  | 'media'
  | 'browser'
  | 'utility'
  | 'system';

export interface AppItem {
  id: string;
  name: string;
  icon: string;
  category: AppCategory;
  url: string;                  // demo fallback URL; '' → native-only or internal
  androidPackage?: string;      // native: startActivity({ package })
  androidAction?: string;       // native: startActivity({ action, data: url })
  internalPage?: 'settings';    // routes to in-app page instead of launching
  supportsFavorite: boolean;
  supportsRecent: boolean;
}

export const ALL_APPS: AppItem[] = [
  // İletişim
  // phone: action-first (package varies by OEM: Samsung=com.samsung.android.dialer, AOSP=com.android.dialer)
  { id: 'phone',      name: 'Telefon',        icon: '📞', category: 'communication', url: 'tel:',                       androidPackage: 'com.android.dialer',         androidAction: 'android.intent.action.DIAL',         supportsFavorite: true,  supportsRecent: true  },
  { id: 'messages',   name: 'Mesajlar',       icon: '💬', category: 'communication', url: 'sms:',                       androidPackage: 'com.google.android.apps.messaging', androidAction: 'android.intent.action.SENDTO',   supportsFavorite: true,  supportsRecent: true  },
  { id: 'contacts',   name: 'Kişiler',        icon: '👤', category: 'communication', url: '',                           androidPackage: 'com.android.contacts',                              supportsFavorite: true,  supportsRecent: true  },

  // Navigasyon
  { id: 'maps',       name: 'Google Maps',    icon: '🗺️', category: 'navigation',    url: 'https://maps.google.com',    androidPackage: 'com.google.android.apps.maps',                      supportsFavorite: true,  supportsRecent: true  },
  { id: 'waze',       name: 'Waze',           icon: '🚗', category: 'navigation',    url: 'https://waze.com',           androidPackage: 'com.waze',                                          supportsFavorite: true,  supportsRecent: true  },

  // Medya
  { id: 'spotify',    name: 'Spotify',        icon: '🎵', category: 'media',         url: 'https://open.spotify.com',   androidPackage: 'com.spotify.music',                                 supportsFavorite: true,  supportsRecent: true  },
  { id: 'youtube',    name: 'YouTube',        icon: '▶️', category: 'media',         url: 'https://youtube.com',        androidPackage: 'com.google.android.youtube',                        supportsFavorite: true,  supportsRecent: true  },

  // Tarayıcı
  { id: 'browser',    name: 'Tarayıcı',       icon: '🌐', category: 'browser',       url: 'https://google.com',         androidPackage: 'com.android.chrome',                                supportsFavorite: true,  supportsRecent: true  },

  // Araçlar
  { id: 'weather',    name: 'Hava Durumu',    icon: '⛅', category: 'utility',       url: 'https://weather.com',        androidPackage: 'com.google.android.apps.weather', androidAction: 'android.intent.action.VIEW',         supportsFavorite: true,  supportsRecent: true  },
  { id: 'camera',     name: 'Kamera',         icon: '📷', category: 'utility',       url: '',                                                                                androidAction: 'android.media.action.IMAGE_CAPTURE', supportsFavorite: true,  supportsRecent: true  },
  { id: 'calculator', name: 'Hesap Makinesi', icon: '🧮', category: 'utility',       url: '',                           androidPackage: 'com.google.android.calculator',                     supportsFavorite: true,  supportsRecent: true  },

  // Sistem
  { id: 'bluetooth',  name: 'Bluetooth',      icon: '📶', category: 'system',        url: '',                                                                                androidAction: 'android.settings.BLUETOOTH_SETTINGS', supportsFavorite: false, supportsRecent: false },
  // settings: internalPage routes to in-app settings; androidPackage used if that changes
  { id: 'settings',   name: 'Ayarlar',        icon: '⚙️', category: 'system',        url: '', internalPage: 'settings', androidPackage: 'com.android.settings',                              supportsFavorite: false, supportsRecent: false },
];

/* ── Hızlı erişim yardımcıları ───────────────────────────── */

/** AppGrid'de gösterilecek uygulamalar */
export const GRID_APPS = ALL_APPS;

/** id → AppItem haritası */
export const APP_MAP = Object.fromEntries(ALL_APPS.map((a) => [a.id, a])) as Record<string, AppItem>;

/* ── Settings: Varsayılan Uygulama Seçenekleri ───────────── */

export const NAV_OPTIONS = {
  maps: { name: 'Google Maps', icon: '🗺️', url: 'https://maps.google.com', androidPackage: 'com.google.android.apps.maps' },
  waze: { name: 'Waze',        icon: '🚗', url: 'https://waze.com',        androidPackage: 'com.waze'                     },
} as const;

export const MUSIC_OPTIONS = {
  spotify: { name: 'Spotify',       icon: '🎵', url: 'https://open.spotify.com',  color: '#1db954', androidPackage: 'com.spotify.music'                  },
  youtube: { name: 'YouTube Music', icon: '▶️', url: 'https://music.youtube.com', color: '#ff0000', androidPackage: 'com.google.android.apps.youtube.music' },
} as const;

export type NavOptionKey   = keyof typeof NAV_OPTIONS;
export type MusicOptionKey = keyof typeof MUSIC_OPTIONS;
