import { useEffect, useRef } from 'react';
import { toIntent, routeIntent, type AppIntent } from '../platform/intentEngine';
import { registerCommandHandler, registerAIResultHandler, cancelAssistantDuck, isResultAckCommand } from '../platform/voiceService';
// MAVI-M3: sahte ACK yerine YÜRÜTME SONUCUNDAN türeyen tek geri bildirim zarfı.
import { buildIntentExecutionFeedback } from '../platform/intentExecutionResult';
// MAVI-M5: geç dönen yürütme sonucu yeni turu bozamaz.
import { continueIfTurnCurrent, getActiveMaviTurn } from '../platform/assistant/maviTurn';
// MAVI-M6: normal kullanıcı cevabının TEK otoritesi (ttsService'e delege eder).
import { speakMaviAnswer } from '../platform/assistant/maviSpeech';
import type { VehicleContext } from '../platform/aiVoiceService';
import { reportVoiceDiag } from '../platform/voiceDiagService';
import { play, getMediaState, setMediaPreferredPackage } from '../platform/mediaService';
// next/previous/togglePlayPause: UI'nın kullandığı KUYRUK-FARKINDA + in-app yönlendiren
// sürümler (mediaService'inkiler native MediaSession'a özel; tarayıcıda no-op + YouTube/
// stream kuyruğunu bilmez → "değiştir/durdur" çalışmıyordu).
import { next, previous, togglePlayPause } from '../platform/media/carosMediaLayer';
import { setVideoMode as applyVideoMode } from '../platform/media/videoModeStore';
/* MUSIC F7.2 · sürüşte video görüntüsü kapalı — sesli komut da SAHTE ONAY vermez. */
import { bridge, isNative } from '../platform/bridge';
import { showToast } from '../platform/errorBus';
import { CarLauncher } from '../platform/nativePlugin';
import type { MusicOptionKey } from '../data/apps';
import type { MusicFavorite, AppSettings } from '../store/useStore';
import { useStore } from '../store/useStore';
import { useCarTheme, baseOf, toDay, toNight, isDay, type CoreTheme } from '../store/useCarTheme';
import { getVoiceSetting } from '../platform/settingsVoice';
import { unknownMaviVehicleContext, currentMaviVehicleContext } from '../platform/assistant/maviVehicleContext';
// MAVI-M4: tek eylem otoritesi + açık onay akışı.
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
// MAVI-F7: ayar portu artık KANIT döner — koşulsuz "Ayar uygulandı" iddiası kapandı.
import type { SettingApplyEvidence } from '../platform/capability/observation/observationContract';
import { isVehicleEffectiveIntent, getVehicleActionDef } from '../platform/action/maviActionAuthority';
import { setPendingAction, setConfirmedActionExecutor } from '../platform/action/pendingActionConfirmation';
import type { IntentExecutionResult } from '../platform/intentExecutionResult';
import { isCommandOwnedByMavi, resolveOwnershipKey } from '../platform/maviCore/wiring/maviOwnership';
import { recordLegacyExecution, adjustRegistration } from '../platform/maviCore/wiring/maviEvidence';

// activeMediaSourceKey değerleri içinde geçerli MusicOptionKey olabilenler
const _MUSIC_KEY_SET = new Set<string>(['spotify', 'youtube'] satisfies MusicOptionKey[]);

/* MUSIC F14 · ÖLÇÜLEN GERÇEK: bu tipler `isVehicleEffectiveIntent` DIŞINDA
   kaldığı için `routeIntent`e (aşağıdaki `RouterContext` portları:
   `playMusicSearch`/`playMusicQuery`/`addMusicFavorite`/`nextTrack`/
   `prevTrack`/`playMedia`/`pauseMedia`) gidiyordu — bu portlar F9'un
   `dispatchMusicIntent`inden GEÇMEDEN doğrudan `carosMediaLayer`/eski Zustand
   favori deposunu çağırıyordu (`ADD_MUSIC_FAVORITE` → `useStore.addMusicFavorite`,
   F13'ün TEK otoritesinden AYRI bir favori kaydı). AI/beyin yolu
   (`executeAIResult` → `dispatchIntent`, HER ZAMAN) bu tipleri ZATEN
   `commandExecutor.dispatchIntent`in F9'a bağlı/kanıta-dayalı dallarından
   geçiriyordu — iki yol aynı komut için FARKLI davranıyordu. Bu küme o
   ayrışmayı kapatır: müzik tipleri artık HER İKİ girişten de (yerel parser +
   AI) AYNI tek otoriteye (`executeIntent` → `dispatchIntent`) gider.
   `routeIntent`in müzik dalları artık bu yoldan ULAŞILAMAZ — silinmedi
   (0 başka çağıran KANITLANDI ama büyük çok-dosyalı silme riskten kaçınmak
   için bilinçli olarak ERTELENDİ), yalnız compatibility adapter'a indi. */
const _MUSIC_INTENT_TYPES = new Set<AppIntent['type']>([
  'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PLAY_MUSIC_QUERY', 'ADD_MUSIC_FAVORITE',
  'PLAY_MEDIA', 'PAUSE_MEDIA', 'MEDIA_NEXT', 'MEDIA_PREV',
]);

/* ── MAVI-M4 · sesli hattın araç etkili YÜRÜTÜCÜ PORTLARI ───────────────────
 * KÖK NEDEN (M4 envanteri): bu hat donanım portlarını HİÇ taşımıyordu —
 * `routeIntent` `ctx.hwHonkHorn?.()` gibi OPSİYONEL çağrılar yapıyor, port
 * hiç sağlanmadığı için çağrı SESSİZCE düşüyordu. Yani "korna çal" komutu
 * yıllardır hiçbir şey yapmadan geçiyordu ve kimse fark etmiyordu.
 *
 * Tek otoritede bu artık MÜMKÜN DEĞİL: port yoksa kapı DÜRÜST `unsupported`
 * döner. Burada portlar `bridge` üzerinden (VehicleCommandQueue → L2 ACK)
 * bağlanır; yeni bir native yetenek eklenmez, var olan kuyruk kullanılır.
 * Nesne her çağrıda AYNI ŞEKİLDE (aynı anahtar sırası) üretilir → V8 hidden
 * class kararlı kalır (CLAUDE.md · Shape Stability). */
