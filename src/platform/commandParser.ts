/**
 * Command Parser — maps natural-language text to structured commands.
 *
 * Pure function module: no state, no side effects.
 *
 * Matching strategy (three-tier, first tier to pass wins):
 *   0. Pre-check: tryParseNavAddress() — serbest adres navigasyonu (yüksek öncelik)
 *   1. Exact substring  — confidence 1.00  (fast path)
 *   2. Token exact      — confidence 0.82  (any significant input word matches)
 *   3. Fuzzy token      — confidence 0.49–0.72  (edit-distance ≤ 35 %)
 *
 * Accent-normalisation is applied to both input and pattern keywords so
 * "muzigi ac" matches "müziği aç", "haritayi ac" matches "haritayı aç", etc.
 *
 * Upgrade path: replace `scorePattern()` with a TF-Lite embedding call;
 * the `ParsedCommand` / `ParseResult` interfaces stay unchanged.
 */

import { tryParseNavAddress } from './addressParser';
import { tryParseSavedLocationCommand } from './savedLocationCommandParser';
import { tryParseMusicCommand } from './musicCommandParser';
import { classifyHardwareSpeechAct } from './hardwareSpeechActGuard';
import {
  matchProtectedWholeInput,
  PROTECTED_ACTION_TYPES,
  protectedActionClass,
  type ProtectedActionSafetyDecision,
  type ProtectedPhraseEntry,
  type ProtectedWholeInputMatch,
} from './protectedCommandGate';
import { matchVoiceSetting, type VoiceSettingMatch } from './settingsVoice';
import {
  tryParseVehicleQuery,
  VEHICLE_MAINTENANCE_PATTERN,
  VEHICLE_HEALTH_CHECK_PATTERN,
  VEHICLE_CLEAR_DTC_PATTERN,
  VEHICLE_STATUS_PATTERN,
} from './vehicleIntents';

/* ── Music search pre-check ──────────────────────────────── */

/* ── Types ───────────────────────────────────────────────── */

export type CommandType =
  | 'navigate_home'
  | 'navigate_work'
  | 'navigate_address'
  | 'navigate_place'
  | 'find_nearby_gas'
  | 'find_nearby_parking'
  | 'find_nearby_restaurant'
  | 'find_nearby_hospital'
  | 'open_maps'
  | 'open_music'
  | 'play_music_search'
  | 'play_music_query'
  | 'add_music_favorite'
  | 'stop_music'
  | 'music_next'
  | 'music_prev'
  | 'media_video_mode'
  | 'volume_up'
  | 'volume_down'
  | 'open_phone'
  | 'open_settings'
  | 'open_recent'
  | 'show_favorites'
  | 'theme_night'
  | 'theme_dark'
  | 'theme_oled'
  | 'theme_day'
  | 'theme_cycle'
  | 'set_setting'
  | 'music_spotify'
  | 'music_youtube'
  | 'driving_mode'
  | 'toggle_sleep_mode'
  | 'vehicle_speed'
  | 'vehicle_fuel'
  | 'vehicle_temp'
  | 'vehicle_maintenance'
  | 'show_weather'
  | 'show_traffic'
  | 'open_dashcam'
  | 'toggle_bluetooth'
  | 'toggle_wifi'
  | 'screen_brightness_up'
  | 'screen_brightness_down'
  | 'call_contact'
  | 'open_camera'
  | 'vehicle_health_check'
  | 'vehicle_clear_dtc'
  // T-12: Donanım komutları — offline regex, internet gerektirmez
  | 'hw_lock_doors'
  | 'hw_unlock_doors'
  | 'hw_honk_horn'
  | 'hw_flash_lights'
  | 'hw_alarm_on'
  | 'hw_alarm_off'
  | 'hw_rear_camera'
  | 'hw_lights_off'
  | 'hw_screen_off'
  | 'vehicle_status'
  | 'open_radio'
  // V1 — araç sensör sorgusu (vehicleIntents.ts tohumu, extra.sensorQuery ile)
  | 'query_sensor'
  // Özel Konumlar (saved locations) — TEK otorite: savedLocationsService.
  // extra.name (save: null olabilir · rename/delete/share: hedef ad) ·
  // extra.newName (yalnız rename).
  | 'save_location'
  | 'rename_location'
  | 'delete_location'
  | 'share_location'
  // WhatsApp konum gönderimi — extra.recipient (alıcı adı) · extra.isCurrent
  // ('1' ise şu anki GPS, aksi halde extra.name kayıtlı konum adı).
  | 'send_location_contact';

export type CommandPriority = 'critical' | 'high' | 'normal';

export interface ParsedCommand {
  type:       CommandType;
  raw:        string;        // original, unmodified input
  confidence: number;        // 0–1
  feedback:   string;        // "Harita açılıyor" — shown in Voice UI
  priority:   CommandPriority;
  /** Ek yük alanı — navigate_address için destination vb. */
  extra?:     Record<string, string>;
}

/** Shown in the UI when no command matches, as "Did you mean?" chips. */
export interface ParseSuggestion {
  label:   string;  // "Haritayı Aç"
  example: string;  // "haritayı aç"  — tappable shortcut
}

export interface ParseResult {
  command:       ParsedCommand | null;
  suggestions:   ParseSuggestion[];  // up to 3, ordered by relevance
  /**
   * true  → eşleşme tam değil (confidence < 1.0); semanticAiService önerilir.
   * false → ya exact-match ya da hiç eşleşme yok (suggestion listesi doldu).
   */
  needsSemantic: boolean;
  /**
   * KORUNAN EYLEM GÜVENLİK KARARI (P0). `needsSemantic` bir ÖNERİ alanıdır ve
   * çağıranlar onu okumuyordu → yerelde bloklanan metin online beyne gidip
   * `CLEAR_DTC_CODES` üretebiliyordu. Bu alan AÇIK bir güvenlik sözleşmesidir:
   * `blocked === true` iken çağıran semantic/beyin yoluna GİRMEMELİDİR.
   * Korunan eylemle ilgisi olmayan girdilerde alan hiç üretilmez (davranış aynı).
   */
  safetyDecision?: ProtectedActionSafetyDecision;
}

/* ── Pattern definitions ─────────────────────────────────── */

export interface CommandPattern {
  type:     CommandType;
  priority: CommandPriority;
  feedback: string;
  label:    string;    // display name for suggestions
  example:  string;    // example string for suggestions / chip
  keywords: string[];  // substring-match phrases
  tokens:   string[];  // single-word tokens for token-level matching
}

