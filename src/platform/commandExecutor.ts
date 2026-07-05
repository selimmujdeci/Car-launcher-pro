/**
 * Command Executor — AI intent → native service dispatch merkezi.
 *
 * Akış:
 *   AIVoiceResult → executeAIResult() → dispatchIntent() → bridge / mediaService / …
 *   AppIntent     → executeIntent()  → dispatchIntent()
 *   AppIntent[]   → executeSequence() → paralel dispatchIntent()
 *
 * 8-Kelime TTS Kuralı (ISO 15008 / NHTSA §3.4):
 *   Araç hareket halindeyken (isDriving=true) tüm sesli geri bildirimler
 *   ≤ 8 kelimeye kısaltılır. Bu kural sürücü dikkatini korur.
 */

import { bridge, type CommandResult }   from './bridge';
import { fromAIResponse, type AppIntent } from './intentEngine';
import type { AIVoiceResult, VehicleContext } from './aiVoiceService';
import { play, pause, next, previous, setMediaPreferredPackage } from './mediaService';
import { setVolume }                    from './systemSettingsService';
import { speakFeedback, speakAlert } from './ttsService';
import { showToast }                    from './errorBus';
import type { NavOptionKey, MusicOptionKey } from '../data/apps';
import { readDTCCodes, clearDTCCodes, onDTCState, type DTCState } from './dtcService';
import { querySensor } from './obd/sensorQueryService';
import { getMaintenanceSummaryText } from './vehicleMaintenanceService';
import { openInApp } from './inAppBrowser';
import { applyLiveStyle } from './liveStyleEngine';
import { getWeatherNarrative } from './weatherService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { resolveAppByName } from './appRegistry';
import { resolveScreen } from './screenRegistry';
import { searchContacts, recordCall } from './contactsService';
import { addFact, forgetFact } from './companion/companionMemory';

/* ── Volume state ─────────────────────────────────────────── */

// Module-level volume tracker (0-100). Initial mid-level default.
let _currentVolume = 60;

/* ── Intent tracking (BlackBoxService için) ────────────────── */

let _lastIntent: string | undefined;

/** Son tetiklenen intent type'ını döner. BlackBoxService tarafından okunur. */
export function getLastIntent(): string | undefined { return _lastIntent; }

/* ── Public context ───────────────────────────────────────── */

export interface CommandContext {
  vehicleCtx:   VehicleContext;
  defaultNav:   NavOptionKey;
  defaultMusic: MusicOptionKey;
  recentAppId?: string;
  /** Resolve appId → actual app launch (has access to appMap in caller) */
  launch:       (appId: string) => void;
  setTheme?:    (theme: 'night' | 'day' | 'oled' | 'dark') => void;
  /** Temalar arası döngü ("temayı değiştir"/"başka tema") — routeIntent ile aynı yol. */
  cycleTheme?:  () => void;
  /** Sesli ayar kontrolü — key/action/value ile AppSettings (veya wifi/bt/brightness). */
  applySetting?: (key: string, action: string, value?: string, kind?: string, label?: string) => void;
  openDrawer?:  (target: 'apps' | 'settings' | 'music' | 'none') => void;
  openWeather?: () => void;
  /** Uygulama-içi serbest adres/yer navigasyonu (resolveAndNavigate wrapper'ı).
   *  intentEngine.routeIntent ile aynı yol → harici nav app'e gitmeden kendi haritamız. */
  navigateToPlace?: (query: string) => void;
  /** Araç kapı kilidi — CAN bus sinyali; L2 ACK onaylandığında resolve eder */
  hwLockDoors?:   () => Promise<CommandResult>;
  /** Araç kapı kilidi açma — güvenlik: sürüş sırasında engellenir; L2 ACK ile resolve */
  hwUnlockDoors?: () => Promise<CommandResult>;
  /** Kontak açık mı? (OBD PID 0x01) — remoteCommandService occupancy kontrolünde kullanılır */
  ignitionOn?: boolean;
  /** True ise komut Supabase kanalından geldi; false/undefined = lokal ses komutu */
  isRemote?: boolean;
}

/* ── Internal helpers ─────────────────────────────────────── */

/**
 * Araçta kullanıcı var mı? (Kontak açık VEYA hareket halinde)
 * Uzaktan gelen kritik komutlara (kapı/klima) karşı güvenlik bariyeri.
 */