function _vehiclePorts(): Pick<
  CommandContext,
  'hwLockDoors' | 'hwUnlockDoors' | 'hwHonkHorn' | 'hwFlashLights' | 'hwAlarmOn' | 'hwAlarmOff'
> {
  return {
    hwLockDoors:   () => bridge.hwLockDoors(),
    hwUnlockDoors: () => bridge.hwUnlockDoors(),
    hwHonkHorn:    () => bridge.hwHonkHorn(),
    hwFlashLights: () => bridge.hwFlashLights(),
    hwAlarmOn:     () => bridge.hwAlarmOn(),
    hwAlarmOff:    () => bridge.hwAlarmOff(),
  };
}

/* ── Sesli tema kontrolü ───────────────────────────────────────────────
 * Sesli komutlar GÖRÜNÜR temayı (useCarTheme) değiştirir — eskiden yalnızca
 * kullanılmayan useStore.settings.theme flag'ine yazıyordu (görsel etki yoktu).
 * getState() React dışında ve monomorfik çağrıda güvenli (zero re-render). */
function applyVoiceTheme(mode: 'night' | 'day' | 'oled' | 'dark'): void {
  const { theme, setTheme } = useCarTheme.getState();
  if (mode === 'oled')     setTheme('oled');            // saf siyah (düşük güç)
  else if (mode === 'day') setTheme(toDay(theme));      // mevcut temanın gündüz varyantı
  else                     setTheme(toNight(theme));    // 'night' | 'dark' → gece varyantı
}

// "tema değiştir" → SADECE tema seçicide sunulan temalar arasında döngü.
// 'sunlight' ÇIKARILDI: seçicide yok + NewHomeLayout onu render etmez → yetim
// fallback layout'a düşüp "silinmiş tema açıldı" görünümü veriyordu.
const _THEME_CYCLE: CoreTheme[] = ['expedition', 'horizon', 'tesla', 'pro'];
function cycleVoiceTheme(): void {
  const { theme, setTheme } = useCarTheme.getState();
  const idx  = _THEME_CYCLE.indexOf(baseOf(theme) as CoreTheme); // legacy/bilinmeyen → -1 → ilk tema
  const next = _THEME_CYCLE[(idx + 1) % _THEME_CYCLE.length];
  setTheme(isDay(theme) ? toDay(next) : next); // gündüz/gece tercihini koru
}

/* ── Sesli ayar kontrolü (set_setting, toggle_wifi/bt, brightness) ─────────
 * Aksiyonu doğrudan AppSettings'e (veya wifi/bt/brightness native) uygular.
 * getState() React dışında güvenli; openTab için drawer açıcı callback geçilir. */
const _SETTING_STEP = 10;

/** Ayar deposundan GERİ OKUMA — yazılan değer gerçekten oturdu mu. */
function _readBackSetting(key: string): unknown {
  try {
    return (useStore.getState().settings as unknown as Record<string, unknown>)[key];
  } catch { return undefined; }
}

/**
 * MAVI-F7 · Sesli ayar kontrolü — **artık KANIT DÖNER.**
 *
 * ÖLÇÜLEN KUSUR (F5 borcu, kütük #986/b): bu fonksiyon `void` dönüyordu ve
 * `commandExecutor` porta ULAŞSIN ULAŞMASIN koşulsuz "Ayar uygulandı" diyordu.
 * Artık ne yaptığını bildirir:
 *   · `APPLIED`        — depoya yazıldı ve **geri okundu** (bağımsız gözlem)
 *   · `DELIVERED`      — native'e gönderildi, kanıt DÖNMÜYOR (WiFi/Bluetooth)
 *   · `SURFACE_OPENED` — yalnız ilgili ayar sekmesi açıldı, ayar UYGULANMADI
 *   · `REJECTED`       — değer yok / geri okuma tutmadı
 *
 * Fonksiyon SENKRON hâle geldi: kanıt depodan senkron okunur. Native yan
 * etkiler (WiFi/BT/parlaklık) `void` promise ile ateşlenir — davranış AYNI,
 * yalnız kanıt artık kaybolmuyor. Sahte başarı EKLENMEDİ: kanıt üretmeyen
 * yollar dürüstçe `DELIVERED`/`SURFACE_OPENED` döner.
 */