const PATTERNS: CommandPattern[] = [
  {
    type: 'navigate_home', priority: 'critical',
    feedback: 'Eve gidiyoruz',
    label: 'Eve Git', example: 'eve git',
    keywords: [
      // Temel
      'eve git', 'eve dön', 'eve gidelim', 'eve götür', 'anasayfa', 'ana sayfa', 'home', 'evime git', 'eve al beni',
      // Argo / günlük
      'kapağı eve at', 'eve uçur', 'eve ulaştır', 'beni eve bırak', 'eve bas', 'eve fırlat',
      'eve çek', 'eve al', 'gidelim eve', 'haydi eve', 'eve gitsek',
      // Resmi / uzun
      'ev konumuna git', 'ev adresime git', 'evime gidelim', 'home konumuna git',
      'evime dön', 'eve nasıl giderim', 'ev adresimi aç', 'home\'a git',
    ],
    tokens: ['eve', 'home', 'anasayfa', 'evime', 'ev'],
  },
  {
    type: 'navigate_work', priority: 'critical',
    feedback: 'İşe gidiyoruz',
    label: 'İşe Git', example: 'işe git',
    keywords: [
      // Temel
      'işe git', 'işe götür', 'işime git', 'ofise git', 'işyerine git', 'iş yerine git', 'work',
      // Argo / günlük
      'kapağı işe at', 'işe bas', 'işe uçur', 'ofise çek', 'ofise ulaştır',
      'iş yerime git', 'çalışmaya git', 'işe gitsek', 'ofise gidelim',
      // Resmi / uzun
      'iş adresime git', 'iş konumuna git', 'iş adresimi aç', 'work adresine git',
      'iş yerime nasıl giderim', 'ofisime git', 'iş yerine ulaştır',
    ],
    tokens: ['işe', 'iş', 'ofis', 'işyeri', 'work', 'ofise'],
  },
  {
    type: 'open_maps', priority: 'critical',
    feedback: 'Harita açılıyor',
    label: 'Haritayı Aç', example: 'haritayı aç',
    keywords: [
      // Temel
      'haritayı aç', 'harita aç', 'google maps', 'maps aç', 'waze aç',
      'navigasyonu aç', 'navigasyon aç', 'navigasyonu başlat', 'navigasyon başlat',
      'map aç', 'yol tarifi', 'nereye git', 'rota başlat', 'yol göster',
      'haritayı göster', 'rota oluştur', 'yol hesapla',
      // Kısa / argo
      'navi', 'navi aç', 'navi başlat', 'nav aç', 'rota kur', 'rota çiz', 'yol bul',
      'harita getir', 'haritayı çalıştır', 'maps getir',
      // Fiil tabanlı
      'konumu göster', 'nereye gidiyoruz', 'yol ver', 'rota hazırla', 'yolu göster',
      'rotayı hesapla', 'haritayı kullan', 'gidiyoruz nereye', 'yolu hesapla bana',
      // Uzun / resmi
      'navigasyon uygulamasını aç', 'harita uygulamasını başlat', 'rota planla',
      'navigasyonu kur', 'hedef belirle', 'yol tarifi al', 'ulaşım tarifi',
    ],
    tokens: ['harita', 'maps', 'map', 'navigasyon', 'navigate', 'waze', 'rota', 'yol', 'navi', 'nav'],
  },
  {
    type: 'open_music', priority: 'high',
    feedback: 'Müzik başlatılıyor',
    label: 'Müziği Aç', example: 'müziği aç',
    keywords: [
      // Temel
      'müziği aç', 'müzik aç', 'spotify aç', 'müzik çal', 'şarkı aç',
      'şarkı çal', 'müzik başlat', 'play music', 'music aç',
      'müzik oynat', 'şarkı oynat', 'müziği başlat', 'playlist aç',
      // Argo / günlük
      'müzik ver', 'parça ver', 'parça başlat', 'şarkı koy', 'müziğe bas',
      'çal bir şeyler', 'bir parça çal', 'müzik getir', 'playlist çal',
      'bir şarkı koy', 'müziği kur', 'ritim başlat',
      // Kısa form
      'müzik', 'çal', 'oynat', 'şarkı', 'parça',
      // "dinle" ailesi — doğal konuşma ("bir şeyler dinleyelim")
      'müzik dinle', 'müzik dinleyelim', 'şarkı dinle', 'şarkı dinleyelim',
      'bir şeyler dinle', 'bir şeyler dinleyelim', 'biraz müzik dinleyelim',
      'biraz müzik olsun', 'müzik olsun', 'şarkı olsun', 'açsana müzik',
      'koy bir şarkı', 'bir şeyler çalsana', 'müzik istiyorum', 'canım müzik istedi',
      // Uzun / resmi
      'müzik uygulamasını aç', 'müzik çalmaya başla', 'şarkı çalmaya başla',
      'playlist başlat', 'albüm aç', 'hafifçe müzik koy', 'müziği başlatabilir misin',
    ],
    tokens: ['muzik', 'muzigi', 'spotify', 'sarki', 'music', 'cal', 'oynat', 'playlist', 'parca', 'dinle', 'dinleyelim'],
  },
  {
    // Radyo intent: "radyo aç", "radyoyu aç", "fm aç" vb.
    // open_music'ten önce yer almasının nedeni: her ikisinde de 'aç' fiili geçer;
    // radyo spesifik token ('radyo', 'fm') Tier-1 exact'ten geçer → müzik açar.
    // Gerçek radyo kaynağı yoksa open_music ile aynı altyapı kullanılır
    // (voiceCommandHandler'da 'open_radio' → aktif müzik kaynağını aç).
    type: 'open_radio', priority: 'high',
    feedback: 'Radyo açılıyor',
    label: 'Radyoyu Aç', example: 'radyoyu aç',
    keywords: [
      'radyoyu aç', 'radyo aç', 'radyo dinle', 'fm aç', 'radyoyu çalıştır',
      'radyoya geç', 'radyo başlat', 'radyoyu başlat', 'fm dinle',
      'radyoyu aç lütfen', 'radyo istiyorum', 'radyo dinleyelim',
      'fm radyo aç', 'am radyo', 'radyo kanalı aç',
    ],
    tokens: ['radyo', 'radio', 'fm', 'am'],
  },
  {
    type: 'stop_music', priority: 'high',
    feedback: 'Müzik duraklatıldı',
    label: 'Müziği Durdur', example: 'müziği durdur',
    keywords: [
      // Temel
      'müziği durdur', 'müziği kapat', 'müzik kapat', 'müzik durdur',
      'müziği duraklat', 'müzik duraklat', 'pause', 'stop music',
      'şarkıyı durdur', 'çalmayı durdur',
      // Argo / kısa
      'sesi kes', 'müziği kes', 'kes şunu', 'sus', 'sessiz', 'yeter',
      'dur', 'dur artık', 'keser misin', 'şarkıyı kes', 'çalmayı bırak',
      // Uzun
      'müziği duraksatabilir misin', 'şarkıyı durdurabilir misin',
      'bir dakika müziği kapat', 'şimdilik durdur',
    ],
    tokens: ['durdur', 'duraklat', 'pause', 'stop', 'kes', 'sus', 'sessiz'],
  },
  {
    type: 'music_next', priority: 'high',
    feedback: 'Sonraki şarkı',
    label: 'Sonraki Şarkı', example: 'sonraki şarkı',
    keywords: [
      // Temel
      'sonraki şarkı', 'sonraki parça', 'ileri sar', 'next şarkı', 'next',
      // NOT: yalın 'geç' Tier-1 substring olarak "gece moduna geç" / "gündüz moduna geç"
      // / "koyu temaya geç" gibi TEMA komutlarını kaçırıyordu (hepsi music_next'e 1.00
      // veriyordu). Çıkarıldı; tek-kelime "geç" hâlâ 'gec' TOKEN'ı ile şarkı atlar (0.82).
      'atla', 'şarkıyı geç', 'başka şarkı',
      // Argo / kısa
      'skip', 'pas geç', 'ilerle', 'diğeri', 'diğer şarkı', 'bir sonraki',
      'başkası', 'bu değil', 'değiştir şarkıyı', 'başka bir şey çal',
      // "müzik değiştir" ve varyantları
      'müzik değiştir', 'şarkı değiştir', 'şarkıyı değiştir', 'müziği değiştir',
      'değiştir müziği', 'değiştir şarkıyı',
      // Uzun
      'sonraki şarkıya geç', 'şarkıyı ileri al', 'bir sonraki parçaya geç',
      'şunu geç', 'farklı şarkı çal', 'başka parça çal',
    ],
    tokens: ['sonraki', 'next', 'ileri', 'atla', 'gec', 'skip', 'diger', 'degistir'],
  },
  {
    type: 'music_prev', priority: 'high',
    feedback: 'Önceki şarkı',
    label: 'Önceki Şarkı', example: 'önceki şarkı',
    keywords: [
      // Temel
      'önceki şarkı', 'önceki parça', 'geri sar', 'previous', 'prev',
      'öncekine dön', 'önceki',
      // Argo / kısa
      'back', 'geri al', 'bir önceki', 'eski şarkı', 'öncekine git',
      'geri git şarkı', 'aynı şarkıyı tekrar çal', 'geri dön şarkı',
      // Uzun
      'önceki şarkıya dön', 'bir önceki parçaya geç', 'şarkıyı geri al',
    ],
    tokens: ['onceki', 'previous', 'prev', 'geri', 'back', 'eski'],
  },
  {
    type: 'media_video_mode', priority: 'high',
    feedback: 'Video modu açılıyor',
    label: 'Video Modu', example: 'video moduna al',
    keywords: [
      'video moduna al', 'video moduna geç', 'video modunu aç', 'video modu aç',
      'videoyu aç', 'videoyu göster', 'video göster', 'videoyu izle', 'videoya geç',
      'klibi göster', 'klibi aç', 'klip aç', 'görüntüyü aç', 'görüntülü çal',
      'tam ekran video', 'videoyu büyüt', 'video modu',
    ],
    tokens: ['video', 'klip', 'goruntu'],
  },
  {
    type: 'volume_up', priority: 'high',
    feedback: 'Ses artırıldı',
    label: 'Sesi Artır', example: 'sesi aç',
    keywords: [
      // Temel
      'sesi aç', 'sesi artır', 'sesi yükselt', 'daha yüksek', 'sesi kaldır',
      'volume aç', 'volume artır', 'louder', 'ses aç',
      // Argo / günlük
      'volumü aç', 'sesi fırlat', 'ses yetersiz', 'çok sessiz', 'daha fazla ses',
      'açık müzik', 'biraz daha yüksek', 'volume yükselt', 'daha yüksek ses',
      // Kısa
      'yükselt', 'artır', 'aç sesi',
      // Uzun
      'sesi biraz daha yükseltir misin', 'volume biraz artırabilir misin',
      'ses seviyesini artır', 'daha gür çal',
    ],
    tokens: ['louder', 'yukselt', 'artir', 'volume', 'ses', 'yukari'],
  },
  {
    type: 'volume_down', priority: 'high',
    feedback: 'Ses azaltıldı',
    label: 'Sesi Azalt', example: 'sesi kıs',
    keywords: [
      // Temel
      'sesi kıs', 'sesi azalt', 'sesi düşür', 'daha alçak', 'ses kıs',
      'volume kıs', 'volume azalt', 'quieter', 'sesi kapat',
      // Argo / günlük
      'çok yüksek', 'fazla gürültü', 'daha sessiz', 'ses çok yüksek',
      'volume düşür', 'daha az ses', 'kıs şunu',
      // Kısa
      'kıs', 'azalt', 'düşür sesi',
      // Uzun
      'sesi biraz kısabilir misin', 'volume biraz düşürür müsün',
      'ses seviyesini azalt', 'daha kısık çal',
    ],
    tokens: ['kis', 'azalt', 'dusur', 'quieter', 'sessiz', 'asagi'],
  },
  {
    type: 'open_phone', priority: 'critical',
    feedback: 'Telefon açılıyor',
    label: 'Telefonu Aç', example: 'telefonu aç',
    keywords: [
      'telefonu aç', 'telefon aç', 'arama yap', 'call', 'telefon',
      'birini ara', 'rehber', 'kişiler', 'contacts',
      'telefon defteri', 'rehberi aç', 'kişileri göster', 'telefon uygulamasını aç',
    ],
    tokens: ['telefon', 'call', 'ara', 'rehber', 'kisi'],
  },
  {
    type: 'open_settings', priority: 'normal',
    feedback: 'Ayarlar açılıyor',
    label: 'Ayarları Aç', example: 'ayarları aç',
    keywords: [
      'ayarları aç', 'ayarlar aç', 'ayarlara git', 'settings', 'ayarlar',
      'ayarları göster', 'konfigürasyon', 'tercihler', 'sistem ayarları',
      'uygulama ayarları', 'ayarlara gir',
    ],
    tokens: ['ayar', 'settings', 'setting', 'konfigurasyon'],
  },
  {
    type: 'open_recent', priority: 'normal',
    feedback: 'Son uygulama açılıyor',
    label: 'Son Uygulamayı Aç', example: 'son uygulamayı aç',
    keywords: [
      'son uygulamayı aç', 'son uygulama', 'önceki uygulama', 'geri dön',
      'son açılan', 'en son uygulama', 'önceki ekrana dön',
    ],
    tokens: ['son', 'onceki', 'recent', 'last'],
  },
  {
    type: 'show_favorites', priority: 'normal',
    feedback: 'Uygulamalar açılıyor',
    label: 'Favorileri Göster', example: 'favorileri göster',
    keywords: [
      'favorileri göster', 'favoriler', 'favori uygulamalar', 'uygulamaları aç', 'apps',
      'uygulamalar', 'uygulama listesi', 'tüm uygulamalar', 'app menu',
    ],
    tokens: ['favori', 'favorites', 'uygulama', 'apps'],
  },
  {
    type: 'theme_night', priority: 'normal',
    feedback: 'Gece modu aktif',
    label: 'Gece Moduna Geç', example: 'gece moduna geç',
    keywords: [
      'gece moduna geç', 'gece modu', 'karanlık mod', 'dark mod', 'oled modu', 'karanlık tema',
      'gece teması', 'karanlık yap', 'ekranı karartabilir misin', 'night mode',
    ],
    tokens: ['gece', 'karanlik', 'dark', 'oled', 'night'],
  },
  {
    type: 'theme_dark', priority: 'normal',
    feedback: 'Koyu tema etkinleştirildi',
    label: 'Koyu Temaya Geç', example: 'koyu temaya geç',
    keywords: [
      'koyu temaya geç', 'koyu tema', 'dark theme', 'lacivert',
      'koyu renk', 'siyah tema değil', 'dark mod',
    ],
    tokens: ['koyu', 'dark', 'lacivert', 'tema'],
  },
  {
    type: 'theme_oled', priority: 'normal',
    feedback: 'OLED modu etkinleştirildi',
    label: 'OLED Moduna Geç', example: 'oled moduna geç',
    keywords: [
      'oled moduna geç', 'oled modu', 'oled theme', 'siyah tema',
      'tam siyah', 'gerçek siyah', 'amoled', 'oled ekran',
    ],
    tokens: ['oled', 'siyah', 'tema', 'amoled'],
  },
  {
    type: 'theme_day', priority: 'normal',
    feedback: 'Gündüz modu aktif',
    label: 'Gündüz Moduna Geç', example: 'gündüz moduna geç',
    keywords: [
      'gündüz moduna geç', 'gündüz modu', 'gündüz teması', 'aydınlık mod',
      'aydınlık moduna geç', 'aydınlık tema', 'açık tema', 'ekranı aydınlat', 'day mode',
    ],
    tokens: ['gunduz', 'aydinlik'],
  },
  {
    // "tema değiştir" → core temalar arasında döngü. SADECE açık ifadeler eşleşsin
    // diye token listesi boş tutuldu; aksi halde 'tema' / 'degistir' tek-token girişleri
    // theme_dark / music_next ile çakışırdı (skorlama Tier-2). Keyword'ler benzersiz (1.00).
    type: 'theme_cycle', priority: 'normal',
    feedback: 'Tema değiştiriliyor',
    label: 'Temayı Değiştir', example: 'tema değiştir',
    keywords: [
      'tema değiştir', 'temayı değiştir', 'temayı değiştirir misin', 'tema değiştirir misin',
      'temayı değiştirebilir misin', 'temayı değiştirsene', 'tema değiştirelim',
      'başka tema', 'başka bir tema', 'farklı tema', 'farklı bir tema', 'temayı değiştir lütfen',
    ],
    tokens: [],
  },
  {
    type: 'music_spotify', priority: 'normal',
    feedback: 'Spotify seçildi',
    label: 'Spotify Seç', example: 'spotify seç',
    keywords: [
      'spotify seç', 'spotify', 'spotify müzik', 'spotify aç', 'spotify başlat',
      'spotifyı aç', 'spotify ile çal', 'spotify çal',
    ],
    tokens: ['spotify'],
  },
  {
    type: 'music_youtube', priority: 'normal',
    feedback: 'YouTube seçildi',
    label: 'YouTube Seç', example: 'youtube seç',
    keywords: [
      'youtube seç', 'youtube music', 'youtube', 'youtube aç',
      'youtubeı aç', 'youtube ile çal', 'yt müzik',
    ],
    tokens: ['youtube', 'yt'],
  },
  {
    type: 'driving_mode', priority: 'normal',
    feedback: 'Sürüş modu aktif',
    label: 'Sürüş Moduna Geç', example: 'sürüş moduna geç',
    keywords: [
      'sürüş moduna geç', 'sürüş modu', 'driving mode', 'araba modu',
      'araç modu', 'sürüş başlasın', 'yola hazır', 'sürüşe geç',
    ],
    tokens: ['suruş', 'driving', 'araba', 'arac'],
  },
  {
    type: 'toggle_sleep_mode', priority: 'normal',
    feedback: 'Uyku modu değiştirildi',
    label: 'Uyku Modunu Aç/Kapat', example: 'uyku modunu aç',
    keywords: [
      'uyku modunu aç', 'uyku modunu kapat', 'uyku modu', 'sleep mode',
      'bekleme modu', 'ekran uyku', 'sistem uyku',
    ],
    tokens: ['uyku', 'sleep', 'bekleme'],
  },
  {
    type: 'vehicle_speed', priority: 'normal',
    feedback: 'Hız gösteriliyor',
    label: 'Hızı Göster', example: 'hızım kaç',
    keywords: [
      'hızım kaç', 'hız kaç', 'hız nedir', 'ne kadar hızlı', 'hız göster', 'current speed',
      'kaç km gidiyorum', 'hızımı söyle', 'şu an hızım', 'hız limitim ne',
    ],
    tokens: ['hiz', 'speed', 'kac', 'kmh', 'kilometre'],
  },
  {
    type: 'vehicle_fuel', priority: 'normal',
    feedback: 'Yakıt durumu gösteriliyor',
    label: 'Yakıt Durumunu Göster', example: 'yakıt durumum ne',
    keywords: [
      'yakıt durumum ne', 'yakıt kaç', 'yakıt nedir', 'yakıt miktarı', 'fuel level', 'kalan yakıt',
      'benzin ne kadar kaldı', 'depo dolu mu', 'yakıt yeterli mi', 'yakıt azaldı mı',
      'ne kadar yakıt var', 'yakıt seviyesi', 'benzin durumu',
    ],
    tokens: ['yakit', 'fuel', 'tank', 'kalan', 'benzin', 'depo'],
  },
  {
    type: 'vehicle_temp', priority: 'normal',
    feedback: 'Motor sıcaklığı gösteriliyor',
    label: 'Motor Sıcaklığını Göster', example: 'motor sıcaklığı kaç',
    keywords: [
      'motor sıcaklığı kaç', 'motor sıcaklığı nedir', 'motor ısısı', 'engine temp', 'sıcaklık kaç',
      'motor aşırı ısındı mı', 'motor soğuk mu', 'motor ne kadar ısındı',
    ],
    tokens: ['motor', 'sicaklik', 'temp', 'temperature', 'isi'],
  },
  // vehicle_maintenance — tanımı taşındı: vehicleIntents.ts (V3, aynı dizi
  // pozisyonunda; keywords/tokens/feedback BİREBİR).
  VEHICLE_MAINTENANCE_PATTERN,
  {
    type: 'show_weather', priority: 'normal',
    feedback: 'Hava durumu gösteriliyor',
    label: 'Hava Durumunu Göster', example: 'hava nasıl',
    keywords: [
      'hava nasıl', 'hava durumu', 'hava durumunu göster', 'bugün hava nasıl',
      'dışarıda hava nasıl', 'yağmur yağacak mı', 'hava sıcaklığı', 'sıcaklık kaç',
      'weather', 'hava ne', 'dışarısı kaç derece', 'yağmur var mı', 'hava durumu nedir',
      // Ek
      'hava durumunu anlat', 'bugün yağmur var mı', 'dışarı soğuk mu',
      'hava iyi mi', 'kaç derece', 'meteoroloji', 'hava tahmini', 'bugün nasıl bir hava',
      'kar yağıyor mu', 'fırtına var mı', 'sıcak mı soğuk mu',
    ],
    tokens: ['hava', 'weather', 'sicaklik', 'yagmur', 'bulut', 'derece', 'kar'],
  },
  {
    type: 'add_music_favorite', priority: 'normal',
    feedback: 'Şarkı favorilere ekleniyor',
    label: 'Favorilere Ekle', example: 'bu şarkıyı favorilere ekle',
    keywords: [
      'bu şarkıyı favorilere ekle', 'favorilere ekle', 'favorime ekle',
      'kaydet bu şarkıyı', 'beğendim ekle', 'şarkıyı kaydet',
    ],
    tokens: ['favori', 'favorilere', 'ekle', 'kaydet'],
  },
  {
    type: 'show_traffic', priority: 'normal',
    feedback: 'Trafik bilgisi gösteriliyor',
    label: 'Trafiği Göster', example: 'trafik nasıl',
    keywords: [
      'trafik nasıl', 'trafik durumu', 'yol durumu', 'trafiği göster', 'trafik var mı', 'tıkanıklık var mı',
      'yoğunluk nasıl', 'yol açık mı', 'tıkanık mı', 'trafik yoğun mu', 'kazalar var mı',
    ],
    tokens: ['trafik', 'yol', 'tikaniklik', 'traffic', 'yogunluk'],
  },
  {
    type: 'open_dashcam', priority: 'normal',
    feedback: 'Dashcam açılıyor',
    label: 'Dashcam Aç', example: 'dashcamı aç',
    keywords: [
      'dashcamı aç', 'dashcam aç', 'araç kamerasını aç', 'kamera aç', 'yol kamerası',
      'araç içi kamera', 'kayıt başlat', 'sürüş kamerası',
    ],
    tokens: ['dashcam', 'kamera', 'arac', 'kayit'],
  },
  {
    type: 'toggle_bluetooth', priority: 'normal',
    feedback: 'Bluetooth değiştirildi',
    label: 'Bluetooth Aç/Kapat', example: 'bluetoothu aç',
    keywords: [
      'bluetoothu aç', 'bluetooth aç', 'bluetooth kapat', 'bluetoothu kapat', 'bluetooth toggle',
      'bt aç', 'bt kapat', 'bluetooth bağlan', 'bluetooth bağlantısı',
    ],
    tokens: ['bluetooth', 'bt'],
  },
  {
    type: 'toggle_wifi', priority: 'normal',
    feedback: 'WiFi değiştirildi',
    label: 'WiFi Aç/Kapat', example: 'wifiyi aç',
    keywords: [
      'wifiyi aç', 'wifi aç', 'wifi kapat', 'wifiyi kapat', 'wi-fi aç',
      'internet aç', 'internet bağlantısı', 'wifi bağlan', 'hotspot aç',
    ],
    tokens: ['wifi', 'internet', 'hotspot'],
  },
  {
    type: 'screen_brightness_up', priority: 'normal',
    feedback: 'Parlaklık artırıldı',
    label: 'Parlaklığı Artır', example: 'parlaklığı artır',
    keywords: [
      'parlaklığı artır', 'ekranı parlat', 'daha parlak', 'parlaklık aç', 'brightness aç',
      'ekran daha parlak olsun', 'netlik artır', 'ekranı aç', 'daha aydınlık',
    ],
    tokens: ['parlaklik', 'brightness', 'parlat', 'aydinlik'],
  },
  {
    type: 'screen_brightness_down', priority: 'normal',
    feedback: 'Parlaklık azaltıldı',
    label: 'Parlaklığı Azalt', example: 'parlaklığı azalt',
    keywords: [
      'parlaklığı azalt', 'ekranı karart', 'daha karanlık', 'parlaklık kıs', 'brightness kıs', 'gece modu yap',
      'ekranı kıs', 'daha loş', 'ekran rahatsız ediyor', 'parlaklık düşür',
    ],
    tokens: ['karart', 'azalt', 'dim', 'gece', 'los'],
  },
  {
    type: 'find_nearby_restaurant', priority: 'normal',
    feedback: 'Yakın restoranlar aranıyor',
    label: 'Restoran Bul', example: 'yakınımda restoran var mı',
    keywords: [
      'yakınımda restoran', 'restoran bul', 'yemek yeri bul', 'cafe bul', 'yakında ne var',
      'yemek yeyebileceğim yer', 'açık restoran', 'yakın lokanta', 'fast food',
      'nerede yesek', 'yemek yiyelim nerede',
    ],
    tokens: ['restoran', 'yemek', 'cafe', 'lokanta', 'fast'],
  },
  {
    type: 'find_nearby_hospital', priority: 'critical',
    feedback: 'Yakın hastane aranıyor',
    label: 'Hastane Bul', example: 'en yakın hastane',
    keywords: [
      'en yakın hastane', 'hastane bul', 'acil servis', 'yakınımda hastane', 'doktor bul',
      'kaza oldu', 'yardım lazım', 'sağlık merkezi', 'klinik bul', 'eczane bul',
      'ambulans çağır', 'hastaneye git',
    ],
    tokens: ['hastane', 'acil', 'doktor', 'hospital', 'saglik', 'eczane'],
  },
  {
    type: 'call_contact', priority: 'critical',
    feedback: 'Arama başlatılıyor',
    label: 'Kişiyi Ara', example: 'ahmet\'i ara',
    keywords: [
      '\'ı ara', '\'yi ara', '\'ü ara', '\'u ara', 'ara beni', 'arama yap',
      'telefon et', 'bağlan', 'aramak istiyorum',
    ],
    tokens: ['ara', 'call', 'phone', 'telefon'],
  },
  {
    type: 'open_camera', priority: 'normal',
    feedback: 'Kamera açılıyor',
    label: 'Kamerayı Aç', example: 'kamerayı aç',
    keywords: [
      'kamerayı aç', 'kamera aç', 'arka kamera', 'geri kamera', 'rear camera', 'arka kamerayı aç', 'kamerayı göster',
      'fotoğraf çek', 'video kaydına geç', 'kameraya bak',
    ],
    tokens: ['kamera', 'camera', 'fotograf', 'video'],
  },
  // vehicle_health_check / vehicle_clear_dtc — tanımları taşındı:
  // vehicleIntents.ts (V3, aynı dizi pozisyonunda; keywords/tokens/feedback BİREBİR).
  VEHICLE_HEALTH_CHECK_PATTERN,
  VEHICLE_CLEAR_DTC_PATTERN,

  // ── T-12: Donanım Komutları (Offline Regex — internet gerektirmez) ──────
  {
    type: 'hw_lock_doors', priority: 'high',
    feedback: 'Kapılar kilitleniyor',
    label: 'Kapıları Kilitle', example: 'kapıları kilitle',
    keywords: [
      'kapıları kilitle', 'kilitle', 'kapıyı kilitle', 'arabayı kilitle', 'aracı kilitle', 'lock',
      'arabayı kapat', 'kapıları kapat', 'kapıları emniyete al', 'araç kilidi',
    ],
    tokens: ['kilitle', 'lock', 'kapi', 'emniyet'],
  },
  {
    type: 'hw_unlock_doors', priority: 'high',
    feedback: 'Kapılar açılıyor',
    label: 'Kapıları Aç', example: 'kapıları aç',
    keywords: [
      'kapıları aç', 'kilidi aç', 'kilidini aç', 'kapıların kilidini aç', 'aracın kilidini aç', 'arabayı aç', 'aracı aç', 'unlock', 'kapı aç',
      'kilidi kaldır', 'araç kilidini aç', 'kapıları kilitsizle',
    ],
    // 'ac' (aç) KASITLI KALDIRILDI: genel fiil — "radyo aç", "müziği aç" gibi
    // HER cümleyi hw_unlock_doors'a çekiyordu (token-score 0.82 gasping).
    // "kapıları aç" gibi meşru ifadeler Tier-1 exact keywords ile yakalanıyor.
    tokens: ['unlock', 'kilid', 'kapi'],
  },
  {
    type: 'hw_honk_horn', priority: 'normal',
    feedback: 'Korna çalınıyor',
    label: 'Korna Çal', example: 'korna çal',
    keywords: [
      'korna çal', 'kornaya bas', 'kornaya bastır', 'bip yap', 'korna', 'bip', 'kornaları çal', 'ses çıkar',
      'bip bip yap', 'kornayı çal',
    ],
    tokens: ['korna', 'bip', 'horn'],
  },
  {
    type: 'hw_flash_lights', priority: 'normal',
    feedback: 'Farlar yanıp sönüyor',
    label: 'Farları Yak', example: 'farları yak',
    keywords: [
      'farları yak', 'farları aç', 'farları yakıp söndür', 'ışıkları aç', 'far yak', 'ışıkları yak', 'farları flaşla', 'flash', 'selam ver',
      'farları flaş yap', 'kornasız selam', 'yüksek far',
    ],
    tokens: ['far', 'isik', 'yak', 'flash', 'selam'],
  },
  {
    type: 'hw_alarm_on', priority: 'critical',
    feedback: 'Alarm aktifleştiriliyor',
    label: 'Alarmı Aç', example: 'alarmı aç',
    keywords: [
      'alarmı aç', 'alarmı devreye al', 'alarmı aktif et', 'alarm aç', 'alarm ver',
      'arabaya alarm tak', 'güvenlik sistemi aç',
    ],
    tokens: ['alarm', 'aktif', 'guvenlik'],
  },
  {
    type: 'hw_alarm_off', priority: 'critical',
    feedback: 'Alarm durduruluyor',
    label: 'Alarmı Kapat', example: 'alarmı kapat',
    keywords: [
      'alarmı kapat', 'alarmı devreden çıkar', 'alarmı durdur', 'alarm kapat', 'alarm iptal',
      'alarmı söndür', 'alarmı devre dışı bırak', 'güvenlik sistemini kapat',
    ],
    // 'kapat' ve 'durdur' KASITLI KALDIRILDI: genel fiiller — "müziği durdur",
    // "sesi kapat" yanlışlıkla hw_alarm_off'a eşleşebiliyordu (Tier-2 token gasp).
    // "alarmı kapat", "alarmı durdur" exact keywords ile Tier-1'de yakalanıyor.
    tokens: ['alarm', 'iptal'],
  },
  {
    type: 'hw_rear_camera', priority: 'critical',
    feedback: 'Arka kamera açılıyor',
    label: 'Arka Kamerayı Aç', example: 'arka kamerayı aç',
    keywords: [
      'arka kamerayı aç', 'arka kamera aç', 'geri kamera aç', 'geri kameraya bak', 'arka kameraya geç', 'reverse kamera',
      'park kamerası', 'geri görüş', 'geri vitese aldım kamerayı aç',
    ],
    tokens: ['arka', 'geri', 'kamera', 'camera', 'rear', 'park'],
  },
  {
    type: 'hw_lights_off', priority: 'normal',
    feedback: 'Işıklar kapatılıyor',
    label: 'Işıkları Kapat', example: 'ışıkları kapat',
    keywords: [
      'ışıkları kapat', 'farları kapat', 'ışığı söndür', 'farı söndür', 'lights off', 'ışık söndür',
      'araç ışıklarını kapat', 'farları söndür',
    ],
    // 'kapat' ve 'sondur' KASITLI KALDIRILDI: genel fiiller — "müziği kapat",
    // "sesi sondur" gibi ifadeler yanlışlıkla hw_lights_off'a düşüyordu.
    // "ışıkları kapat", "farları söndür" exact keywords ile Tier-1'de yakalanıyor.
    tokens: ['isik', 'far', 'lights'],
  },
  {
    type: 'hw_screen_off', priority: 'normal',
    feedback: 'Ekran kapatılıyor',
    label: 'Ekranı Kapat', example: 'ekranı kapat',
    keywords: [
      'ekranı kapat', 'ekranı söndür', 'ekranı koy', 'display kapat', 'ekranı kapat tamamen',
      'ekranı karart', 'ekranı kapat artık', 'monitörü kapat',
    ],
    tokens: ['ekran', 'screen', 'display', 'monitor'],
  },
  // vehicle_status — tanımı taşındı: vehicleIntents.ts (V3, aynı dizi
  // pozisyonunda; keywords/tokens/feedback BİREBİR).
  VEHICLE_STATUS_PATTERN,
];