function _isOccupied(ctx: CommandContext): boolean {
  return ctx.vehicleCtx.isDriving || (ctx.ignitionOn ?? false);
}

/** TTS ile geri bildirim. isDriving=true → ≤ 8 kelimeye kısalt. */
function _speak(text: string, isDriving: boolean): void {
  if (!isDriving) { speakFeedback(text); return; }
  const words = text.trim().split(/\s+/);
  speakFeedback(words.length > 8 ? words.slice(0, 8).join(' ') : text);
}

/** Hata durumunda TTS + toast. */
function _error(msg: string): void {
  speakAlert(msg);
  showToast({ type: 'error', title: 'Komut Hatası', message: msg, duration: 3000 });
}

/**
 * Sesli müzik araması — ÖNCE uygulama-içi gömülü oynatıcıda çal (YouTube IFrame /
 * Spotify / radyo / cihaz kütüphanesi); `playByQuery` tüm kaynaklarda arar.
 * Çalınabilir sonuç çıkmazsa harici uygulamaya (Play Store fallback'li deep-link)
 * düş. Dış uygulama SON ÇARE — sürücü uygulamadan uzaklaşmamalı.
 * SAHA FİX 2026-06-21: "X'ten müzik aç" gömülü oynatıcı yerine Play Store'a düşüyordu.
 */
async function _playMusicInAppOrFallback(
  query: string,
  ctx: CommandContext,
  isDriving: boolean,
  fallback: () => void,
): Promise<void> {
  try {
    // Lazy import: carosMediaLayer mediaService'i import ettiğinden statik döngüyü kır.
    const { playByQuery } = await import('./media/carosMediaLayer');
    const track = await playByQuery(query);
    if (track) {
      ctx.openDrawer?.('music');         // uygulama-içi çalma ekranını öne getir
      _speak(`${track.title} çalınıyor`, isDriving);
      return;
    }
  } catch { /* gömülü oynatıcı hatası → harici uygulamaya düş */ }
  fallback();                            // uygulama-içi sonuç yok → dış uygulama
}

/** Anlık DTC durumunu senkron olarak alır (onDTCState hemen çağırır). */
function _getDTCSnapshot(): DTCState {
  let snap!: DTCState;
  const unsub = onDTCState((s) => { snap = s; });
  unsub();
  return snap;
}

/**
 * DTC sonucunu ISO 15008 (≤ 8 kelime) kuralına uygun TTS metnine çevirir.
 * Sürücünün anlayacağı, güvenlik öncelikli dil kullanır.
 */
function _buildDTCSpeech(state: DTCState, isDriving: boolean): string {
  if (state.codes.length === 0) return 'Araç sistemleri temiz, sorun yok';

  const critical = state.codes.filter((c) => c.severity === 'critical');
  const warnings = state.codes.filter((c) => c.severity === 'warning');
  const count    = state.codes.length;

  if (isDriving) {
    if (critical.length > 0) return 'Kritik arıza var, hemen dur ve servisi ara';
    if (warnings.length > 0) return 'Araç uyarısı var, servis önerilir';
    return `${count} bilgi kodu tespit edildi`;
  }

  if (critical.length > 0) {
    const top = critical[0];
    return `Kritik arıza: ${top.description}. Hemen servise uğramanı öneririm.`;
  }
  if (warnings.length > 0) {
    const top = warnings[0];
    if (count > 1) return `${count} arıza bulundu. En önemlisi: ${top.description}. Müsait zamanda servise uğra.`;
    return `Uyarı: ${top.description}. Müsait zamanda servise uğramanı öneririm.`;
  }
  return `${count} bilgi kodu bulundu. Müsait zamanda servise uğrayabilirsin.`;
}

/* ── Core dispatcher ──────────────────────────────────────── */