function applyVoiceSetting(
  key: string,
  action: string,
  value: string | undefined,
  kind: string | undefined,
  openSettings: () => void,
): SettingApplyEvidence {
  // WiFi / Bluetooth — DOĞRUDAN aç/kapat. Native önce donanım toggle'ı dener
  // (eski Android / sistem-app head unit → ekran açılmadan uygulanır); modern
  // telefonda OS engeller → native otomatik sistem paneline düşer (fail-soft).
  // Eski plugin sürümünde setWifi/setBluetooth yoksa eski panel-açma davranışı.
  if (key === 'wifi' || key === 'bluetooth') {
    if (!isNative) return { kind: 'REJECTED', key, reason: 'not_native' };
    const opts = action === 'toggle' ? { toggle: true } : { enabled: action === 'on' };
    void (async () => {
      try {
        if (key === 'wifi') {
          if (CarLauncher.setWifi) await CarLauncher.setWifi(opts);
          else                     await CarLauncher.openWifiSettings?.();
        } else {
          if (CarLauncher.setBluetooth) await CarLauncher.setBluetooth(opts);
          else                          await CarLauncher.openBluetoothSettings?.();
        }
      } catch { /* fail-soft */ }
    })();
    /* Native köprü sonuç DÖNDÜRMÜYOR → "uygulandı" DENEMEZ (sahte-ACK yasağı). */
    return { kind: 'DELIVERED', key };
  }

  const update  = useStore.getState().updateSettings;
  const s        = useStore.getState().settings as unknown as Record<string, unknown>;
  const effKind  = kind ?? getVoiceSetting(key)?.kind;

  if (effKind === 'openTab') { openSettings(); return { kind: 'SURFACE_OPENED', key }; }

  if (effKind === 'enum') {
    if (!value) return { kind: 'REJECTED', key, reason: 'no_value' };
    update({ [key]: value } as unknown as Partial<AppSettings>);
    return _readBackSetting(key) === value
      ? { kind: 'APPLIED', key }
      : { kind: 'REJECTED', key, reason: 'readback_mismatch' };
  }

  if (effKind === 'number') {
    const cur = Number(s[key] ?? 0);
    let next = cur;
    if (action === 'set' && value)      next = parseInt(value, 10);
    else if (action === 'inc')          next = cur + _SETTING_STEP;
    else if (action === 'dec')          next = cur - _SETTING_STEP;
    next = Math.max(0, Math.min(100, Number.isFinite(next) ? next : cur));
    update({ [key]: next } as unknown as Partial<AppSettings>);
    if (key === 'brightness' && isNative) {
      void CarLauncher.setBrightness({ value: Math.round((next / 100) * 255) })
        ?.catch?.(() => { /* fail-soft */ });
    }
    return Number(_readBackSetting(key)) === next
      ? { kind: 'APPLIED', key }
      : { kind: 'REJECTED', key, reason: 'readback_mismatch' };
  }

  // bool (varsayılan) — on/off/toggle
  const curBool  = Boolean(s[key]);
  const nextBool = action === 'toggle' ? !curBool : action === 'on';
  update({ [key]: nextBool } as unknown as Partial<AppSettings>);
  return Boolean(_readBackSetting(key)) === nextBool
    ? { kind: 'APPLIED', key }
    : { kind: 'REJECTED', key, reason: 'readback_mismatch' };
}

// Android paket adından store'daki kaynak anahtarına eşleme
const PKG_TO_SOURCE_KEY: Record<string, string> = {
  'com.spotify.music':                     'spotify',
  'com.google.android.apps.youtube.music': 'youtube_music',
  'com.kapp.youtube.music':                'ymusic',
  'com.maxmpz.audioplayer':                'poweramp',
  'org.videolan.vlc':                      'vlc',
  'com.soundcloud.android':                'soundcloud',
  'com.amazon.music':                      'amazon',
  'com.deezer.android.app':                'deezer',
  'com.tidal.android':                     'tidal',
};

// Android paketinden carosMediaLayer arama filtresine eşleme (kaynak tercihi).
// Eşleşmeyen paketler → 'all' (kaynak fark etmez). Spotify bağlı değilse playByQuery
// otomatik 'all'a düşer; ana Türkçe kaynak YouTube (Piped) zaten 'all' içinde.
const PKG_TO_CAROS_FILTER: Record<string, string> = {
  'com.spotify.music':                     'spotify',
  'com.google.android.apps.youtube.music': 'youtube',
  'com.google.android.youtube':            'youtube',
  'com.kapp.youtube.music':                'youtube',
};

// Kaynak anahtarından Android paket adına eşleme
const SOURCE_KEY_TO_PKG: Record<string, string> = {
  'spotify':       'com.spotify.music',
  'youtube_music': 'com.google.android.apps.youtube.music',
  'ymusic':        'com.kapp.youtube.music',
  'poweramp':      'com.maxmpz.audioplayer',
  'vlc':           'org.videolan.vlc',
  'soundcloud':    'com.soundcloud.android',
  'amazon':        'com.amazon.music',
  'deezer':        'com.deezer.android.app',
  'tidal':         'com.tidal.android',
};