/* ── Text normalisation ──────────────────────────────────── */

/** Lowercase + strip Turkish accents + collapse punctuation to spaces. */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[.,!?;:'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Dolgu kelime filtresi ───────────────────────────────── */
// Normalize edilmiş formları — aksan zaten kaldırılmış olmalı

const FILLERS = new Set([
  'hadi', 'haydi', 'lutfen', 'canim', 'asistan', 'simdi', 'artik',
  'biraz', 'acil', 'cabuk', 'hey', 'selam', 'merhaba', 'tamam',
  'ok', 'evet', 'tabi', 'hee', 'ee', 'alo', 'rica', 'ederim',
  'bir', 'bana', 'beni', 'benim', 'sana', 'seni', 'senim',
  'yani', 'iste', 'nasil', 'neden', 'niye', 'lanet', 'vay',
  // Soru edatları — niyet taşımaz; 'misin' fuzzy'de 'music'e (0.6) eşleşip
  // her "... misin?" cümlesini müziğe çekiyordu (saha hatası 2026-06-11).
  // Kalıp içi 'misin'li komutlar reverse-startsWith ile yine yakalanır
  // ('keser misin' → kw.startsWith('keser')).
  'mi', 'mu', 'misin', 'musun', 'misiniz', 'musunuz',
]);

/**
 * Normalized metin içindeki dolgu kelimeleri çıkarır.
 * 3 karakterden kısa token'lar korunur — tek harfli ekler anlam taşıyabilir.
 */
function stripFiller(normalized: string): string {
  const tokens = normalized.split(' ').filter((t) => {
    if (t.length <= 1) return false;
    return !FILLERS.has(t);
  });
  return tokens.join(' ') || normalized; // tümü filler ise orijinali koru
}

/* ── Pre-normalised patterns (computed once at module load) ─ */

interface NormalizedPattern extends Omit<CommandPattern, 'keywords' | 'tokens'> {
  keywords: string[];
  tokens:   string[];
}

const NORM_PATTERNS: NormalizedPattern[] = PATTERNS.map((p) => ({
  ...p,
  keywords: p.keywords.map(normalizeText),
  tokens:   p.tokens.map(normalizeText),
}));

/* ── Levenshtein distance ────────────────────────────────── */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev] = [[...curr], prev]; // swap rows
  }
  return prev[b.length];
}

