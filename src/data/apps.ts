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
  androidCategory?: string;    // native: Intent.CATEGORY_APP_xxx
  internalPage?: 'settings';    // routes to in-app page instead of launching
  supportsFavorite: boolean;
  supportsRecent: boolean;
}

export const ALL_APPS: AppItem[] = [
  // İletişim — OEM paketleri yerine evrensel action/category kullan
  { id: 'phone',      name: 'Telefon',        icon: '📞', category: 'communication', url: 'tel:',   androidAction: 'android.intent.action.DIAL',                                                            supportsFavorite: true,  supportsRecent: true  },
  { id: 'messages',   name: 'Mesajlar',       icon: '💬', category: 'communication', url: 'sms:',                                                          androidCategory: 'android.intent.category.APP_MESSAGING', supportsFavorite: true,  supportsRecent: true  },
  { id: 'contacts',   name: 'Kişiler',        icon: '👤', category: 'communication', url: '',                                                               androidCategory: 'android.intent.category.APP_CONTACTS',  supportsFavorite: true,  supportsRecent: true  },

  // Navigasyon
  { id: 'maps',       name: 'Google Maps',    icon: '🗺️', category: 'navigation',    url: 'https://maps.google.com',    androidPackage: 'com.google.android.apps.maps',                      androidCategory: 'android.intent.category.APP_MAPS', supportsFavorite: true,  supportsRecent: true  },
  { id: 'waze',       name: 'Waze',           icon: '🚗', category: 'navigation',    url: 'https://waze.com',           androidPackage: 'com.waze',                                          supportsFavorite: true,  supportsRecent: true  },

  // Medya
  { id: 'spotify',    name: 'Spotify',        icon: '🎵', category: 'media',         url: 'https://open.spotify.com',   androidPackage: 'com.spotify.music',                                 androidCategory: 'android.intent.category.APP_MUSIC', supportsFavorite: true,  supportsRecent: true  },
  { id: 'youtube',    name: 'YouTube',        icon: '▶️', category: 'media',         url: 'https://youtube.com',        androidPackage: 'com.google.android.youtube',                        supportsFavorite: true,  supportsRecent: true  },

  // Tarayıcı
  { id: 'browser',    name: 'Tarayıcı',       icon: '🌐', category: 'browser',       url: 'https://google.com',         androidPackage: 'com.android.chrome',                                androidCategory: 'android.intent.category.APP_BROWSER', supportsFavorite: true,  supportsRecent: true  },

  // Araçlar
  { id: 'weather',    name: 'Hava Durumu',    icon: '⛅', category: 'utility',       url: 'https://weather.com',        androidPackage: 'com.google.android.apps.weather', androidAction: 'android.intent.action.VIEW',         supportsFavorite: true,  supportsRecent: true  },
  { id: 'camera',     name: 'Kamera',         icon: '📷', category: 'utility',       url: '',   androidAction: 'android.media.action.STILL_IMAGE_CAMERA',                                                                          supportsFavorite: true,  supportsRecent: true  },
  { id: 'calculator', name: 'Hesap Makinesi', icon: '🧮', category: 'utility',       url: '',                                                               androidCategory: 'android.intent.category.APP_CALCULATOR',  supportsFavorite: true,  supportsRecent: true  },
  { id: 'clock',      name: 'Saat',           icon: '⏰', category: 'utility',       url: '',   androidAction: 'android.intent.action.SHOW_ALARMS',                                                                                supportsFavorite: true,  supportsRecent: true  },
  { id: 'files',      name: 'Dosyalar',       icon: '📁', category: 'utility',       url: '',   androidPackage: 'com.google.android.apps.nbu.files',                                                                                supportsFavorite: true,  supportsRecent: true  },

  // Sistem
  { id: 'bluetooth',  name: 'Bluetooth',      icon: '📶', category: 'system',        url: '',                                                                                androidAction: 'android.settings.BLUETOOTH_SETTINGS', supportsFavorite: false, supportsRecent: false },
  { id: 'settings',   name: 'Ayarlar',        icon: '⚙️', category: 'system',        url: '', internalPage: 'settings', androidPackage: 'com.android.settings',                              androidAction: 'android.settings.SETTINGS', supportsFavorite: false, supportsRecent: false },
];

/* ── Hızlı erişim yardımcıları ───────────────────────────── */

/** AppGrid'de gösterilecek uygulamalar */
export const GRID_APPS = ALL_APPS;

/** id → AppItem haritası */
export const APP_MAP = Object.fromEntries(ALL_APPS.map((a) => [a.id, a])) as Record<string, AppItem>;

/* ── Settings: Varsayılan Uygulama Seçenekleri ───────────── */

export const NAV_OPTIONS = {
  maps: { name: 'Google Maps', icon: '🗺️', url: 'https://maps.google.com', androidPackage: 'com.google.android.apps.maps', androidCategory: 'android.intent.category.APP_MAPS' },
  waze: { name: 'Waze',        icon: '🚗', url: 'https://waze.com',        androidPackage: 'com.waze',                     androidCategory: 'android.intent.category.APP_MAPS' },
} as const;

export const MUSIC_OPTIONS = {
  spotify: { name: 'Spotify',       icon: '🎵', url: 'https://open.spotify.com',  color: '#1db954', androidPackage: 'com.spotify.music',                  androidCategory: 'android.intent.category.APP_MUSIC' },
  youtube: { name: 'YouTube Music', icon: '▶️', url: 'https://music.youtube.com', color: '#ff0000', androidPackage: 'com.google.android.apps.youtube.music', androidCategory: 'android.intent.category.APP_MUSIC' },
} as const;

export type NavOptionKey   = keyof typeof NAV_OPTIONS;
export type MusicOptionKey = keyof typeof MUSIC_OPTIONS;