async function dispatchIntent(intent: AppIntent, ctx: CommandContext): Promise<void> {
  const { isDriving } = ctx.vehicleCtx;

  // Kara kutu: her dispatch anında son intent'i kaydet
  _lastIntent = intent.type;

  try {
    switch (intent.type) {

      /* ── Navigasyon ─────────────────────────────────────────
         KENDİ HARİTAMIZ: ctx.launch(defaultNav) → handleLaunch navigation
         kategorisini yakalar → uygulama-içi FullMapView açar (harici Google
         Maps'e YÖNLENDİRME YOK). intentEngine.routeIntent ile birebir tutarlı —
         eskiden AI yolu bridge.launchNavigation ile harici app açıyordu (iki
         router ayrışması). navigateToPlace varsa hedefe uygulama-içi rota kurar. */
      case 'OPEN_NAVIGATION': {
        ctx.launch(ctx.defaultNav);
        _speak('Navigasyon başlatılıyor', isDriving);
        break;
      }
      case 'NAVIGATE_ADDRESS': {
        const dest = intent.payload.destination;
        if (dest && ctx.navigateToPlace) ctx.navigateToPlace(dest);
        else ctx.launch(ctx.defaultNav);
        _speak(dest ? `${dest} adresine gidiyoruz` : 'Navigasyon başlatılıyor', isDriving);
        break;
      }
      case 'NAVIGATE_PLACE': {
        const place = intent.payload.destination;
        if (place && ctx.navigateToPlace) ctx.navigateToPlace(place);
        else ctx.launch(ctx.defaultNav);
        _speak(place ? `${place} aranıyor` : 'Yer aranıyor', isDriving);
        break;
      }
      case 'SEARCH_POI': {
        // Mekan/POI araması (restoran, kafe, eczane...) — companion beyni bunu
        // üretir; routeIntent ile aynı yol. Eskiden dispatchIntent'te case YOKTU
        // → feedback söylenip "Komut Hatası" basıyordu (iki router ayrışması).
        const poiQuery = intent.payload.poiQuery;
        const query = poiQuery ? `yakın ${poiQuery}` : 'yakın yer';
        if (ctx.navigateToPlace) ctx.navigateToPlace(query);
        else ctx.launch(ctx.defaultNav);
        _speak(poiQuery ? `Yakın ${poiQuery} aranıyor` : 'Yakın yerler aranıyor', isDriving);
        break;
      }
      case 'FIND_NEARBY_GAS': {
        if (ctx.navigateToPlace) ctx.navigateToPlace('yakın benzinlik');
        else ctx.launch(ctx.defaultNav);
        _speak('Yakın benzinlik aranıyor', isDriving);
        break;
      }
      case 'FIND_NEARBY_PARKING': {
        if (ctx.navigateToPlace) ctx.navigateToPlace('yakın park yeri');
        else ctx.launch(ctx.defaultNav);
        _speak('Yakın park yeri aranıyor', isDriving);
        break;
      }

      /* ── Müzik ──────────────────────────────────────────── */
      // Genel "müzik aç": harici uygulamayı ÖN PLANA almadan arka planda çal ve
      // uygulama içi çalma ekranını (music drawer) göster. Kullanıcı uygulamadan
      // uzaklaşmaz. Yalnızca belirli bir şarkı/sanatçı araması (query/searchUri)
      // gerektiğinde harici uygulama deep-link ile açılır — arama UI'si şart.
      case 'OPEN_MUSIC': {
        const pkg = intent.payload.musicSourcePkg ?? '';
        if (pkg) setMediaPreferredPackage(pkg);
        play();                       // arka planda çal (sendMediaAction + warmup)
        ctx.openDrawer?.('music');    // çalma ekranını öne getir
        _speak('Müzik açılıyor', isDriving);
        break;
      }
      case 'PLAY_MUSIC_SEARCH': {
        const query = intent.payload.searchQuery ?? '';
        if (query) {
          // ÖNCE gömülü oynatıcı; çalınabilir sonuç yoksa harici uygulamaya düş.
          void _playMusicInAppOrFallback(query, ctx, isDriving, () => {
            bridge.launchMusicSearch(ctx.defaultMusic, query);
            _speak(`${query} aranıyor`, isDriving);
          });
        } else {
          play();
          ctx.openDrawer?.('music');
          _speak('Müzik açılıyor', isDriving);
        }
        break;
      }
      case 'PLAY_MUSIC_QUERY': {
        const pkg        = intent.payload.musicSourcePkg ?? '';
        const searchUri  = intent.payload.musicSearchUri ?? '';
        const query      = intent.payload.musicQuery ?? '';
        if (query) {
          // ÖNCE gömülü oynatıcı (kaynak adı dahil tüm sağlayıcılarda aranır);
          // sonuç yoksa harici uygulama deep-link'ine düş.
          // SAHA FİX 2026-06-12: NE DUYDUĞUNU söyle — ASR yanlış anladıysa
          // sürücü bunu yanlış şarkı çalmadan ÖNCE duyup düzeltebilir.
          void _playMusicInAppOrFallback(query, ctx, isDriving, () => {
            bridge.launchMusicQuery(pkg, searchUri, ctx.defaultMusic);
            _speak(`${query} aranıyor`, isDriving);
          });
        } else if (searchUri) {
          // Query metni yok, yalnız deep-link URI var → gömülüde arayamayız.
          bridge.launchMusicQuery(pkg, searchUri, ctx.defaultMusic);
          _speak('Müzik aranıyor', isDriving);
        } else {
          // Sadece kaynak söylendi → arka planda çal + ekranı göster
          if (pkg) setMediaPreferredPackage(pkg);
          play();
          ctx.openDrawer?.('music');
          _speak('Müzik açılıyor', isDriving);
        }
        break;
      }
      case 'ADD_MUSIC_FAVORITE': {
        _speak('Bu özellik şu an desteklenmiyor', isDriving);
        break;
      }
      case 'SET_MUSIC': {
        const appId = intent.payload.targetApp;
        if (appId) ctx.launch(appId);
        _speak('Müzik uygulaması açılıyor', isDriving);
        break;
      }

      /* ── Medya kontrolü ─────────────────────────────────── */
      case 'PLAY_MEDIA': {
        play();
        _speak('Devam ediyor', isDriving);
        break;
      }
      case 'PAUSE_MEDIA': {
        pause();
        _speak('Duraklatıldı', isDriving);
        break;
      }
      case 'MEDIA_NEXT': {
        next();
        _speak('Sonraki parça', isDriving);
        break;
      }
      case 'MEDIA_PREV': {
        previous();
        _speak('Önceki parça', isDriving);
        break;
      }

      /* ── Ses ────────────────────────────────────────────── */
      case 'VOLUME_UP': {
        _currentVolume = Math.min(100, _currentVolume + 10);
        setVolume(_currentVolume);
        _speak('Ses artırıldı', isDriving);
        break;
      }
      case 'VOLUME_DOWN': {
        _currentVolume = Math.max(0, _currentVolume - 10);
        setVolume(_currentVolume);
        _speak('Ses azaltıldı', isDriving);
        break;
      }

      /* ── Uygulama açma ──────────────────────────────────── */
      case 'OPEN_PHONE': {
        // Kişi adı verildiyse rehberde ara → en uygun numarayı çevir. Ad yoksa
        // telefon uygulamasını aç. Bulunamazsa SAHTE ONAY YOK — dürüstçe söyle.
        const contactName = (intent.payload.contactName ?? '').trim();
        if (contactName) {
          // 'frequent': aynı ada birden çok eşleşmede en sık aranan öne gelir.
          const contact = searchContacts(contactName, 'frequent')[0];
          const phone = contact?.phones.find((p) => p.label === 'mobile') ?? contact?.phones[0];
          if (contact && phone) {
            bridge.callNumber(phone.number);
            recordCall(contact.id);
            _speak(`${contact.name} aranıyor`, isDriving);
          } else {
            _speak(`${contactName} rehberde bulunamadı`, isDriving);
          }
          break;
        }
        ctx.launch(intent.payload.targetApp ?? 'phone');
        _speak('Telefon açılıyor', isDriving);
        break;
      }
      case 'OPEN_LAST_APP': {
        const appId = intent.payload.targetApp ?? ctx.recentAppId;
        if (appId) {
          ctx.launch(appId);
          _speak('Son uygulama açılıyor', isDriving);
        }
        break;
      }
      case 'OPEN_APP': {
        // Genel uygulama açma: beynin verdiği serbest adı yüklü uygulamaya çöz.
        // Bulunamazsa SAHTE ONAY YOK — dürüstçe "bulamadım" der (CLAUDE.md kuralı).
        const name = (intent.payload.appName ?? '').trim();
        const app  = name ? resolveAppByName(name) : null;
        if (app) {
          ctx.launch(app.id);
          _speak(`${app.name} açılıyor`, isDriving);
        } else {
          _speak(name ? `${name} uygulamasını bulamadım` : 'Hangi uygulamayı açayım?', isDriving);
        }
        break;
      }
      case 'OPEN_SCREEN': {
        // İç ekran/panel aç-kapat (trafik, klima, arıza kodları, Gemini QR…).
        // Bulunamazsa SAHTE ONAY YOK — dürüstçe söyler.
        const scr    = (intent.payload.screen ?? '').trim();
        const screen = scr ? resolveScreen(scr) : null;
        const closing = intent.payload.screenAction === 'close';
        if (screen) {
          if (closing) (screen.close ?? (() => {}))();
          else screen.open();
          _speak(`${screen.label} ${closing ? 'kapatılıyor' : 'açılıyor'}`, isDriving);
        } else {
          _speak(scr ? `${scr} ekranını bulamadım` : 'Hangi ekranı açayım?', isDriving);
        }
        break;
      }

      /* ── Sistem / UI ────────────────────────────────────── */
      case 'OPEN_SETTINGS': {
        ctx.openDrawer?.('settings');
        _speak('Ayarlar açılıyor', isDriving);
        break;
      }
      case 'OPEN_FAVORITES': {
        ctx.openDrawer?.('apps');
        _speak('Favoriler açılıyor', isDriving);
        break;
      }
      case 'ENABLE_NIGHT_MODE': {
        ctx.setTheme?.((intent.payload.mode as 'night' | 'day' | 'oled' | 'dark') ?? 'night');
        _speak('Gece modu aktif', isDriving);
        break;
      }
      case 'SET_THEME': {
        ctx.setTheme?.((intent.payload.mode as 'night' | 'day' | 'oled' | 'dark') ?? 'night');
        _speak('Tema değiştirildi', isDriving);
        break;
      }
      case 'CYCLE_THEME': {
        // "temayı değiştir"/"başka tema" — beyin bunu üretir; routeIntent ile aynı.
        // Eskiden case YOKTU → "Tema değişti" denip "Komut Hatası" basıyordu.
        ctx.cycleTheme?.();
        _speak('Tema değiştirildi', isDriving);
        break;
      }
      case 'SET_SETTING': {
        ctx.applySetting?.(
          intent.payload.settingKey ?? '',
          intent.payload.settingAction ?? '',
          intent.payload.settingValue,
          intent.payload.settingKind,
        );
        _speak('Ayar uygulandı', isDriving);
        break;
      }
      case 'ENABLE_DRIVING_MODE': {
        ctx.openDrawer?.('none');
        _speak('Sürüş modu aktif', isDriving);
        break;
      }
      case 'TOGGLE_SLEEP_MODE': {
        // MainLayout registerCommandHandler tarafından yakalanır
        _speak('Uyku modu değiştirildi', isDriving);
        break;
      }
      case 'SHOW_WEATHER': {
        ctx.openWeather?.();
        _speak(getWeatherNarrative(), isDriving);
        break;
      }

      /* ── Araç Durumu Özeti ─────────────────────────────── */
      case 'VEHICLE_STATUS': {
        const { speed, fuel } = useUnifiedVehicleStore.getState();
        const _vctx   = ctx.vehicleCtx as unknown as Record<string, unknown>;
        const speedKmh = ctx.vehicleCtx.speedKmh || (speed ?? undefined);
        const fuelPct  = (_vctx['fuelLevelPct'] as number | undefined) ?? (fuel != null ? fuel : undefined);
        const tempC    = _vctx['engineTempC'] as number | undefined;

        const parts: string[] = [];
        if (speedKmh !== undefined) parts.push(`Hızın ${Math.round(speedKmh)} kilometre`);
        if (fuelPct !== undefined) {
          parts.push(fuelPct < 15
            ? `Yakıtın yüzde ${Math.round(fuelPct)}, az kaldı`
            : `Yakıtın yüzde ${Math.round(fuelPct)}`);
        }
        if (tempC !== undefined) {
          parts.push(`Motor sıcaklığı ${tempC > 100 ? 'yüksek, dikkat' : 'normal'}`);
        }

        if (parts.length === 0) {
          _speak('Araç verisi alınamıyor. OBD bağlantısını kontrol edin.', isDriving);
          break;
        }

        const maintenance = await getMaintenanceSummaryText();
        parts.push(maintenance);
        speakFeedback(parts.join('. ') + '.');
        break;
      }

      /* ── Araç Teşhis (AI Doctor) ────────────────────────── */
      case 'CHECK_VEHICLE_HEALTH': {
        _speak('Araç sistemleri taranıyor', isDriving);
        await readDTCCodes();
        const healthSnap = _getDTCSnapshot();
        _speak(_buildDTCSpeech(healthSnap, isDriving), isDriving);
        break;
      }
      case 'CLEAR_DTC_CODES': {
        const clearSnap = _getDTCSnapshot();
        if (clearSnap.codes.length === 0) {
          _speak('Temizlenecek arıza kodu yok', isDriving);
          break;
        }
        _speak('Arıza kayıtları siliniyor', isDriving);
        await clearDTCCodes();
        _speak('Arıza kayıtları silindi', isDriving);
        break;
      }

      /* ── Araç Bakım ─────────────────────────────────────── */
      case 'CHECK_MAINTENANCE': {
        _speak('Araç bakım durumu kontrol ediliyor', isDriving);
        const summary = await getMaintenanceSummaryText();
        _speak(summary, isDriving);
        break;
      }
      /* ── Araç Sensör Sorgusu (V1 — QUERY_SENSOR, beyin yolu) ─────
         Beyin DEĞER üretmez, yalnız sorulan sensörün adını taşır — gerçek
         değer HER ZAMAN buradan (sensorQueryService.querySensor) gelir.
         EXTENDED/manufacturer hedefler ilk okumayı 12s'e kadar bekleyebilir
         (sensorQueryService) — sessizlik "ölü" sanılmasın diye önce kısa bir
         onay söylenir (yerel bypass'la AYNI desen, bkz. voiceService). */
      case 'QUERY_SENSOR': {
        const sensorQuery = intent.payload.sensorQuery ?? '';
        if (!sensorQuery) { _speak('Hangi sensörü soruyorsun?', isDriving); break; }
        _speak('Bakıyorum', isDriving);
        const answer = await querySensor(sensorQuery);
        if (!answer) { _speak('Bu sensörü tanımıyorum', isDriving); break; }
        // VIN gibi uzun metin DID'leri TTS'te OKUNMAZ (ISO 15008) — ekrana yönlendir.
        if (typeof answer.value === 'string' && answer.value.length > 20) {
          _speak(`${answer.name} ekranda gösteriliyor`, isDriving);
          showToast({ type: 'info', title: answer.name, message: answer.value, duration: 8000 });
          break;
        }
        _speak(answer.text, isDriving);
        break;
      }
      case 'OPEN_APPOINTMENT_LINK': {
        _speak('Muayene randevu sayfası açılıyor', isDriving);
        openInApp('https://www.tuvturk.com.tr/randevu-al.aspx');
        break;
      }

      /* ── Araç Donanım (CAN Bus) ──────────────────────────── */
      case 'HARDWARE_LOCK': {
        // Manuel müdahale önceliği: araçta kullanıcı varken uzaktan kilit komutu engellenir.
        // Sürücü güvenliği — birisi içerideyken kapı kilitlenmesi panik yaratabilir.
        if (ctx.isRemote && _isOccupied(ctx)) {
          _speak('Araçta kullanıcı var, uzaktan kilit engellendi', isDriving);
          throw new Error('SafetyReject: remote LOCK blocked — vehicle occupied');
        }
        if (!ctx.hwLockDoors) {
          _error('Kapı kilidi donanımı bağlı değil');
          break;
        }
        // L2 ACK beklenir — TTS/toast yalnızca donanım onayından sonra tetiklenir
        const lockResult = await ctx.hwLockDoors();
        if (lockResult.status === 'completed') {
          _speak('Kapılar kilitlendi', isDriving);
          showToast({ type: 'success', title: 'Kapılar Kilitlendi', message: 'Tüm kapılar başarıyla kilitlendi', duration: 3000 });
        } else {
          _error('Kapı kilidi başarısız: ' + (lockResult.error ?? lockResult.status));
        }
        break;
      }
      case 'HARDWARE_UNLOCK': {
        // Önce sürüş güvenliği (hız > 0 → kesin engel)
        if (isDriving) {
          _speak('Sürüşte kapı açma engellendi', isDriving);
          throw new Error('Safety reject: HARDWARE_UNLOCK while driving');
        }
        // Uzaktan komut + kontak açık (araçta kullanıcı var) → engel
        if (ctx.isRemote && _isOccupied(ctx)) {
          _speak('Araçta kullanıcı var, uzaktan açma engellendi', isDriving);
          throw new Error('SafetyReject: remote UNLOCK blocked — vehicle occupied');
        }
        if (!ctx.hwUnlockDoors) {
          _error('Kapı kilidi donanımı bağlı değil');
          break;
        }
        // L2 ACK beklenir — TTS/toast yalnızca donanım onayından sonra tetiklenir
        const unlockResult = await ctx.hwUnlockDoors();
        if (unlockResult.status === 'completed') {
          _speak('Kapılar açıldı', isDriving);
          showToast({ type: 'success', title: 'Kapılar Açıldı', message: 'Tüm kapılar başarıyla açıldı', duration: 3000 });
        } else {
          _error('Kapı açma başarısız: ' + (unlockResult.error ?? unlockResult.status));
        }
        break;
      }

      /* ── Uzun-dönem kişisel hafıza ──────────────────────── */
      case 'REMEMBER': {
        // Kullanıcının açıkça istediği kalıcı fact'i sakla. Boş/geçersizse
        // SAHTE ONAY YOK — dürüstçe "neyi hatırlayayım" der.
        const fact = addFact(intent.payload.memoryText ?? '');
        _speak(fact ? 'Tamam, aklımda tutuyorum' : 'Neyi hatırlamamı istersin?', isDriving);
        break;
      }
      case 'FORGET': {
        const removed = forgetFact(intent.payload.memoryText ?? '');
        _speak(
          removed === 'all' ? 'Hepsini unuttum'
          : removed          ? 'Tamam, unuttum'
          :                    'Öyle bir şey hatırlamıyorum zaten',
          isDriving,
        );
        break;
      }

      /* ── Canlı Stil ─────────────────────────────────────── */
      case 'SET_STYLE': {
        const styles = intent.payload.styleVars;
        if (styles) applyLiveStyle(styles);
        break;
      }

      /* ── Bilinmeyen ─────────────────────────────────────── */
      case 'UNKNOWN':
      default: {
        _error('Anlayamadım');
        break;
      }
    }
  } catch {
    _error('Uygulama açılamadı');
  }
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Tek bir AppIntent'i çalıştır.
 * intentEngine.routeIntent() yerine bu fonksiyon kullanılabilir;
 * TTS geri bildirimi ve hata yönetimini otomatik sağlar.
 */
export async function executeIntent(
  intent: AppIntent,
  ctx:    CommandContext,
): Promise<void> {
  await dispatchIntent(intent, ctx);
}

/**
 * Birden fazla intent'i paralel çalıştır (komut zinciri).
 *
 * Kullanım — bileşik komut:
 *   "Benzinliğe git ve Spotify'da yol şarkıları çal"
 *   → executeSequence([navIntent, musicIntent], ctx)
 */
export async function executeSequence(
  intents: AppIntent[],
  ctx:     CommandContext,
): Promise<void> {
  await Promise.all(intents.map((intent) => dispatchIntent(intent, ctx)));
}

/**
 * AI sesli asistan sonucunu doğrudan çalıştır.
 *
 * - AIVoiceResult.feedback alanı 8-kelime kuralına göre seslendirilir.
 * - Payload AppIntent'e dönüştürülür → dispatchIntent() çağrılır.
 * - confidence < 0.45 ise komut görmezden gelinir, "Anlayamadım" denir.
 */
export async function executeAIResult(
  result: AIVoiceResult,
  ctx:    CommandContext,
): Promise<void> {
  const { isDriving } = ctx.vehicleCtx;

  if (result.confidence < 0.45) {
    _error('Anlayamadım');
    return;
  }

  // AI'dan gelen feedback'i TTS ile seslendir
  if (result.feedback && result.intent !== 'UNKNOWN') {
    _speak(result.feedback, isDriving);
  }

  const intent = fromAIResponse(result, result.payload['sourceText'] as string ?? '');
  if (!intent) {
    _error('Anlayamadım');
    return;
  }

  await dispatchIntent(intent, ctx);
}

/**
 * Kayıtlı ses seviyesini dışarıdan güncelle (slider değişimlerinde).
 * commandExecutor'ın iç state'i ile slider'ı senkronize tutar.
 */
export function syncVolume(percent: number): void {
  _currentVolume = Math.max(0, Math.min(100, percent));
}