/* ── Pattern scoring ─────────────────────────────────────── */

const EXACT_SCORE  = 1.00;
const TOKEN_SCORE  = 0.82;
const FUZZY_MIN    = 0.72;   // minimum similarity for fuzzy acceptance (esnetildi: 0.65→0.56)
const FUZZY_SCALE  = 0.88;   // score multiplier for fuzzy matches
const THRESHOLD    = 0.48;   // minimum score to accept a command (esnetildi: 0.50→0.48)

/* ══════════════════════════════════════════════════════════════════════════
 * UNKNOWN-FIRST · AÇIK KOMUT ZORUNLULUĞU (donanım ve yıkıcı intent'ler)
 * ════════════════════════════════════════════════════════════════════════
 * KÖK (denetim 2026-07-28, ölçüldü): 75 komut-OLMAYAN Türkçe cümlenin **48'i**
 * gerçek donanım intent'i üretiyordu (%64) — "korna sesi duyuldu" → korna çal,
 * "kaplumbağa kapıyı izledi" → kapıları kilitle, "camı sildim" → arıza kaydı sil.
 * Üç mekanizma birlikte çalışıyordu:
 *   1) `reverseHit` prefix kuralı: "far" ⊂ "farklı şarkı çal" → **1.00 güven**;
 *   2) donanım kalıplarında TEK KELİMELİK keyword/token ('korna', 'alarm', 'sil');
 *   3) Tier-2 token ve Tier-3 fuzzy'nin bu kalıplara da uygulanması.
 *
 * SÖZLEŞME: aşağıdaki türler için eşleşme YALNIZ **çok kelimeli, tam ifade**
 * (kelime sınırı korumalı) keyword ile olur. Tek kelime · prefix · token · fuzzy
 * bu türlerde ASLA intent üretmez → kanıt yoksa sonuç UNKNOWN/NULL'dur.
 * Bu, "ne olduğunu bilmiyorum" demeyi yanlış eylemden ÜSTÜN tutar.
 */