// Kaynak anahtarından arama URI oluşturucu
const SOURCE_KEY_TO_SEARCH_URI: Record<string, (q: string) => string> = {
  'spotify':       (q) => `spotify:search:${encodeURIComponent(q)}`,
  'youtube_music': (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
  'ymusic':        (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
  'soundcloud':    (q) => `https://soundcloud.com/search?q=${encodeURIComponent(q)}`,
  'deezer':        (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}`,
  'tidal':         (q) => `tidal://search?q=${encodeURIComponent(q)}`,
};

// Kaynak görünen adları — "yüklü değil" mesajı için
const SOURCE_KEY_TO_NAME: Record<string, string> = {
  'spotify':       'Spotify',
  'youtube_music': 'YouTube Music',
  'ymusic':        'YMusic',
  'poweramp':      'Poweramp',
  'vlc':           'VLC',
  'soundcloud':    'SoundCloud',
  'amazon':        'Amazon Müzik',
  'deezer':        'Deezer',
  'tidal':         'Tidal',
};

// Yüklü paket önbelleği — her 60 saniyede yenilenir
let _installedPkgCache: Set<string> | null = null;
let _installedPkgCacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function _isInstalled(pkg: string): Promise<boolean> {
  if (!pkg || !isNative) return true; // web modda kontrol yok
  const now = Date.now();
  if (!_installedPkgCache || now - _installedPkgCacheAt > CACHE_TTL_MS) {
    try {
      const { apps } = await CarLauncher.getApps();
      _installedPkgCache = new Set(apps.map((a) => a.packageName));
      _installedPkgCacheAt = now;
    } catch {
      return true; // hata → launchApp zaten toast gösterir
    }
  }
  return _installedPkgCache.has(pkg);
}

/**
 * MAVI-M6: `CarLauncher.speak` DOĞRUDAN BYPASS'I KALDIRILDI.
 *
 * Eskiden bu fonksiyon `ttsService`i tamamen atlayarak native'e konuşuyordu →
 * dedupe · ducking · cancel · `__SAFETY_LOCK__` korumalarının HİÇBİRİ uygulanmıyor,
 * ayrıca dispatch'in söylediği "X aranıyor" ile ÜST ÜSTE biniyordu (M1 bulgu #4).
 * Artık TEK otoriteden geçer: müzik sonucu turun NİHAİ cevabıdır (`answer`), parser
 * metni ise 'progress' katmanında kaldığı için slot boştur → tek ses duyulur.
 * Toast (görsel) DEĞİŞMEDİ.
 */
function _speakAndToast(msg: string): void {
  showToast({ type: 'info', title: 'Müzik', message: msg, duration: 4000 });
  speakMaviAnswer(msg);
}

import { resolveAndNavigate } from '../platform/addressNavigationEngine';
import { dispatchNearbyPoiNavigation } from '../platform/nearbyPoiNavigation';
import { getGPSState } from '../platform/gpsService';
import type { ParsedCommand } from '../platform/commandParser';
import type { SmartSnapshot } from '../platform/smartEngine';
import type { DrawerType } from '../components/layout/DockBar';
import { executeAIResult } from '../platform/commandExecutor';

interface UseVoiceCommandHandlerParams {
  settings: AppSettings;
  smart: SmartSnapshot;
  handleLaunch: (id: string) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;
  setDrawer: (drawer: DrawerType) => void;
  openWeather?: () => void;
}

export function useVoiceCommandHandler({
  settings,
  smart,
  handleLaunch,
  updateSettings,
  setDrawer,
  openWeather,
}: UseVoiceCommandHandlerParams): void {
  const voiceCtxRef = useRef({ settings, smart, handleLaunch, updateSettings, setDrawer, openWeather });
  useEffect(() => { voiceCtxRef.current = { settings, smart, handleLaunch, updateSettings, setDrawer, openWeather }; });

  useEffect(() => {
    return registerAIResultHandler((aiResult, vehicleCtx) => {
      const { settings: s, handleLaunch: launch, setDrawer: open, openWeather: showWeather } = voiceCtxRef.current;
      void reportVoiceDiag('voice_command_execute', { command: aiResult.intent });
      /* Tur KOMUT GİRİŞİNDE yakalanır — geç cevap kapısı için (yerel yolla aynı). */
      const _aiTurn = getActiveMaviTurn();
      return executeAIResult(aiResult, {
        // MAVI-M2: sabit `{ speedKmh: 0, isDriving: false }` PARK VARSAYIMI KALDIRILDI.
        // O varsayım "veri yok"u "araç duruyor" sayıyordu → riskli eylem kapıları
        // fail-open çalışıyordu (M1 bulgu #1). Bağlam voiceService'te komut başına
        // çözülür; buraya ulaşmadığı istisnai durumda DÜRÜST bilinmeyen bağlam
        // kullanılır (`motionState:'unknown'` → kapılar fail-closed kalır).
        vehicleCtx: vehicleCtx ?? unknownMaviVehicleContext(),
        defaultNav:   s.defaultNav as 'maps' | 'waze' | 'yandex',
        defaultMusic: s.defaultMusic,
        launch,
        setTheme:    applyVoiceTheme,
        cycleTheme:  cycleVoiceTheme,   // AI yolu da tema döngüsünü işlesin (yoksa "Komut Hatası")
        openDrawer:  (t) => open(t as DrawerType),
        applySetting: (key, action, value, kind) =>
          applyVoiceSetting(key, action, value, kind, () => open('settings' as DrawerType)),
        openWeather: showWeather,
        // Uygulama-içi navigasyon — offline routeIntent yolu ile aynı. AI yolunun
        // (Gemini) "rota oluştur" komutunu harici Google Maps'e değil kendi
        // haritamıza yönlendirir.
        navigateToPlace: (query: string) => {
          const gps = getGPSState().location;
          resolveAndNavigate(query, gps ? { lat: gps.latitude, lng: gps.longitude } : undefined);
        },
        // NAVIGATION-P1-1: AI/Mavi beyin hattı da hastane ile AYNI merkezi "en yakın X"
        // dispatch'ine bağlanır (GPS fail-closed + dedupe + bounded TTS).
        dispatchNearbyPoi: (cat) => {
          const gps = getGPSState().location;
          dispatchNearbyPoiNavigation(cat, gps ? { lat: gps.latitude, lng: gps.longitude } : undefined);
        },
        /* İLK çağrıda onay YOKTUR — beynin komutu anlaması ONAY DEĞİLDİR.
         * Onaylı yürütme yalnız `setConfirmedActionExecutor` yolundan geçer
         * (yerel parser yoluyla birebir aynı sözleşme). */
        actionConfirmed: false,
      }).then((outcome) => {
        /* SAHA BULGUSU (2026-07-31): burası eskiden BOŞTU — sonuç atılıyordu.
         * `OPEN_PHONE` onay gerektirdiği için kapı `needs_confirmation` dönüyor,
         * kimse bunu görmediği için ne soru soruluyor ne bekleyen eylem kuruluyordu
         * → "annemi ara" hiç aramıyordu. Yerel yolun deseni buraya taşındı. */
        if (!outcome) return;
        const { intent, result } = outcome;

        if (result.status === 'needs_confirmation' && isVehicleEffectiveIntent(intent.type)) {
          const def = getVehicleActionDef(intent.type);
          const t = getActiveMaviTurn();
          if (def && t) setPendingAction({ intent, actionId: def.actionId, turnId: t.id, atMs: Date.now() });
        }

        if (!continueIfTurnCurrent(_aiTurn, 'feedback')) return;
        const fb = buildIntentExecutionFeedback(result);
        if (fb && fb.message.trim()) {
          speakMaviAnswer(fb.message, { isDriving: vehicleCtx?.isDriving === true });
        }
      }).catch(() => {
        if (!continueIfTurnCurrent(_aiTurn, 'feedback')) return;
        speakMaviAnswer('İşlemin sonucunu doğrulayamadım.');
      });
    });
  }, []);

  /* MAVI-M4: ONAYLI eylem yürütücüsü. `voiceService` "evet" duyduğunda bunu çağırır;
   * eylem TEK OTORİTEDEN (`executeIntent`) ve `actionConfirmed:true` ile geçer —
   * kapı sırası (hareket · AiSafetyGate · capability) yine uygulanır. Cevap M6 tek
   * zarfından çıkar. Kayıt/sökme bu effect'in yaşam döngüsüne bağlıdır (zero-leak). */
  useEffect(() => {
    setConfirmedActionExecutor((intent) => {
      const { settings: s, handleLaunch: launch, setDrawer: open } = voiceCtxRef.current;
      const turn = getActiveMaviTurn();
      /* Bağlam ONAY ANINDA yeniden çözülür (kayıt anında DEĞİL): kullanıcı
       * "evet" derken araç hareket ediyor olabilir. Çözüm başarısızsa DÜRÜST
       * bilinmeyen bağlam → hareket kapıları fail-closed kalır. */
      let confirmedCtx: VehicleContext;
      try { confirmedCtx = currentMaviVehicleContext(); }
      catch { confirmedCtx = unknownMaviVehicleContext(); }
      void executeIntent(intent, {
        vehicleCtx: confirmedCtx,
        defaultNav:   s.defaultNav as 'maps' | 'waze' | 'yandex',
        defaultMusic: s.defaultMusic,
        launch,
        openDrawer: (t) => open(t as DrawerType),
        ..._vehiclePorts(),
        /* Onaylı yürütme kendi turunda başlar (kullanıcı "evet" dedi) → o turun
         * token'ı taşınır; onay sonrası araya yeni komut girerse geç metin susar. */
        turn,
        actionConfirmed: true,
      }).then((result) => {
        if (!continueIfTurnCurrent(turn, 'feedback')) return;
        const fb = buildIntentExecutionFeedback(result);
        if (fb && fb.message.trim()) speakMaviAnswer(fb.message);
      }).catch(() => {
        if (!continueIfTurnCurrent(turn, 'feedback')) return;
        speakMaviAnswer('İşlemin sonucunu doğrulayamadım.');
      });
    });
    return () => { setConfirmedActionExecutor(null); };
  }, []);

  useEffect(() => {
    // PR-DIAG-2 · ÜRETİCİ #5 (guard sayacı): kayıt/sökme MEVCUT useEffect yaşam döngüsüne bağlıdır
    // — yeni abonelik/timer YOK. Sızıntı olursa sayaç 1'i aşar ve rapor bunu gösterir.
    try { adjustRegistration('guard', 1); } catch { /* fail-soft */ }
    const _unregister = registerCommandHandler((cmd: ParsedCommand, vehicleCtx?: VehicleContext) => {
      // ── MAVİ TAKEOVER GUARD (Faz-3 · MAVI3-4c) ──────────────────────────
      // Aynı istekte iki hattın birden çalışmasını engelleyen TEK karar noktası. Cevap senkron ve
      // SIRA-BAĞIMSIZDIR: bu handler'ın Mavi köprüsünden önce mi sonra mı çağrıldığı sonucu
      // değiştirmez. FAIL-OPEN: wiring yoksa, bayrak kapalıysa (varsayılan), anahtar geçersizse
      // veya hakem hata atarsa `false` döner → eski hat bugünkü gibi çalışır. Hakem allowlist'i
      // yalnız `media.next` içerdiğinden guard pratikte SADECE o komutta etkilidir; diğer tüm
      // komutlar bu satırdan etkilenmeden akar.
      if (isCommandOwnedByMavi(cmd)) return;

      /* MAVI-M5: bu handler `dispatch()` içinden SENKRON çağrılır → yakalanan token
       * bu komutun TA KENDİSİNİN turudur. Aşağıdaki async `routeIntent` sonucu geç
       * dönerse bu token ile güncellik sorulur (yeni komut geldiyse SESSİZCE düşer). */
      const _turn = getActiveMaviTurn();

      // PR-DIAG-2 · ÜRETİCİ #4: guard'ın GEÇİRDİĞİ komut = eski hattın gerçek yürütmesi.
      // Anahtar, Mavi'nin kullandığı AYNI saf builder'dan gelir → iki taraf aynı correlationId'yi
      // yazar ve rapor sonradan birleştirilebilir. Kayıt fail-soft; komut akışını ASLA etkilemez.
      try {
        const _k = resolveOwnershipKey(cmd);
        recordLegacyExecution({
          generationId: _k?.generationId ?? -1,
          sessionId:    _k?.sessionId ?? -1,
          commandId:    _k?.commandId ?? cmd.type,
          resolvedAction: _k?.actionId ?? null,
          atMs: Date.now(),
        });
      } catch { /* fail-soft */ }

      const { settings: s, smart: sm, handleLaunch: launch, updateSettings: update, setDrawer: open, openWeather: showWeather } = voiceCtxRef.current;
      void reportVoiceDiag('voice_command_execute', { command: cmd.type });
      if (cmd.type === 'toggle_sleep_mode') { update({ sleepMode: !s.sleepMode }); return; }

      // "En yakın hastane" — NAVIGATION-P0-2: merkezi dispatchNearbyPoiNavigation'a
      // delege edilir (GPS fail-closed + dedupe + bounded TTS için — bkz.
      // nearbyPoiNavigation.ts).
      if (cmd.type === 'find_nearby_hospital') {
        const gps = getGPSState().location;
        dispatchNearbyPoiNavigation(
          'hospital',
          gps ? { lat: gps.latitude, lng: gps.longitude } : undefined,
        );
        return;
      }

      // "En yakın benzinlik" — NAVIGATION-P1-1: eskiden bu blok navigate_address/place/
      // parking ile birlikte doğrudan resolveAndNavigate('__nearby_gas__', gps) çağırırdı
      // (GPS fail-closed/dedupe/bounded-TTS YOKTU). Artık hastane ile AYNI merkezi hatta
      // (dispatchNearbyPoiNavigation) taşındı — fuel katalog girişi zaten tam tanımlıydı,
      // yalnız çağrı yeri eksikti.
      if (cmd.type === 'find_nearby_gas') {
        const gps = getGPSState().location;
        dispatchNearbyPoiNavigation(
          'fuel',
          gps ? { lat: gps.latitude, lng: gps.longitude } : undefined,
        );
        return;
      }

      // "En yakın otopark" — NAVIGATION-P1-2: fuel ile AYNI desen. Eskiden bu blok
      // navigate_address/place ile birlikte doğrudan resolveAndNavigate('__nearby_parking__',
      // gps) çağırırdı (GPS fail-closed/dedupe/bounded-TTS YOKTU). Artık fuel/hastane ile
      // AYNI merkezi hatta (dispatchNearbyPoiNavigation) taşındı.
      if (cmd.type === 'find_nearby_parking') {
        const gps = getGPSState().location;
        dispatchNearbyPoiNavigation(
          'parking',
          gps ? { lat: gps.latitude, lng: gps.longitude } : undefined,
        );
        return;
      }

      // Serbest adres navigasyonu — intentEngine'e geçmeden burada çözülür.
      //
      // ⚠️ BU BLOK MAVİ SAHİPLİĞİNDE ZATEN ULAŞILAMAZ: yukarıdaki tek karar noktası
      // (`isCommandOwnedByMavi` → erken return) bu satırlardan ÖNCE çalışır. Yani
      // aynı komut için iki hat birden resolveAndNavigate ÇAĞIRAMAZ. Mavi bu komutu
      // sahiplenmediğinde (bugünkü durum — `navigation.open` takeover-eligible DEĞİL)
      // eski hat çalışmaya devam eder; bu bilinçli fail-open davranıştır.
      if (
        cmd.type === 'navigate_address' ||
        cmd.type === 'navigate_place'
      ) {
        // FAIL-CLOSED (yeni): hedef boşsa navigasyon BAŞLATILMAZ.
        // KÖK: `cmd.extra.destination` yoksa `cmd.raw`a düşülüyordu; ikisi de boş/boşluk
        // olduğunda `resolveAndNavigate('')` çağrılıyordu. O fonksiyonun kendi boş-hedef
        // koruması YOKTUR (addressNavigationEngine.ts) — boş sorguyla 'searching' durumu
        // yayınlanıp anlamsız arama başlıyordu. Hedefi olmayan komut, hedefi olmayan
        // navigasyondur: sessizce düşmek yerine hiç başlatılmaz.
        const rawDest = cmd.extra?.destination ?? cmd.raw;
        const dest = typeof rawDest === 'string' ? rawDest.trim() : '';
        if (!dest) {
          void reportVoiceDiag('voice_command_execute', { command: cmd.type, errorCode: 'empty_destination' });
          return;
        }
        const gps  = getGPSState().location;
        resolveAndNavigate(
          dest,
          gps ? { lat: gps.latitude, lng: gps.longitude } : undefined,
        );
        return;
      }
      // activeMediaSourceKey geçerli bir MusicOptionKey ise defaultMusic'e öncelik tanır.
      const _activeKey = s.activeMediaSourceKey;
      const effectiveMusic: MusicOptionKey = (_activeKey && _MUSIC_KEY_SET.has(_activeKey))
        ? (_activeKey as MusicOptionKey)
        : s.defaultMusic;

      const intent = toIntent(cmd, {
        defaultNav: s.defaultNav, defaultMusic: effectiveMusic,
        recentAppId: sm.quickActions.find((a) => a.id.startsWith('last-'))?.appId,
      });
      /* ── MAVI-M4 · TEK EYLEM OTORİTESİ YÖNLENDİRMESİ ─────────────────────
       * ARAÇ ETKİLİ intentler (donanım · DTC · sensör · telefon araması) ARTIK
       * `routeIntent`e HİÇ GİTMEZ — doğrudan tek otoriteye (`executeIntent` →
       * `dispatchIntent`) verilir. Orada kapı sırası: hareket politikası (M2) →
       * AiSafetyGate → açık onay → capability, hepsi port/native/OBD çağrısından
       * ÖNCE. `routeIntent` yalnız düşük riskli UI/medya/navigasyon intentlerinde
       * kalır (araç etkili portları RouterContext'te ARTIK YOK).
       * Her iki yol da AYNI `IntentExecutionResult` sözleşmesini döndürür → M6
       * tek cevap zarfı ve M5 tur kapısı değişmeden çalışır.
       *
       * MUSIC F14: müzik tipleri (`_MUSIC_INTENT_TYPES`) de BURADAN
       * `executeIntent`e yönlendirilir — AI/beyin yolunun (`executeAIResult`)
       * ZATEN kullandığı AYNI `dispatchIntent` otoritesi. Tek amaç aynı komutun
       * girişe göre FARKLI (ve F13/F9'dan KOPUK) davranmasını engellemek. */
      const _run: Promise<IntentExecutionResult> = (isVehicleEffectiveIntent(intent.type)
        || _MUSIC_INTENT_TYPES.has(intent.type))
        ? executeIntent(intent, {
            vehicleCtx: vehicleCtx ?? unknownMaviVehicleContext(),
            defaultNav:   s.defaultNav as 'maps' | 'waze' | 'yandex',
            defaultMusic: s.defaultMusic,
            launch,
            openDrawer: (t) => open(t as DrawerType),
            ..._vehiclePorts(),
            /* MAVI-M6-LATE-SPEECH-GATE: bu komutun TA KENDİSİNİN turu (yukarıda
             * senkron yakalandı). `dispatchIntent` içindeki await sonrası
             * konuşmalar bununla korunur. */
            turn: _turn,
            // İLK çağrıda onay YOKTUR — parser eşleşmesi ONAY DEĞİLDİR. Onaylı
            // yürütme yalnız `setConfirmedActionExecutor` yolundan geçer.
            actionConfirmed: false,
          })
        : routeIntent(intent, {
        launch,
        openDrawer:  (t) => open(t as DrawerType),
        setTheme:    applyVoiceTheme,
        cycleTheme:  cycleVoiceTheme,
        applySetting: (key, action, value, kind) =>
          applyVoiceSetting(key, action, value, kind, () => open('settings' as DrawerType)),
        // Medya komutları oynatmayı YÖNETİR → asistan ducking-resume'unu iptal et
        // (yoksa mikrofon ducking müziği duraklatıp idle'da geri başlatarak "durdur"u
        // eziyordu). cancelAssistantDuck idempotent; alakasız komutlarda çağrılmaz.
        playMedia:   () => { cancelAssistantDuck(); play(); },
        // "müziği durdur" → çalıyorsa togglePlayPause ile duraklat (UI ile aynı yol;
        // in-app YouTube/stream'i web'de de doğru yönlendirir). Ducking zaten
        // duraklattıysa toggle no-op olur; cancelAssistantDuck duraklamayı kalıcı kılar.
        pauseMedia:  () => { cancelAssistantDuck(); if (getMediaState().playing) togglePlayPause(); },
        nextTrack:   () => { cancelAssistantDuck(); next(); },        // carosMediaLayer (kuyruk-farkında)
        prevTrack:   () => { cancelAssistantDuck(); previous(); },    // carosMediaLayer (kuyruk-farkında)
        // "video moduna al" → müzik ekranını aç + tam ekran video modunu aç.
        // Yalnız YouTube çalarken görsel etki olur (aksi halde zararsız no-op).
        /* MUSIC F7.2: niyet KAYDEDİLİR (ekran açılır, mod işaretlenir) ama
           duruş kanıtlanmadan görüntü AÇILMAZ. Kullanıcı neden görmediğini
           öğrenir — "açtım" deyip hiçbir şey olmaması yasak. */
        /* SAHA BUGFIX (2026-09-03) · ÜRÜN KARARI DEĞİŞTİ: hız/hareket video
         * açma isteğini REDDEDEMEZ ve "gizlendi" diye bir gerekçe artık
         * doğru değildir — video her durumda AÇILIR. Eskiden burada
         * `decideVideoVisibility`/`videoBlockReason` ile "video gizlendi"
         * toast'ı gösteriliyordu; bu artık YALAN olurdu (video gerçekten
         * gösterilirken "gizlendi" denirdi) → kaldırıldı. */
        setVideoMode: (on) => {
          open('music' as DrawerType);
          applyVideoMode(on);
        },
        volumeUp:         () => update({ volume: Math.min(100, useStore.getState().settings.volume + 10) }),
        volumeDown:       () => update({ volume: Math.max(0,   useStore.getState().settings.volume - 10) }),
        openWeather:      showWeather,
        navigateToPlace: (query) => {
          const gps = getGPSState().location;
          resolveAndNavigate(query, gps ? { lat: gps.latitude, lng: gps.longitude } : undefined);
        },
        // NAVIGATION-P1-1: yerel commandParser→intentEngine.routeIntent hattı da
        // AYNI merkezi "en yakın X" dispatch'ine bağlanır.
        dispatchNearbyPoi: (cat) => {
          const gps = getGPSState().location;
          dispatchNearbyPoiNavigation(cat, gps ? { lat: gps.latitude, lng: gps.longitude } : undefined);
        },
        playMusicSearch: (appKey, query) => {
          // Şarkı/sanatçı adı → KAYNAK FARK ETMEKSİZİN uygulama içinde çal.
          void (async () => {
            const { playByQuery } = await import('../platform/media/carosMediaLayer');
            const filter = (appKey === 'spotify' || appKey === 'youtube') ? appKey : 'all';
            const played = await playByQuery(query, filter);
            if (played) {
              open('music' as DrawerType);
              void _speakAndToast(`${played.title}${played.subtitle ? ' — ' + played.subtitle : ''} çalınıyor`);
            } else {
              void _speakAndToast(`"${query}" bulunamadı`);
            }
          })();
        },

        playMusicQuery: (pkg, searchUri, _queryType, fallbackKey, query) => {
          // Yüklü olup olmadığını async kontrol et, sonuç gelince işlem yap
          void (async () => {
            // ── 0. Şarkı/sanatçı adı verildi → KAYNAK FARK ETMEKSİZİN uygulama içinde çal ──
            //    Sesli asistan birincil davranışı: harici uygulamaya gitmeden, en iyi eşleşmeyi çal.
            const q = (query ?? '').trim();
            if (q.length >= 2) {
              const { playByQuery } = await import('../platform/media/carosMediaLayer');
              const filter = pkg ? (PKG_TO_CAROS_FILTER[pkg] ?? 'all') : 'all';
              const played = await playByQuery(q, filter);
              if (played) {
                open('music' as DrawerType);
                void _speakAndToast(`${played.title}${played.subtitle ? ' — ' + played.subtitle : ''} çalınıyor`);
              } else {
                void _speakAndToast(`"${q}" bulunamadı`);
              }
              return;
            }

            // ── 1. Belirli bir kaynak (pkg) istendi ──────────────────────
            if (pkg) {
              const installed = await _isInstalled(pkg);
              if (!installed) {
                // Kaynak adını bul ve sesli + görsel bildir
                const sourceKey = PKG_TO_SOURCE_KEY[pkg];
                const name = sourceKey ? (SOURCE_KEY_TO_NAME[sourceKey] ?? sourceKey) : pkg;
                void _speakAndToast(`${name} bu cihazda yüklü değil`);
                return;
              }
              // Kuruluysa: kaynak güncelle
              setMediaPreferredPackage(pkg);
              const sourceKey = PKG_TO_SOURCE_KEY[pkg];
              if (sourceKey) update({ activeMediaSourceKey: sourceKey });
            }

            // ── 2. searchUri varsa → uygulamayı aç ve aramasını yap ─────
            if (searchUri) {
              bridge.launchMusicQuery(pkg, searchUri, fallbackKey);
              return;
            }

            // ── 3. searchUri yok ama query var → aktif kaynakta ara ─────
            if (query) {
              // Hangi kaynağı kullanacağız?
              const activeKey = s.activeMediaSourceKey || fallbackKey || 'spotify';
              const activePkg = pkg || SOURCE_KEY_TO_PKG[activeKey] || '';
              const uriGen    = SOURCE_KEY_TO_SEARCH_URI[activeKey];

              if (activePkg && uriGen) {
                // Aktif kaynak kurulu mu kontrol et
                const installed = pkg ? true : await _isInstalled(activePkg);
                if (!installed) {
                  const name = SOURCE_KEY_TO_NAME[activeKey] ?? activeKey;
                  void _speakAndToast(`${name} bu cihazda yüklü değil`);
                  return;
                }
                const uri = uriGen(query);
                bridge.launchMusicQuery(activePkg, uri, fallbackKey);
              } else {
                // Son çare: basit arama
                bridge.launchMusicSearch(fallbackKey as MusicOptionKey, query);
              }
              return;
            }

            // ── 4. Ne searchUri ne query → sadece kaynak söylendi ───────
            // Ön plana almadan arka planda çal
            play();
          })();
        },

        addMusicFavorite: () => {
          const media = getMediaState();
          const { addMusicFavorite } = useStore.getState();
          if (!media.hasSession || !media.track.title) {
            showToast({ type: 'info', title: 'Çalan şarkı yok', message: 'Favorilere eklemek için önce bir şarkı çalmalı', duration: 3000 });
            return;
          }
          const fav: MusicFavorite = {
            title:    media.track.title,
            artist:   media.track.artist,
            albumArt: media.track.albumArt,
            source:   media.source,
            addedAt:  Date.now(),
          };
          addMusicFavorite(fav);
          showToast({ type: 'success', title: 'Favorilere eklendi', message: `${media.track.title} — ${media.track.artist}`, duration: 3000 });
        },
      });

      /* MAVI-F13: sonuç zinciri ARTIK ÇAĞIRANA DÖNER (eskiden `void` ile
       * atılıyordu). Tek amaç: kanonik bileşik plan adımı yürütmenin gerçekten
       * bitmesini bekleyip GÖZLEMİ okuyabilsin. `dispatch`/`dispatchDriving`
       * dönüşü bugünkü gibi yok sayar → tekil komut davranışı BİREBİR aynıdır. */
      return _run.then((result) => {
        /* MAVI-M4: onay isteniyorsa eylemi BEKLET (yürütme YAPILMADI). Bir sonraki
         * turda kullanıcı "evet" derse `voiceService` kayıtlı yürütücüyü çağırır;
         * "hayır"da slot temizlenir ve HİÇBİR yan etki oluşmaz. */
        if (result.status === 'needs_confirmation' && isVehicleEffectiveIntent(intent.type)) {
          const def = getVehicleActionDef(intent.type);
          const t = getActiveMaviTurn();
          if (def && t) setPendingAction({ intent, actionId: def.actionId, turnId: t.id, atMs: Date.now() });
        }
        /* MAVI-M5 · KAPI F + M6 DÜZELTMESİ: bu sonuç turun KENDİ geç cevabıdır ve
         * `completeMaviTurn`ten SONRA çözülür. `continueIfTurnActive` kullanılırsa
         * M3'ün dürüst ACK'i ("… bağlantısı henüz hazır değil") ÜRETİMDE HİÇ
         * DUYULMAZDI. Susturulması gereken DEVRALINMA'dır → `continueIfTurnCurrent`. */
        if (!continueIfTurnCurrent(_turn, 'feedback')) return;
        // TEK zarf · TEK ses (otorite tur başına tek `answer` geçirir).
        const fb = buildIntentExecutionFeedback(result);
        if (fb && fb.message.trim()) speakMaviAnswer(fb.message, { isDriving: vehicleCtx?.isDriving === true });
      }).catch(() => {
        // Yürütme zinciri throw etti → BAŞARI İDDİA EDİLMEZ, dürüstçe bilinmiyor denir.
        if (!continueIfTurnCurrent(_turn, 'feedback')) return;
        if (isResultAckCommand(cmd.type)) speakMaviAnswer('İşlemin sonucunu doğrulayamadım.');
      });

    });
    return () => {
      try { adjustRegistration('guard', -1); } catch { /* fail-soft */ }
      _unregister();
    };
  }, []);
}
