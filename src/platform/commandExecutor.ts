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

import { bridge }                       from './bridge';
import { fromAIResponse, type AppIntent } from './intentEngine';
import type { AIVoiceResult, VehicleContext } from './aiVoiceService';
import { play, pause, next, previous }  from './mediaService';
import { setVolume }                    from './systemSettingsService';
import { speakFeedback, speakAlert }    from './ttsService';
import { showToast }                    from './errorBus';
import type { NavOptionKey, MusicOptionKey } from '../data/apps';
import { readDTCCodes, clearDTCCodes, onDTCState, type DTCState } from './dtcService';
import { getMaintenanceSummaryText } from './vehicleMaintenanceService';
import { openInApp } from './inAppBrowser';
import { applyLiveStyle } from './liveStyleEngine';

/* ── Volume state ─────────────────────────────────────────── */

// Module-level volume tracker (0-100). Initial mid-level default.
let _currentVolume = 60;

/* ── Public context ───────────────────────────────────────── */

export interface CommandContext {
  vehicleCtx:   VehicleContext;
  defaultNav:   NavOptionKey;
  defaultMusic: MusicOptionKey;
  recentAppId?: string;
  /** Resolve appId → actual app launch (has access to appMap in caller) */
  launch:       (appId: string) => void;
  setTheme?:    (theme: 'dark' | 'oled') => void;
  openDrawer?:  (target: 'apps' | 'settings' | 'none') => void;
  openWeather?: () => void;
}

/* ── Internal helpers ─────────────────────────────────────── */

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

  try {
    switch (intent.type) {

      /* ── Navigasyon ─────────────────────────────────────── */
      case 'OPEN_NAVIGATION': {
        bridge.launchNavigation(ctx.defaultNav);
        _speak('Navigasyon başlatılıyor', isDriving);
        break;
      }
      case 'NAVIGATE_ADDRESS': {
        bridge.launchNavigation(ctx.defaultNav);
        const dest = intent.payload.destination;
        _speak(dest ? `${dest} adresine gidiyoruz` : 'Navigasyon başlatılıyor', isDriving);
        break;
      }
      case 'NAVIGATE_PLACE': {
        bridge.launchNavigation(ctx.defaultNav);
        const place = intent.payload.destination;
        _speak(place ? `${place} aranıyor` : 'Yer aranıyor', isDriving);
        break;
      }
      case 'FIND_NEARBY_GAS': {
        bridge.launchNavigation(ctx.defaultNav);
        _speak('Yakın benzinlik aranıyor', isDriving);
        break;
      }
      case 'FIND_NEARBY_PARKING': {
        bridge.launchNavigation(ctx.defaultNav);
        _speak('Yakın park yeri aranıyor', isDriving);
        break;
      }

      /* ── Müzik ──────────────────────────────────────────── */
      case 'OPEN_MUSIC': {
        bridge.launchMusic(ctx.defaultMusic);
        _speak('Müzik açılıyor', isDriving);
        break;
      }
      case 'PLAY_MUSIC_SEARCH': {
        const query = intent.payload.searchQuery ?? '';
        if (query) {
          bridge.launchMusicSearch(ctx.defaultMusic, query);
          _speak(`${query} aranıyor`, isDriving);
        } else {
          bridge.launchMusic(ctx.defaultMusic);
          _speak('Müzik açılıyor', isDriving);
        }
        break;
      }
      case 'PLAY_MUSIC_QUERY': {
        const pkg        = intent.payload.musicSourcePkg ?? '';
        const searchUri  = intent.payload.musicSearchUri ?? '';
        bridge.launchMusicQuery(pkg, searchUri, ctx.defaultMusic);
        _speak('Müzik aranıyor', isDriving);
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
        ctx.setTheme?.((intent.payload.mode as 'dark' | 'oled') ?? 'oled');
        _speak('Gece modu aktif', isDriving);
        break;
      }
      case 'SET_THEME': {
        ctx.setTheme?.((intent.payload.mode as 'dark' | 'oled') ?? 'dark');
        _speak('Tema değiştirildi', isDriving);
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
        _speak('Hava durumu açılıyor', isDriving);
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
      case 'OPEN_APPOINTMENT_LINK': {
        _speak('Muayene randevu sayfası açılıyor', isDriving);
        openInApp('https://www.tuvturk.com.tr/randevu-al.aspx');
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