const EXACT_COMMAND_ONLY: ReadonlySet<CommandType> = new Set<CommandType>([
  'hw_honk_horn', 'hw_lock_doors', 'hw_unlock_doors', 'hw_flash_lights',
  'hw_alarm_on', 'hw_alarm_off', 'hw_rear_camera', 'hw_lights_off', 'hw_screen_off',
  'vehicle_clear_dtc', 'open_phone', 'open_camera',
]);

/**
 * Ön-kapıda da sınanan türler: yukarıdakiler + karışması kolay iki medya komutu.
 * `music_next`/`music_prev` buradadır çünkü müzik ÖN-KONTROLÜ ("sonraki şarkı")
 * onları yutup `open_music` üretiyordu (ölçüldü).
 */
const EXPLICIT_COMMAND_TYPES: ReadonlySet<CommandType> = new Set<CommandType>([
  ...EXACT_COMMAND_ONLY, 'music_next', 'music_prev',
]);

/* ══════════════════════════════════════════════════════════════════════════
 * KORUNAN EYLEM KATALOĞU — TEK GERÇEK KAYNAK
 * ════════════════════════════════════════════════════════════════════════
 * Üretimdeki `PATTERNS` dizisinden TÜRETİLİR; ikinci bir ifade listesi elle
 * KOPYALANMAZ. Yalnız ÇOK KELİMELİ keyword'ler girer — tek kelimelik kalıplar
 * ('kilitle', 'korna', 'flash') mevcut exact-only politikası gereği hiçbir
 * koşulda korunan intent üretemez.
 */
const PROTECTED_CATALOG: readonly ProtectedPhraseEntry[] = (() => {
  const out: ProtectedPhraseEntry[] = [];
  for (const p of NORM_PATTERNS) {
    if (!PROTECTED_ACTION_TYPES.has(p.type)) continue;
    for (const kw of p.keywords) {
      if (!kw.includes(' ')) continue;
      out.push({ actionType: p.type, phrase: kw });
    }
  }
  return out;
})();

/** Üretim kataloğuna bağlanmış korunan-eylem kapısı (tek karar noktası). */
export function matchProtectedWholeInputCommand(rawInput: string): ProtectedWholeInputMatch {
  return matchProtectedWholeInput(rawInput, {
    catalog:   PROTECTED_CATALOG,
    normalize: normalizeText,
  });
}

/**
 * Üretimdeki korunan çok-kelimeli ifadelerin tamamı (regresyon testleri için
 * TEK KAYNAK — test dosyası kendi listesini tutmaz).
 */
export function getProtectedCommandCatalog(): readonly ProtectedPhraseEntry[] {
  return PROTECTED_CATALOG;
}

/* ══════════════════════════════════════════════════════════════════════════
 * DETERMİNİSTİK HIZLI YOL — WHOLE-INPUT (MAVI-P0-LATENCY)
 * ════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * `voiceService`de yalnız BEŞ komut tipi (`volume_up` · `volume_down` ·
 * `stop_music` · `toggle_wifi` · `toggle_bluetooth`) beyni atlıyordu. "sonraki
 * şarkı" gibi TAM eşleşen, kapalı biçimli ve sağlayıcının İYİLEŞTİREMEYECEĞİ
 * komutlar bile önce birleşik beyne gidiyor ve park hâlinde `BRAIN_TIMEOUT_
 * PARKED_MS = 8000` bütçesine kadar bekleyebiliyordu. Bu, konuşma sonu →
 * ilk duyulabilir cevap bütçesinin en büyük tek kalemiydi.
 *
 * ── NEDEN "WHOLE-INPUT", NEDEN "confidence >= 1.0" DEĞİL ──────────────────
 * `EXACT_SCORE` bir ALT-DİZİ skorudur (`normalized.includes(kw)`), girdinin
 * TAMAMI değildir. Beyni atlamak için alt-dizi kanıtı YETERSİZDİR — tam da
 * `protectedCommandGate`in P0'da reddettiği kanıt sınıfı. Bu yüzden hızlı yol
 * yalnız **normalize edilmiş girdinin TAMAMI canonical bir ifadeye EŞİTSE**
 * açılır. Eşit değilse davranış BUGÜNKÜYLE BİREBİR aynıdır (beyne gider).
 *
 * ── SINIRLAR (pazarlıksız) ────────────────────────────────────────────────
 *  · **YETKİ ÜRETMEZ.** Dönen değer yalnız "bu metin kapalı biçimli, bilinen
 *    bir komuttur" der. Kapı (`maviActionAuthority`), onay, capability ve
 *    yürütme zinciri DEĞİŞMEZ — hızlı yol yalnız SAĞLAYICI ÇAĞRISINI atlar.
 *  · **KORUNAN/ARAÇ ETKİLİ EYLEM GİREMEZ.** `PROTECTED_ACTION_TYPES` ve
 *    geri alınamaz dış etkili tipler kümeden YAPISAL olarak dışlanır
 *    (`FAST_PATH_TYPES` bir allowlist'tir, kara liste DEĞİL).
 *  · **SERBEST METİNLİ KOMUT GİREMEZ.** Adres · müzik sorgusu · kişi adı gibi
 *    sağlayıcının ASR onarımından fayda gördüğü tipler kümede YOKTUR.
 *  · SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

/**
 * Beyne gitmesi GEREKMEYEN, kapalı biçimli komut tipleri.
 *
 * Ölçüt (üçü birden): (a) parametre taşımaz ya da parametresi kapalı kümedir,
 * (b) sağlayıcı ASR onarımı sonucu DEĞİŞTİREMEZ, (c) korunan/geri alınamaz
 * değildir. Bu listeye yeni tip eklemek bir ÜRÜN kararıdır — kilit testi
 * kümenin korunan eylemlerle kesişmediğini doğrular.
 */
const FAST_PATH_TYPES: ReadonlySet<CommandType> = new Set<CommandType>([
  /* Medya taşıma — kapalı biçim, parametresiz. */
  'music_next', 'music_prev', 'stop_music', 'open_music',
  /* Ses — refleks (mevcut kritik bypass'la aynı aile). */
  'volume_up', 'volume_down',
  /* Yüzey/panel açma — hedef kapalı kümedir (`screenRegistry`). */
  'open_maps', 'show_traffic', 'show_favorites', 'open_camera',
  'open_dashcam', 'open_recent', 'open_settings', 'open_radio',
  /* Tema/görünüm — kapalı küme. */
  'theme_night', 'theme_day', 'theme_dark', 'theme_oled', 'theme_cycle',
  'screen_brightness_up', 'screen_brightness_down',
  /* Mod — kapalı küme. */
  'driving_mode', 'toggle_sleep_mode',
  /* Donanım toggle — refleks (mevcut kritik bypass'la aynı aile). */
  'toggle_wifi', 'toggle_bluetooth',
  /* Sabit hedefli navigasyon — hedef kullanıcı ayarından gelir, metinden DEĞİL;
     serbest adres (`navigate_address`/`navigate_place`) BİLİNÇLİ olarak YOK. */
  'navigate_home', 'navigate_work',
]);

/**
 * Hızlı yol kataloğu — `PATTERNS`ten TÜRETİLİR (ikinci ifade listesi TUTULMAZ).
 * Korunan eylem tipleri savunma derinliği olarak AYRICA elenir.
 */
const FAST_PATH_CATALOG: ReadonlyMap<string, CommandType> = (() => {
  const out = new Map<string, CommandType>();
  for (const p of NORM_PATTERNS) {
    if (!FAST_PATH_TYPES.has(p.type)) continue;
    if (PROTECTED_ACTION_TYPES.has(p.type)) continue;      // savunma derinliği
    for (const kw of p.keywords) {
      if (!kw) continue;
      // Katalog sırası belirleyicidir: ilk giren kazanır → aynı girdi HER ZAMAN
      // aynı tipi verir (deterministik).
      if (!out.has(kw)) out.set(kw, p.type);
    }
  }
  return out;
})();

/** Hızlı yol eşleşmesi — yalnız GÖZLEM/yönlendirme, yetki DEĞİL. */
export interface DeterministicFastMatch {
  readonly type: CommandType;
  /** Eşleşen canonical (normalize) ifade — LAB/tanı için. */
  readonly phrase: string;
}

/**
 * Girdinin TAMAMI kapalı biçimli bir komut ifadesine eşit mi?
 *
 * `null` → hızlı yol AÇILMAZ (bugünkü davranış: beyne git). Nezaket ekleri
 * `protectedCommandGate`in AÇIK allowlist'iyle AYNI ilkeyle soyulur; genel
 * önek/sonek toleransı YOKTUR.
 */
export function matchDeterministicWholeInput(rawInput: string): DeterministicFastMatch | null {
  if (typeof rawInput !== 'string') return null;
  const raw = rawInput.trim();
  if (!raw) return null;
  /* Tırnak taşıyan girdi KULLANIM değil ZİKİRDİR (korunan kapıyla aynı kural) →
     hızlı yol açılmaz, metin normal akışına devam eder. */
  if (/["'«»“”„‟‘’`´]/.test(raw)) return null;

  let normalized: string;
  try { normalized = normalizeText(raw); } catch { return null; }
  if (!normalized) return null;

  const direct = FAST_PATH_CATALOG.get(normalized);
  if (direct) return { type: direct, phrase: normalized };

  /* AÇIK nezaket eki allowlist'i — `protectedCommandGate.SAFE_PREFIXES` ile
     aynı ürün politikası (uzun olan önce denenir). */
  for (const prefix of ['mavi lutfen', 'mavi', 'lutfen', 'simdi']) {
    if (!normalized.startsWith(`${prefix} `)) continue;
    const rest = normalized.slice(prefix.length + 1).trim();
    const hit = rest ? FAST_PATH_CATALOG.get(rest) : undefined;
    if (hit) return { type: hit, phrase: rest };
  }
  if (normalized.endsWith(' lutfen')) {
    const rest = normalized.slice(0, normalized.length - ' lutfen'.length).trim();
    const hit = rest ? FAST_PATH_CATALOG.get(rest) : undefined;
    if (hit) return { type: hit, phrase: rest };
  }
  return null;
}

/** @internal — kilit testleri (küme ikinci bir yerde KOPYALANMAZ). */
export function getFastPathTypes(): readonly CommandType[] {
  return [...FAST_PATH_TYPES];
}

/**
 * Girdi, AÇIK bir komut ifadesini TAM KELİME olarak içeriyor mu?
 * En UZUN eşleşen kalıp kazanır ("kapıların kilidini aç" → aç, kilitle DEĞİL).
 * Yan etkisiz; hiçbir şey tahmin etmez.
 *
 * ⚠️ KORUNAN EYLEMLER BURADA YOKTUR (P0): containment ile intent üretmek tam da
 * bağımsız denetimde reddedilen mekanizmaydı. Onların TEK yolu
 * `matchProtectedWholeInputCommand`tır → iki paralel güvenlik kararı oluşmaz.
 */
function matchExplicitCommand(normalized: string): NormalizedPattern | null {
  const padded = ` ${normalized} `;
  let best: NormalizedPattern | null = null;
  let bestLen = 0;
  for (const p of NORM_PATTERNS) {
    if (PROTECTED_ACTION_TYPES.has(p.type)) continue;   // korunan eylem: containment YASAK
    if (!EXPLICIT_COMMAND_TYPES.has(p.type)) continue;
    for (const kw of p.keywords) {
      if (!kw.includes(' ')) continue;            // tek kelime AÇIK KOMUT değildir
      if (kw.length > bestLen && padded.includes(` ${kw} `)) { best = p; bestLen = kw.length; }
    }
  }
  return best;
}

function scorePattern(
  normalized:   string,
  inputTokens:  string[],
  pattern:      NormalizedPattern,
): number {
  let score = 0;

  /* ⚠️ KORUNAN EYLEM · SKORLAMA YOLU KAPALI (P0) ────────────────────────────
     Skorlayıcı korunan intent'i ASLA üretemez — ne containment, ne token, ne
     fuzzy. Tek üretim yolu `matchProtectedWholeInputCommand`tır. Bu satır
     olmadan `paddedExact.includes(...)` ikinci bir (ve denetimde reddedilen)
     güvenlik kararı üretirdi. */
  if (PROTECTED_ACTION_TYPES.has(pattern.type)) return 0;

  /* AÇIK KOMUT ZORUNLU türler: yalnız çok kelimeli TAM İFADE eşleşmesi.
     Kelime sınırı iki yönlüdür → "kapıları kilitleme" (olumsuz) ve
     "kapıları kilitledim" (geçmiş zaman) eşleşMEZ.
     (Korunan eylemler yukarıda elendi; burada kalanlar `open_phone`/`open_camera`.) */
  if (EXACT_COMMAND_ONLY.has(pattern.type)) {
    const paddedExact = ` ${normalized} `;
    for (const kw of pattern.keywords) {
      if (!kw.includes(' ')) continue;
      if (paddedExact.includes(` ${kw} `)) return EXACT_SCORE;
    }
    return 0;   // Tier-2 (token) ve Tier-3 (fuzzy) bu türlerde YOK
  }

  // Tier 1 — exact substring (kelime sınırı korumalı)
  // Kısa kalıplar (≤4: 'dur', 'sus') ve ters yön (girdi ⊂ kalıp) TAM KELİME
  // ister. Aksi hâlde 'dur' ⊂ "araç DURumu nasıl" → stop_music gibi gasplar
  // oluyordu (saha hatası 2026-06-11: durum sorusu müziği kapatıyordu).
  const padded = ` ${normalized} `;
  for (const kw of pattern.keywords) {
    const forwardHit = kw.length <= 4
      ? padded.includes(` ${kw} `)          // kısa kalıp: yalnız tam kelime
      : normalized.includes(kw);            // uzun kalıp: alt-dizi güvenli
    // Ters yön (girdi ⊂ kalıp) iki meşru biçim:
    //  a) kalıbın başını söyleme — kesik kelime serbest ('haritayı çal[ıştır]')
    //  b) kalıbın içinden TAM KELİME dizisi ('durumu nasil' ⊂ 'arac durumu nasil')
    //     — yalnız ÇOK KELİMELİ girdi; tek kelime ('iyi' ⊂ 'hava iyi mi')
    //     EXACT sayılmaz, tek kelimenin yeri kürasyonlu token katmanıdır (Tier-2).
    // Eski hâli düz substring'di: 'durum' ⊂ 'hava DURUMu' → weather gaspı.
    /* ⚠️ (a) ARTIK ÇOK KELİMELİ girdi ister. Tek kelimelik girdi bir kalıbın
       ÖNEKİ diye TAM GÜVEN (1.00) alıyordu: "far" ⊂ "farklı şarkı çal" →
       music_next 1.00 · "çal" ⊂ "çalışmaya git" → navigate_work 1.00 ·
       "kapı" ⊂ "kapıları kilitle" → kapı kilidi 1.00. Kesik-kelime toleransı
       ("haritayı çal[ıştır]") çok kelimeli ifadelerde KORUNUR. */
    const reverseHit = kw.length >= 4 && normalized.includes(' ') &&
      (kw.startsWith(normalized) || ` ${kw} `.includes(padded));
    if (forwardHit || reverseHit) {
      score = EXACT_SCORE;
      break;
    }
  }

  // Tier 2 — token exact / prefix
  // Türkçe SONEK dilidir: anlamlı eşleşme "kök + ek"tir (durum→durumu).
  // Eski tok.includes(pt) ORTA-KELİME eşleşmesiydi: 'nasilsin' içinde 'sil'
  // → vehicle_clear_dtc (0.82, otomatik!) gibi tehlikeli gasplar üretiyordu.
  if (score === 0) {
    outer: for (const tok of inputTokens) {
      if (tok.length < 2) continue;
      for (const pt of pattern.tokens) {
        if (tok === pt ||
            (pt.length >= 3 && tok.startsWith(pt)) ||   // yakit → yakitim
            (tok.length >= 3 && pt.startsWith(tok))) {  // hiz → hizlandir
          score = TOKEN_SCORE; break outer;
        }
      }
    }
  }

  // Tier 3 — fuzzy token matching via Levenshtein
  // Min uzunluk 4: 3 harfli çiftlerde 1 mesafe ~0.67 benzerlik veriyor ve
  // 'iyi'~'isi' (sıcaklık) gibi alakasız eşleşmeler THRESHOLD'u geçiyordu.
  // 3 harfli gerçek token'lar ('hiz') Tier-2 exact/prefix ile zaten yakalanır.
  if (score === 0) {
    for (const tok of inputTokens) {
      if (tok.length < 4) continue;
      for (const pt of pattern.tokens) {
        if (pt.length < 4) continue;
        const dist = levenshtein(tok, pt);
        const sim  = 1 - dist / Math.max(tok.length, pt.length);
        if (sim >= FUZZY_MIN) score = Math.max(score, sim * FUZZY_SCALE);
      }
    }
  }

  // Contextual Boost (R-5 / CLAUDE.md §2): araç geri vitesteyse open_camera +0.1 bonus.
  // Hard cap: context boost tek başına confidence'ı 0.9'un üzerine çıkaramaz.
  if (
    score > 0 &&
    pattern.type === 'open_camera' &&
    typeof window !== 'undefined' &&
    !!(window as unknown as Record<string, unknown>).__PRIORITY_REVERSE__
  ) {
    score = Math.min(0.9, score + 0.1);
  }

  return score;
}

/* ── Public API ──────────────────────────────────────────── */

/** Sesli ayar komutu için dinamik geri bildirim metni. */
function settingFeedback(m: VoiceSettingMatch): string {
  switch (m.action) {
    case 'on':   return `${m.label} açılıyor`;
    case 'off':  return `${m.label} kapatılıyor`;
    case 'inc':  return `${m.label} artırılıyor`;
    case 'dec':  return `${m.label} azaltılıyor`;
    case 'set':  return m.kind === 'number'
                   ? `${m.label} yüzde ${m.value} yapılıyor`
                   : `${m.label} ${m.value} olarak ayarlanıyor`;
    case 'open': return `${m.label} ayarları açılıyor`;
    default:     return `${m.label} güncelleniyor`;
  }
}

/**
 * Full parse — returns command + ranked suggestions.
 * Use this everywhere; `parseCommand` is a thin compatibility wrapper.
 */
export function parseCommandFull(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { command: null, suggestions: [], needsSemantic: false };

  /* ── ÖN KAPI: AÇIK DONANIM/YIKICI KOMUT ────────────────────────────────
   * Müzik ön-kontrolünden ÖNCE gelir. Ölçülen kusur: "korna çal" ve
   * "kornayı çal" `tryParseMusicCommand` tarafından yutulup
   * `play_music_query` üretiyordu (sondaki "çal" fiili müzik sanılıyordu) —
   * yani KORNA komutu hiç çalışmıyordu. Aynı şekilde "sonraki şarkı"
   * `open_music`e düşüyordu. Bu kapı YALNIZ tam ifade eşleşmesinde açılır;
   * hiçbir belirsiz girdiyi yakalamaz, dolayısıyla yeni yanlış-pozitif
   * yüzeyi AÇMAZ. */
  /* ── KAPI 0: KORUNAN EYLEM · WHOLE-INPUT ALLOWLIST (P0, EN ÖNDE) ──────────
   * HER ŞEYDEN önce gelir (müzik/ayar/adres ön-kontrolleri dahil): korunan bir
   * eylem yalnız girdinin TAMAMI canonical komutsa üretilir. Bu sıralama aynı
   * zamanda `arka kamerayı aç` → `hw_rear_camera` çakışmasını da çözer (genel
   * kamera yolu artık ondan SONRA çalışır) ve `korna çal`ın müzik ön-kontrolüne
   * yutulmasını önler. */
  const protectedMatch = matchProtectedWholeInputCommand(trimmed);
  if (protectedMatch.matched && protectedMatch.actionType) {
    const p = NORM_PATTERNS.find((x) => x.type === protectedMatch.actionType);
    if (p) {
      return {
        command: {
          type:       p.type,
          raw:        trimmed,
          confidence: EXACT_SCORE,
          feedback:   p.feedback,
          priority:   p.priority,
        },
        suggestions:   [],
        needsSemantic: false,
        safetyDecision: {
          protectedActionMentioned: true,
          blocked:     false,
          actionType:  p.type,
          actionClass: protectedActionClass(p.type) ?? 'vehicle',
        },
      };
    }
  }

  /* Korunan eylem ZİKREDİLDİ ama komut biçiminde DEĞİL → FAİL-CLOSED.
   * En yakın tahmine düşülmez; `safetyDecision.blocked` ile çağıran (voiceService)
   * semantic/beyin yolunu da ATLAR — aksi hâlde yerelde bloklanan metin online
   * sağlayıcıda `CLEAR_DTC_CODES` üretebiliyordu (bağımsız denetim bulgusu #2).
   * Söz edimi guard'ı burada YALNIZ gerekçe/gözlem üretir — karar otoritesi
   * yukarıdaki yapısal eşitlik kuralındadır (kara listeye bağımlılık YOK). */
  if (protectedMatch.blockedReason) {
    const speechAct = classifyHardwareSpeechAct(trimmed);
    return {
      command: null,
      suggestions: [],
      needsSemantic: false,
      safetyDecision: {
        protectedActionMentioned: true,
        blocked:      true,
        reason:       protectedMatch.blockedReason,
        actionType:   protectedMatch.mentionedActionType,
        actionClass:  protectedMatch.mentionedActionClass,
        speechActClass: speechAct.speechClass ?? undefined,
        speechActCue:   speechAct.blocked ? speechAct.cue : undefined,
      },
    };
  }

  const preNormalized = stripFiller(normalizeText(trimmed));
  const explicit = preNormalized ? matchExplicitCommand(preNormalized) : null;
  if (explicit) {
    return {
      command: {
        type:       explicit.type,
        raw:        trimmed,
        confidence: EXACT_SCORE,
        feedback:   explicit.feedback,
        priority:   explicit.priority,
      },
      suggestions:   [],
      needsSemantic: false,
    };
  }

  // Ön kontrol: gelişmiş müzik komutları (source + query + action)
  const musicCmd = tryParseMusicCommand(trimmed);
  if (musicCmd) {
    if (musicCmd.action === 'add_favorite') {
      return {
        command: {
          type:       'add_music_favorite',
          raw:        trimmed,
          confidence: 0.95,
          feedback:   musicCmd.feedback,
          priority:   'high',
        },
        suggestions:   [],
        needsSemantic: false,
      };
    }
    if (!musicCmd.query) {
      return {
        command: {
          type:       'open_music',
          raw:        trimmed,
          confidence: 0.93,
          feedback:   musicCmd.feedback,
          priority:   'high',
          extra: {
            sourcePkg:  musicCmd.source?.pkg  ?? '',
            sourceName: musicCmd.source?.name ?? '',
          },
        },
        suggestions:   [],
        needsSemantic: false,
      };
    }
    return {
      command: {
        type:       'play_music_query',
        raw:        trimmed,
        confidence: 0.93,
        feedback:   musicCmd.feedback,
        priority:   'high',
        extra: {
          query:      musicCmd.query,
          queryType:  musicCmd.queryType,
          sourcePkg:  musicCmd.source?.pkg      ?? '',
          sourceName: musicCmd.source?.name     ?? '',
          searchUri:  musicCmd.query ? (musicCmd.source?.searchUri(musicCmd.query) ?? '') : '',
          action:     musicCmd.action,
        },
      },
      suggestions:   [],
      needsSemantic: false,
    };
  }

  // Ön kontrol: sesli ayar kontrolü ("performans modunu aç", "parlaklığı %50 yap",
  // "wifi aç", "duvar kağıdını değiştir"). Müzik ön-kontrolünden sonra, adres/skorlamadan
  // önce. confidence 0.93 (exact 1.0 değil) → "sesi aç"→volume_up gibi gerçek exact
  // komutlar önceliğini korur. Yanlış pozitif: matchVoiceSetting fiil şartı koşar.
  const settingMatch = matchVoiceSetting(trimmed);
  if (settingMatch) {
    // WiFi/Bluetooth = belirsizliksiz refleks donanım komutu → tam güven (1.0).
    // Böylece voiceService kritik-bypass'ı tetiklenir; ONLINE'ken Gemini'ye
    // gidip (semantik sözlükte toggle YOK → OPEN_SETTINGS) uygulama ayarlarını
    // açma bug'ı önlenir. Diğer ayarlar 0.93'te kalır (gerçek exact'ler öne geçsin).
    const isHwToggle = settingMatch.key === 'wifi' || settingMatch.key === 'bluetooth';
    return {
      command: {
        type:       'set_setting',
        raw:        trimmed,
        confidence: isHwToggle ? 1.0 : 0.93,
        feedback:   settingFeedback(settingMatch),
        priority:   'normal',
        extra: {
          settingKey:    settingMatch.key,
          settingKind:   settingMatch.kind,
          settingAction: settingMatch.action,
          settingValue:  settingMatch.value != null ? String(settingMatch.value) : '',
        },
      },
      suggestions:   [],
      needsSemantic: false,
    };
  }

  // Ön kontrol: Özel Konumlar fiilleri (kaydet/adını değiştir/sil/paylaş) —
  // navigasyon ön-kontrolünden ÖNCE: "Mavi Göl'ü sil" navigasyon TETİKLEYİCİSİ
  // taşımaz (tryParseNavAddress zaten eşleşmez) ama sıra netlik için bilinçli.
  const savedLocMatch = tryParseSavedLocationCommand(trimmed);
  if (savedLocMatch) {
    const typeByVerb: Record<typeof savedLocMatch.verb, CommandType> = {
      save:   'save_location',
      rename: 'rename_location',
      delete: 'delete_location',
      share:  'share_location',
      send:   'send_location_contact',
    };
    return {
      command: {
        type:       typeByVerb[savedLocMatch.verb],
        raw:        trimmed,
        confidence: 1.0,
        feedback:   savedLocMatch.feedback,
        priority:   savedLocMatch.verb === 'delete' ? 'critical' : 'normal',
        extra: {
          name:    savedLocMatch.name ?? '',
          ...(savedLocMatch.newName ? { newName: savedLocMatch.newName } : {}),
          ...(savedLocMatch.verb === 'send' ? {
            recipient: savedLocMatch.recipient ?? '',
            isCurrent: savedLocMatch.isCurrentLocation ? '1' : '',
          } : {}),
        },
      },
      suggestions:   [],
      needsSemantic: false,
    };
  }

  /* ── HAFIZA CÜMLESİ MUAFİYETİ (SAHA 2026-09-11, ölçülen) ─────────────────
   * "yarın Ahmeti arayacağımı hatırla" → `call_contact` (güven 1.0) çıkıyordu:
   * AUTO_DISPATCH_MIN'in (0.7) ÜSTÜNDE olduğu için Mavi hatırlatma yerine
   * ONAYSIZ TELEFON ARIYORDU. Kök neden: komut sözlüğü "ara" gövdesini
   * cümlenin geri kalanından bağımsız eşleştiriyor.
   *
   * Kapı BİLİNÇLİ OLARAK DAR: yalnız cümle bir hafıza fiiliyle BİTİYORSA
   * sözlük eşleşmesi bastırılır → cümle beyne gider ve REMEMBER/FORGET olarak
   * çözülür (kanonik hafıza yolu `companionMemory`; burada YENİ hafıza otoritesi
   * KURULMAZ). "Ahmet'i ara" gibi gerçek komutlar cümle sonunda bu fiilleri
   * taşımadığı için ETKİLENMEZ.
   *
   * Konum kaydı bu kapıdan ÖNCE çözülür (yukarıdaki `savedLocMatch`) — yani
   * "burayı ev diye kaydet" hafıza muafiyetine HİÇ girmez (§4 önceliği). */
  if (/\s(hatırla|unutma)\s*$/.test(trimmed) || /\s(aklında|aklınd[ae])\s+tut\s*$/.test(trimmed)) {
    return { command: null, suggestions: [], needsSemantic: true };
  }

  // Ön kontrol: serbest adres navigasyonu (keyword matching'den önce)
  const navMatch = tryParseNavAddress(trimmed);
  if (navMatch) {
    return {
      command: {
        type:       navMatch.intent as CommandType,
        raw:        trimmed,
        confidence: 0.90,
        feedback:   navMatch.feedback,
        priority:   'critical',
        extra:      { destination: navMatch.destination },
      },
      suggestions:   [],
      needsSemantic: false,
    };
  }

  // NOT: Eskiden burada ikinci bir gevşek müzik-arama ön-kontrolü (tryParseMusicSearch)
  // vardı; sondaki "çal/oynat" fiilini gören HER cümleyi müzik yapıyor ve
  // tryParseMusicCommand'ın bilinçli reddettiği durumları (ör. "haritayı çal",
  // NON_MUSIC_TARGETS) geri diriltiyordu → yanlış müzik açma. Kaldırıldı; gerçek
  // müzik komutları zaten yukarıdaki tryParseMusicCommand (bağlam korumalı) tarafından
  // yakalanıyor. Eşleşmeyen girişler aşağıdaki desen skorlamasına / "anlamadım"a düşer.

  const normalized  = stripFiller(normalizeText(trimmed));
  if (!normalized) return { command: null, suggestions: [], needsSemantic: false };
  const inputTokens = normalized.split(' ').filter((t) => t.length > 0);

  const scored = NORM_PATTERNS.map((p) => ({
    pattern: p,
    score:   scorePattern(normalized, inputTokens, p),
  }));

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  // ── Araç sensör sorgusu (V1 — vehicleIntents.ts tohumu) ──────────────
  // Yalnız best.score TAM EŞLEŞME (1.0) DEĞİLSE denenir: hız/yakıt/motor
  // sıcaklığı/bakım/durum gibi ZATEN kapsanan sorular kendi EXACT (1.0)
  // keyword'leriyle üstteki scored path'te yakalanır — bu patch onlara HİÇ
  // DOKUNMAZ, mevcut davranış birebir korunur (V3'ün işi).
  // <1.0 durumunda (belirsiz Tier-2/3 tahmin YA DA hiç eşleşme) ÖNCE burası
  // denenir: aksi halde "yağ sıcaklığı kaç"/"turbo basıncı ne kadar" gibi
  // commandParser'da karşılığı OLMAYAN sensörler, genel 'kaç'/'ne kadar' gibi
  // token'ların ALAKASIZ bir kalıpla (ör. vehicle_speed'in 'kac' token'ı)
  // yanlışlıkla Tier-2/3 eşleşmesine YEM olurdu (saha gözlemi — bkz. testler).
  // resolveSensor doğrulamazsa (null) eski davranışa (scored/suggestions) düşülür.
  if (best.score < EXACT_SCORE) {
    const vehicleQuery = tryParseVehicleQuery(trimmed);
    if (vehicleQuery) {
      return {
        command: {
          type:       'query_sensor',
          raw:        input.trim(),
          confidence: vehicleQuery.confidence,
          feedback:   'Sensör verisine bakılıyor',
          priority:   'normal',
          extra:      { sensorQuery: vehicleQuery.sensorQuery },
        },
        suggestions:   [],
        needsSemantic: false,
      };
    }
  }

  if (best.score >= THRESHOLD) {
    return {
      command: {
        type:       best.pattern.type,
        raw:        input.trim(),
        confidence: best.score,
        feedback:   best.pattern.feedback,
        priority:   best.pattern.priority,
      },
      suggestions:   [],
      // Exact-match (score 1.0) → semantic lookup gereksiz
      needsSemantic: best.score < EXACT_SCORE,
    };
  }

  // No match — return top 3 as suggestions; semantic lookup önerilir
  return {
    command:       null,
    suggestions:   scored.slice(0, 3).map(({ pattern }) => ({
      label:   pattern.label,
      example: pattern.example,
    })),
    needsSemantic: true,
  };
}

/** Backward-compatible thin wrapper. */
export function parseCommand(input: string): ParsedCommand | null {
  return parseCommandFull(input).command;
}

/** Display label for a command type (used in feedback). */
export function commandLabel(type: CommandType): string {
  return PATTERNS.find((p) => p.type === type)?.label ?? type;
}

/* ── Offline KOMUT GRAMMAR'ı (Yol A — internetsizken OEM-hissi tanıma) ──────────
 * Vosk'u asistanın GERÇEK komut sözlüğüne kısıtlar → arama uzayı daralır, offline
 * komut tanıma doğruluğu fırlar (wake word grammar'ıyla aynı ilke). Grammar dışı
 * konuşma "[unk]"a düşer; parser substring eşleşmesini yine bulur ("haritayı aç
 * lütfen" → "haritayı aç [unk]" → open_maps). Online'da KULLANILMAZ — bulut STT tam
 * dikteyi çözer. Vosk kuralı: sözlükte olmayan kelimeyi (spotify/waze/İngilizce) Vosk
 * sessizce yok sayar; grammar yine kurulur (native try/catch full-vocab fallback). */
let _commandGrammarCache: string[] | null = null;

/** Onay/ret + sohbet kapatma + sık dolgu (parser bunları da bekler). */
const GRAMMAR_CONTROL_WORDS: readonly string[] = [
  'evet', 'tabii', 'olur', 'tamam', 'aynen', 'hayır', 'yok', 'iptal', 'vazgeç',
  'sus', 'kapat', 'dur', 'yeter', 'lütfen', 'bir', 'biraz', 'şunu', 'şu', 'aç', 'kapa',
];

/** Sayılar (klima/ses/derece) + birimler. */
const GRAMMAR_NUMBER_WORDS: readonly string[] = [
  'sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz', 'on',
  'on bir', 'on iki', 'on üç', 'on dört', 'on beş', 'on altı', 'on yedi', 'on sekiz', 'on dokuz',
  'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan', 'yüz',
  'derece', 'yüzde', 'seviye',
];

function _grammarAdd(out: Set<string>, s: string): void {
  const t = s.toLowerCase().trim().replace(/\s+/g, ' ');
  if (t.length >= 2) out.add(t);
}

export function buildCommandGrammar(): string[] {
  if (_commandGrammarCache) return _commandGrammarCache;
  const out = new Set<string>();
  const add = (s: string): void => { _grammarAdd(out, s); };
  for (const p of PATTERNS) {
    for (const k of p.keywords) add(k);
    for (const t of p.tokens) add(t);
  }
  for (const w of GRAMMAR_CONTROL_WORDS) add(w);
  for (const w of GRAMMAR_NUMBER_WORDS) add(w);
  const grammar = Array.from(out);
  grammar.push('[unk]'); // ŞART: liste dışı söz → tek [unk] (yanlış zorlama yok)
  _commandGrammarCache = grammar;
  return grammar;
}

/* ── MAVI-STT-CONTEXT-GRAMMAR: bağlama göre DARALTILMIŞ sözlük ──────────────
 * KATKISAL: `buildCommandGrammar` ve parser davranışı BİREBİR AYNI kalır. Buradaki
 * fonksiyon YALNIZ tanıma adaylarını süzer — intent, eylem veya onay kararı ÜRETMEZ.
 *
 * ⚠️ YALNIZ GERÇEK YÜZEY: sözcükler `PATTERNS`ten gelir, yani offline parser'ın
 * FİİLEN tanıyabildiği ifadelerdir. `CommandType` birleşiminde tanımlı olup
 * `PATTERNS` girdisi OLMAYAN türler (ör. `vehicle_health_check`, `find_nearby_gas`)
 * sessizce ATLANIR — grammar'a girselerdi Vosk duyar ama parser eşleştiremezdi
 * (yeni kullanıcı komutu icat etme yasağı). */

/** İstenen türlerden kaç tanesinin `PATTERNS` karşılığı VAR (gözlem/dürüstlük). */
export function countGrammarBackedTypes(types: readonly CommandType[]): number {
  if (!Array.isArray(types)) return 0;
  const known = new Set(PATTERNS.map((p) => p.type));
  let n = 0;
  for (const t of types) if (known.has(t)) n++;
  return n;
}

/**
 * Verilen komut türlerinin sözcükleri + ortak kontrol/sayı sözcükleri + `[unk]`.
 * `[unk]` HER ZAMAN sonda ve TEK — liste dışı söz tek jetona düşer, yakın bir
 * komuta ZORLANMAZ. Bilinmeyen tür sessizce atlanır (fail-soft).
 */
export function buildCommandGrammarFor(
  types: readonly CommandType[],
  opts?: { readonly includeNumbers?: boolean },
): string[] {
  const wanted = new Set<CommandType>(Array.isArray(types) ? types : []);
  const out = new Set<string>();
  const add = (s: string): void => { _grammarAdd(out, s); };
  for (const p of PATTERNS) {
    if (!wanted.has(p.type)) continue;
    for (const k of p.keywords) add(k);
    for (const t of p.tokens) add(t);
  }
  for (const w of GRAMMAR_CONTROL_WORDS) add(w);
  if (opts?.includeNumbers !== false) for (const w of GRAMMAR_NUMBER_WORDS) add(w);
  const grammar = Array.from(out);
  grammar.push('[unk]');
  return grammar;
}
