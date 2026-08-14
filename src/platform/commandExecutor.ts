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
import type { MediaCommandResult } from './mediaService';
import { setVolume }                    from './systemSettingsService';
// MAVI-M6: normal kullanıcı cevabının TEK otoritesi. `speakAlert` ayrı hata
// kanalıdır (uyarı tonu) ve bu görevde DEĞİŞTİRİLMEDİ.
import { speakAlert } from './ttsService';
import { speakMaviAnswer } from './assistant/maviSpeech';
import type { MaviTurnToken } from './assistant/maviTurn';
// MAVI-M4: araç etkili eylemlerin TEK kapısı (defter + AiSafetyGate + onay + capability).
import {
  evaluateVehicleAction, isVehicleEffectiveIntent, getVehicleActionDef,
  type VehicleActionDef,
} from './action/maviActionAuthority';
// MAVI-M4-LAB-2: zincir gözlemi (saf depo — konuşmaz, UI açmaz, sonucu değiştirmez).
import { recordMaviActionStage } from './action/maviActionTrace';
import { intentResult, type IntentExecutionResult } from './intentExecutionResult';
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
import { isHomeWorkDestination, dispatchHomeWorkNavigation } from './homeWorkNavigation';
import type { NearbyPoiCategory } from './nearbyPoiNavigation';

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
  /** NAVIGATION-P1-1: "en yakın X" merkezi dispatch — intentEngine.RouterContext
   *  ile AYNI sözleşme (dispatchNearbyPoiNavigation wrapper'ı). */
  dispatchNearbyPoi?: (category: NearbyPoiCategory) => void;
  /* ── MAVI-M4 · ARAÇ ETKİLİ YÜRÜTÜCÜ PORTLARI ────────────────────────────
   * Adlar `maviActionAuthority.VehicleActionCapability` ile BİREBİR aynıdır:
   * kapı `defs[intent].capability` ile burada arar, yürütücü aynı adla çağırır.
   * Hepsi OPSİYONELDİR — port yoksa kapı DÜRÜST `unsupported` döner, yürütücü
   * hiç çalışmaz ("yapıldı" DENMEZ). `void` dönen (ACK'siz) port SUCCEEDED
   * ÜRETMEZ → `unknown` (M3 sahte-ACK yasağı).
   * `hwRearCamera`/`hwLightsOff`/`hwScreenOff` native karşılığı olmadığı için
   * BİLİNÇLİ olarak burada TANIMLI DEĞİLDİR (bkz. maviActionAuthority notu). */
  /** Araç kapı kilidi — CAN bus sinyali; L2 ACK onaylandığında resolve eder */
  hwLockDoors?:   () => Promise<CommandResult>;
  /** Araç kapı kilidi açma — güvenlik: sürüş sırasında engellenir; L2 ACK ile resolve */
  hwUnlockDoors?: () => Promise<CommandResult>;
  hwHonkHorn?:    () => Promise<CommandResult> | void;
  hwFlashLights?: () => Promise<CommandResult> | void;
  hwAlarmOn?:     () => Promise<CommandResult> | void;
  hwAlarmOff?:    () => Promise<CommandResult> | void;
  /** Kontak açık mı? (OBD PID 0x01) — remoteCommandService occupancy kontrolünde kullanılır */
  ignitionOn?: boolean;
  /** True ise komut Supabase kanalından geldi; false/undefined = lokal ses komutu */
  isRemote?: boolean;
  /**
   * MAVI-M4: kullanıcı bu eylemi AÇIKÇA onayladı mı. YALNIZ bekleyen onay
   * çözümünden (`consumePendingAction`) gelir; parser eşleşmesi ONAY DEĞİLDİR.
   */
  actionConfirmed?: boolean;
  /**
   * MAVI-M6-LATE-SPEECH-GATE — **komut girişinde yakalanmış** tur token'ı.
   *
   * `dispatchIntent` içindeki `await` sonrası konuşmalar (müzik arama sonucu ·
   * araç durumu · bakım özeti) bu token ile korunur: kullanıcı bu arada yeni
   * komut verdiyse geç metin KONUŞMAZ ve yeni turun cevap slotunu TÜKETMEZ.
   *
   * OPSİYONELDİR — verilmezse davranış BİREBİR eskisi gibidir. Turn kavramı
   * olmayan çağıranlar (uzak komut hattı · `remoteCommandService`) geriye
   * uyumlu kalır ve bu görevde DEĞİŞTİRİLMEMİŞTİR.
   */
  turn?: MaviTurnToken | null;
}

/* ── Internal helpers ─────────────────────────────────────── */

/**
 * Araçta kullanıcı var mı? (Kontak açık VEYA hareket halinde)
 * Uzaktan gelen kritik komutlara (kapı/klima) karşı güvenlik bariyeri.
 */
function _isOccupied(ctx: CommandContext): boolean {
  return ctx.vehicleCtx.isDriving || (ctx.ignitionOn ?? false);
}

/**
 * MAVI-M6: bu katman ARTIK KENDİ BAŞINA KONUŞMAZ — cevabı TEK otoriteye
 * (`speakMaviAnswer`) teslim eder. Otorite tur başına en fazla BİR `answer`
 * geçirir, ISO 15008 kısaltmasını TEK YERDE yapar ve devralınmış turu susturur.
 * `_speak` yalnız ince bir adaptördür; `speakFeedback` doğrudan ÇAĞRILMAZ.
 */
function _speak(text: string, isDriving: boolean, turn: MaviTurnToken | null): void {
  speakMaviAnswer(text, { isDriving, turn });
}

/**
 * Ara bilgi ("taranıyor", "bakıyorum") — NİHAİ CEVAP DEĞİLDİR. Tur başına en fazla
 * bir kez geçer ve cevap verildikten sonra hiç konuşmaz. Bu ayrım sayesinde çok
 * fazlı akışlar (tarama → sonuç) dürüstlüğünü korur, gevezelik etmez.
 */
function _speakProgress(text: string, isDriving: boolean, turn: MaviTurnToken | null): void {
  speakMaviAnswer(text, { isDriving, tier: 'progress', turn });
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
  /* Token AWAIT'LERDEN ÖNCE okunur — bu fonksiyon `void`lenerek çağrılır
   * (fire-and-forget) ve dinamik import + arama saniyeler sürebilir. */
  const _turn = ctx.turn ?? null;
  try {
    // Lazy import: carosMediaLayer mediaService'i import ettiğinden statik döngüyü kır.
    const { playByQuery } = await import('./media/carosMediaLayer');
    const track = await playByQuery(query);
    if (track) {
      ctx.openDrawer?.('music');         // uygulama-içi çalma ekranını öne getir
      _speak(`${track.title} çalınıyor`, isDriving, _turn);
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

/* ── MAVI-M4 · araç etkili port yürütücüsü (TEK ACK sözleşmesi) ──────────── */

/**
 * Bir donanım portunu çalıştırır ve M3 sahte-ACK yasağını TEK YERDE uygular.
 * Buraya YALNIZ kapı geçildikten sonra gelinir → port varlığı GARANTİDİR.
 *
 * Sözleşme (M3 kilidi — zayıflatılamaz):
 *   · `status === 'completed'`           → `succeeded` (BAŞARI YALNIZ BURADA iddia edilir)
 *   · `rejected` / `failed` / `timeout`  → `failed` (donanım reddi)
 *   · ACK'siz (void/undefined) dönüş     → `unknown` — ASLA `succeeded`
 *   · throw / reject                     → `failed`
 * "Fire-and-forget çağırdım" başarı DEĞİLDİR; kullanıcıya ancak
 * "sonucunu doğrulayamadım" denir.
 */
async function _runVehiclePort(
  type: AppIntent['type'],
  port: () => Promise<CommandResult> | void,
  successText?: string,
): Promise<IntentExecutionResult> {
  let res: CommandResult | void;
  try {
    res = await port();
  } catch {
    return intentResult(type, 'failed', 'port_exception');
  }
  const r = res as CommandResult | undefined;
  const status = r?.status;
  if (status === 'completed') {
    /* Başarı metni YALNIZ burada üretilir. `simulated` gerçek donanım ACK'iyle
       karışmasın diye AYRI gerekçeyle raporlanır (kullanıcı metni değişmez —
       demo modunda uygulama çalışmaya devam eder). */
    return intentResult(type, 'succeeded', r?.simulated ? 'ack_simulated' : 'ack', successText);
  }
  if (status === undefined)   return intentResult(type, 'unknown', 'no_ack');
  /* GÖNDERİLEMEDİ → başarı metni YOK. Kullanıcıya dürüst ve SPESİFİK cevap:
     "Bunu yapamadım." komutun araca hiç ulaşmadığını söylemiyordu. Neden kodu
     (whitelist_rejected · mcu_send_failed · malformed_native_result · not_sent)
     telemetriye taşınır, kullanıcıya GÖSTERİLMEZ. */
  const reason = r?.error ? `${status}:${r.error}` : (status ?? 'failed');
  return intentResult(type, 'failed', reason, 'Komut araca gönderilemedi.');
}

/* ── Core dispatcher ──────────────────────────────────────── */

/**
 * Kaynaksız "müzik aç" — GÖMÜLÜ katmandan başlat.
 *
 * SIRA (kullanıcı kararı 2026-08-08):
 *   1. Gömülü katmanda kaldığı yer varsa oradan devam (`resumeLastMedia`).
 *   2. Yoksa gömülü YouTube'da varsayılan müzik araması.
 *   3. İkisi de olmazsa **harici uygulamaya SESSİZCE GİDİLMEZ** — dürüstçe
 *      söylenir. (Sürücü kaynağı söylerse o kaynak zaten açılır.)
 *
 * SAHTE ONAY YOK: cümle ancak GERÇEKTEN bir şey başlatıldığında "açılıyor" der.
 */
async function _openEmbeddedMusic(): Promise<string> {
  try {
    // Lazy import: carosMediaLayer mediaService'i import eder → statik döngü kırılır.
    const layer = await import('./media/carosMediaLayer');
    if (layer.resumeLastMedia()) return 'Müzik açılıyor';
    /* Kaldığı yer yok → gömülü YouTube. `playByQuery` sağlayıcılarda arar ve
       çalınabilir sonuç bulursa GÖMÜLÜ oynatıcıda başlatır. */
    const track = await layer.playByQuery(EMBEDDED_MUSIC_SEED, 'all');
    if (track) return `${track.title} çalınıyor`;
  } catch { /* gömülü katman hatası → sahte onay ÜRETME */ }
  return 'Gömülü oynatıcıda çalacak bir şey bulamadım. Kaynak söylersen oradan açayım.';
}

/**
 * Kaynaksız "müzik aç" için gömülü arama tohumu.
 * Sabit bir liste/çalma listesi UYDURULMAZ; mevcut arama altyapısı kullanılır.
 */
const EMBEDDED_MUSIC_SEED = 'müzik';

/**
 * Parça atlama cevabı — SAHTE ONAY YASAĞININ tek karar noktası.
 *
 * Kural: `verified` DEĞİLSE başarı cümlesi KURULMAZ. Bilinen sebepler ayrı
 * cümle alır (sürücü ne yapacağını bilsin); bilinmeyen sebep "emin değilim"
 * der — "yaptım" DEMEZ.
 */
function _mediaSkipReply(r: MediaCommandResult, okText: string): string {
  if (r.verified) return okText;
  switch (r.failureCode) {
    case 'empty_queue':
    case 'no_target':
      return 'Şu anda çalan bir şey yok.';
    case 'end_of_queue':
      return 'Listenin sonundayız, sonraki parça yok.';
    case 'start_of_queue':
      return 'Listenin başındayız, önceki parça yok.';
    case 'unverified_backend':
      /* Harici oturuma gönderildi ama etkisi GÖZLENEMEZ — "değişti" denemez. */
      return 'Komutu gönderdim ama değiştiğini doğrulayamıyorum.';
    default:
      return 'Parçayı değiştiremedim.';
  }
}

async function dispatchIntent(intent: AppIntent, ctx: CommandContext): Promise<IntentExecutionResult> {
  const { isDriving } = ctx.vehicleCtx;
  /* MAVI-M6-LATE-SPEECH-GATE: yakalanmış tur token'ı BİR KEZ, await'lerden ÖNCE
   * okunur ve tüm `_speak`/`_speakProgress` çağrılarına taşınır. `null` ise
   * (turn kavramı olmayan çağıran) kapı devre dışıdır → geriye uyumlu. */
  const _turn = ctx.turn ?? null;

  // Kara kutu: her dispatch anında son intent'i kaydet
  _lastIntent = intent.type;

  /* ── MAVI-M4 · TEK EYLEM OTORİTESİ KAPISI ────────────────────────────────
   * ARAÇ ETKİLİ her intent buradan geçer ve kapı **port/native/OBD çağrısından
   * ÖNCE** çalışır: hareket politikası (M2) → AiSafetyGate kapsamı → açık onay →
   * capability. Kapı reddederse yürütücü HİÇ çağrılmaz ve M3 sonucu döner.
   * Defterde olmayan (araç etkili olmayan) intentler `not_handled` alır ve
   * aşağıdaki normal akışlarına devam eder. */
  let _gateDef: VehicleActionDef | null = null;
  if (isVehicleEffectiveIntent(intent.type)) {
    // `OPEN_PHONE` yalnız KİŞİ ADIYLA arama başlatır; adsız çağrı telefon
    // UYGULAMASINI açar (geri alınamaz dış etki yok) → onaydan muaf.
    const _phoneAppOnly =
      intent.type === 'OPEN_PHONE' && !(intent.payload.contactName ?? '').trim();
    const gate = evaluateVehicleAction({
      intent: intent.type,
      vehicleCtx: ctx.vehicleCtx,
      // Portlar TEK yerden geçirilir; eksik bırakılan bir port kapıda
      // `unsupported` üretir (sessiz no-op DEĞİL).
      ports: {
        hwLockDoors:   ctx.hwLockDoors,
        hwUnlockDoors: ctx.hwUnlockDoors,
        hwHonkHorn:    ctx.hwHonkHorn,
        hwFlashLights: ctx.hwFlashLights,
        hwAlarmOn:     ctx.hwAlarmOn,
        hwAlarmOff:    ctx.hwAlarmOff,
      },
      confirmed: ctx.actionConfirmed === true,
      confirmationExempt: _phoneAppOnly,
    });
    if (!gate.allow) return gate.result;
    _gateDef = gate.def;
  }
  void _gateDef;   // kapı geçildi — yürütücü aşağıda

  try {
    switch (intent.type) {

      /* ── Navigasyon ─────────────────────────────────────────
         KENDİ HARİTAMIZ: ctx.launch(defaultNav) → handleLaunch navigation
         kategorisini yakalar → uygulama-içi FullMapView açar (harici Google
         Maps'e YÖNLENDİRME YOK). intentEngine.routeIntent ile birebir tutarlı —
         eskiden AI yolu bridge.launchNavigation ile harici app açıyordu (iki
         router ayrışması). navigateToPlace varsa hedefe uygulama-içi rota kurar.
         NAVIGATION-P0-1: destination 'home'/'work' ise TEK merkezi hatta
         (homeWorkNavigation — intentEngine.routeIntent ile AYNI fonksiyon)
         delege edilir; gerçek koordinat yoksa fail-closed (ekran da açılmaz,
         sahte "başlatılıyor" mesajı SÖYLENMEZ — dispatchHomeWorkNavigation
         kendi bounded TTS'ini üretir, burada ÇİFT konuşma yapılmaz). */
      case 'OPEN_NAVIGATION': {
        const dest = intent.payload.destination;
        if (isHomeWorkDestination(dest)) {
          dispatchHomeWorkNavigation(dest);
          break;
        }
        ctx.launch(ctx.defaultNav);
        _speak('Navigasyon başlatılıyor', isDriving, _turn);
        break;
      }
      case 'NAVIGATE_ADDRESS': {
        const dest = intent.payload.destination;
        if (dest && ctx.navigateToPlace) ctx.navigateToPlace(dest);
        else ctx.launch(ctx.defaultNav);
        _speak(dest ? `${dest} adresine gidiyoruz` : 'Navigasyon başlatılıyor', isDriving, _turn);
        break;
      }
      case 'NAVIGATE_PLACE': {
        const place = intent.payload.destination;
        if (place && ctx.navigateToPlace) ctx.navigateToPlace(place);
        else ctx.launch(ctx.defaultNav);
        _speak(place ? `${place} aranıyor` : 'Yer aranıyor', isDriving, _turn);
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
        _speak(poiQuery ? `Yakın ${poiQuery} aranıyor` : 'Yakın yerler aranıyor', isDriving, _turn);
        break;
      }
      case 'FIND_NEARBY_GAS': {
        // NAVIGATION-P1-1: merkezi dispatch — düz-metin geocode ARTIK YOK; TTS burada
        // TEKRARLANMAZ çünkü dispatchNearbyPoiNavigation kendi successKey TTS'ini söyler
        // (çift konuşma önlenir).
        if (ctx.dispatchNearbyPoi) ctx.dispatchNearbyPoi('fuel');
        else ctx.launch(ctx.defaultNav);
        break;
      }
      case 'FIND_NEARBY_PARKING': {
        // NAVIGATION-P1-2: merkezi dispatch — düz-metin geocode ARTIK YOK; TTS burada
        // TEKRARLANMAZ çünkü dispatchNearbyPoiNavigation kendi successKey TTS'ini söyler.
        if (ctx.dispatchNearbyPoi) ctx.dispatchNearbyPoi('parking');
        else ctx.launch(ctx.defaultNav);
        break;
      }
      case 'FIND_NEARBY_REST_AREA': {
        // "biraz yoruldum / mola vereyim" — merkezi dispatch (fuel/parking ile
        // AYNI hat). TTS burada TEKRARLANMAZ; dispatchNearbyPoiNavigation kendi
        // successKey'ini söyler (çift konuşma önlenir).
        if (ctx.dispatchNearbyPoi) ctx.dispatchNearbyPoi('restArea');
        else ctx.launch(ctx.defaultNav);
        break;
      }
      case 'FIND_NEARBY_HOSPITAL': {
        // Sentinel kullanılır — resolveAndNavigate '__nearby_hospital__'i
        // Overpass amenity=hospital aramasına eşler (bkz. intentEngine.ts
        // aynı case, addressNavigationEngine.ts).
        if (ctx.navigateToPlace) ctx.navigateToPlace('__nearby_hospital__');
        else ctx.launch(ctx.defaultNav);
        _speak('Yakın hastane aranıyor', isDriving, _turn);
        break;
      }

      /* ── Müzik ──────────────────────────────────────────── */
      // Genel "müzik aç": harici uygulamayı ÖN PLANA almadan arka planda çal ve
      // uygulama içi çalma ekranını (music drawer) göster. Kullanıcı uygulamadan
      // uzaklaşmaz. Yalnızca belirli bir şarkı/sanatçı araması (query/searchUri)
      // gerektiğinde harici uygulama deep-link ile açılır — arama UI'si şart.
      /* KAYNAK SÖYLENMEDİYSE GÖMÜLÜ KATMAN (saha 2026-08-08) ────────────────
       * Eskiden kaynak belirtilmese de doğrudan `play()` çağrılıyordu; bu,
       * harici bir Android MediaSession'ı (Spotify/YouTube uygulaması) devralıp
       * sürücüyü uygulamadan koparıyordu. Kullanıcı kararı: kaynak SÖYLENMEDİYSE
       * önce GÖMÜLÜ oynatıcı; kaynak SÖYLENDİYSE o kaynak.
       * Bu, mevcut `PLAY_MUSIC_SEARCH`/`PLAY_MUSIC_QUERY` yollarındaki
       * "önce gömülü, sonra harici" deseniyle AYNI ilkedir — o yollar
       * DEĞİŞTİRİLMEDİ, yalnız kaynaksız "müzik aç" onlara HİZALANDI. */
      case 'OPEN_MUSIC': {
        const pkg = intent.payload.musicSourcePkg ?? '';
        if (pkg) {
          // Kullanıcı kaynağı SÖYLEDİ → mevcut davranış AYNEN korunur.
          setMediaPreferredPackage(pkg);
          play();
          ctx.openDrawer?.('music');
          _speak('Müzik açılıyor', isDriving, _turn);
          break;
        }
        ctx.openDrawer?.('music');
        _speak(await _openEmbeddedMusic(), isDriving, _turn);
        break;
      }
      case 'PLAY_MUSIC_SEARCH': {
        const query = intent.payload.searchQuery ?? '';
        if (query) {
          // ÖNCE gömülü oynatıcı; çalınabilir sonuç yoksa harici uygulamaya düş.
          void _playMusicInAppOrFallback(query, ctx, isDriving, () => {
            bridge.launchMusicSearch(ctx.defaultMusic, query);
            _speak(`${query} aranıyor`, isDriving, _turn);
          });
        } else {
          play();
          ctx.openDrawer?.('music');
          _speak('Müzik açılıyor', isDriving, _turn);
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
            _speak(`${query} aranıyor`, isDriving, _turn);
          });
        } else if (searchUri) {
          // Query metni yok, yalnız deep-link URI var → gömülüde arayamayız.
          bridge.launchMusicQuery(pkg, searchUri, ctx.defaultMusic);
          _speak('Müzik aranıyor', isDriving, _turn);
        } else {
          // Sadece kaynak söylendi → arka planda çal + ekranı göster
          if (pkg) setMediaPreferredPackage(pkg);
          play();
          ctx.openDrawer?.('music');
          _speak('Müzik açılıyor', isDriving, _turn);
        }
        break;
      }
      case 'ADD_MUSIC_FAVORITE': {
        _speak('Bu özellik şu an desteklenmiyor', isDriving, _turn);
        break;
      }
      case 'SET_MUSIC': {
        const appId = intent.payload.targetApp;
        if (appId) ctx.launch(appId);
        _speak('Müzik uygulaması açılıyor', isDriving, _turn);
        break;
      }

      /* ── Medya kontrolü ─────────────────────────────────── */
      case 'PLAY_MEDIA': {
        play();
        _speak('Devam ediyor', isDriving, _turn);
        break;
      }
      case 'PAUSE_MEDIA': {
        pause();
        _speak('Duraklatıldı', isDriving, _turn);
        break;
      }
      /* ── Parça atlama — SAHTE ONAY YOK (saha 2026-08-08) ────────────────
       * Eskiden `next()` çağrılıp SONUÇ BEKLENMEDEN "Sonraki parça" deniyordu.
       * Kuyruk boşken / otorite reddettiğinde / harici oturum komutu yutunca
       * hiçbir şey değişmiyor ama asistan değişmiş gibi konuşuyordu.
       * Artık YALNIZ doğrulanmış sonuçta başarı söylenir; aksi hâlde neden
       * söylenir. Yönlendirme ve komut akışı DEĞİŞMEDİ. */
      case 'MEDIA_NEXT': {
        const r = await next();
        _speak(_mediaSkipReply(r, 'Sonraki parça'), isDriving, _turn);
        break;
      }
      case 'MEDIA_PREV': {
        const r = await previous();
        _speak(_mediaSkipReply(r, 'Önceki parça'), isDriving, _turn);
        break;
      }

      /* ── Ses ────────────────────────────────────────────── */
      case 'VOLUME_UP': {
        _currentVolume = Math.min(100, _currentVolume + 10);
        setVolume(_currentVolume);
        _speak('Ses artırıldı', isDriving, _turn);
        break;
      }
      case 'VOLUME_DOWN': {
        _currentVolume = Math.max(0, _currentVolume - 10);
        setVolume(_currentVolume);
        _speak('Ses azaltıldı', isDriving, _turn);
        break;
      }

      /* ── Uygulama açma ──────────────────────────────────── */
      case 'OPEN_PHONE': {
        // Kişi adı verildiyse rehberde ara → en uygun numarayı çevir. Ad yoksa
        // telefon uygulamasını aç. Bulunamazsa SAHTE ONAY YOK — dürüstçe söyle.
        const contactName = (intent.payload.contactName ?? '').trim();
        if (contactName) {
          /* MAVI-M4: buraya YALNIZ kapı geçildikten sonra gelinir — yani kullanıcı
           * aramayı AÇIKÇA onaylamıştır. Kişi/numara çözülmesi ONAY DEĞİLDİR ve
           * onaydan önce `bridge.callNumber` ÇAĞRILMAZ (kapı yukarıda). */
          const contact = searchContacts(contactName, 'frequent')[0];
          const phone = contact?.phones.find((p) => p.label === 'mobile') ?? contact?.phones[0];
          if (!contact || !phone) {
            // Numara yok → arama BAŞLAMAZ; sahte onay YOK.
            return intentResult(intent.type, 'failed', 'contact_not_found', `${contactName} rehberde bulunamadı`);
          }
          /* SAHTE ONAY YASAĞI: eskiden burada koşulsuz `succeeded` + "aranıyor"
           * dönülüyordu. Oysa köprü yalnız ÇEVİRİCİYİ açıyordu (ACTION_DIAL) →
           * kullanıcı "aranıyor" duyuyor ama hiçbir arama olmuyordu (saha bulgusu).
           * Başarı iddiası artık YALNIZ `placed === true` kanıtından gelir. */
          const outcome = await bridge.callNumber(phone.number);
          recordCall(contact.id);

          /* Köprü sonuç DÖNDÜRMEDİYSE (eski/kısmi implementasyon) başarı
           * VARSAYILMAZ — sözleşmenin `unknown` durumu tam bunun içindir. */
          if (outcome === null || outcome === undefined) {
            return intentResult(intent.type, 'unknown', 'call_outcome_unverified',
              `${contact.name} için arama sonucu doğrulanamadı`);
          }
          if (outcome.placed) {
            return intentResult(intent.type, 'succeeded', 'call_started',
              `${contact.name} aranıyor`);
          }
          if (outcome.mode === 'VENDOR') {
            /* Üretici BT uygulamasına devredildi — başladığını BİLEMEYİZ. */
            return intentResult(intent.type, 'started', 'call_handed_to_vendor',
              `${contact.name} telefon uygulamasına aktarıldı`);
          }
          /* Çevirici açıldı ama arama BAŞLAMADI — dürüstçe söyle. */
          return intentResult(intent.type, 'started', 'dialer_opened_not_placed',
            `${contact.name} numarası çeviricide — arama tuşuna basman gerekiyor`);
        }
        // Kişi adı yok → yalnız telefon UYGULAMASI açılır (arama başlamaz).
        ctx.launch(intent.payload.targetApp ?? 'phone');
        return intentResult(intent.type, 'succeeded', 'phone_app_opened', 'Telefon açılıyor');
      }
      case 'OPEN_LAST_APP': {
        const appId = intent.payload.targetApp ?? ctx.recentAppId;
        if (appId) {
          ctx.launch(appId);
          _speak('Son uygulama açılıyor', isDriving, _turn);
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
          _speak(`${app.name} açılıyor`, isDriving, _turn);
        } else {
          _speak(name ? `${name} uygulamasını bulamadım` : 'Hangi uygulamayı açayım?', isDriving, _turn);
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
          _speak(`${screen.label} ${closing ? 'kapatılıyor' : 'açılıyor'}`, isDriving, _turn);
        } else {
          _speak(scr ? `${scr} ekranını bulamadım` : 'Hangi ekranı açayım?', isDriving, _turn);
        }
        break;
      }

      /* ── Sistem / UI ────────────────────────────────────── */
      case 'OPEN_SETTINGS': {
        ctx.openDrawer?.('settings');
        _speak('Ayarlar açılıyor', isDriving, _turn);
        break;
      }
      case 'OPEN_FAVORITES': {
        ctx.openDrawer?.('apps');
        _speak('Favoriler açılıyor', isDriving, _turn);
        break;
      }
      case 'ENABLE_NIGHT_MODE': {
        ctx.setTheme?.((intent.payload.mode as 'night' | 'day' | 'oled' | 'dark') ?? 'night');
        _speak('Gece modu aktif', isDriving, _turn);
        break;
      }
      case 'SET_THEME': {
        ctx.setTheme?.((intent.payload.mode as 'night' | 'day' | 'oled' | 'dark') ?? 'night');
        _speak('Tema değiştirildi', isDriving, _turn);
        break;
      }
      case 'CYCLE_THEME': {
        // "temayı değiştir"/"başka tema" — beyin bunu üretir; routeIntent ile aynı.
        // Eskiden case YOKTU → "Tema değişti" denip "Komut Hatası" basıyordu.
        ctx.cycleTheme?.();
        _speak('Tema değiştirildi', isDriving, _turn);
        break;
      }
      case 'SET_SETTING': {
        ctx.applySetting?.(
          intent.payload.settingKey ?? '',
          intent.payload.settingAction ?? '',
          intent.payload.settingValue,
          intent.payload.settingKind,
        );
        _speak('Ayar uygulandı', isDriving, _turn);
        break;
      }
      case 'ENABLE_DRIVING_MODE': {
        ctx.openDrawer?.('none');
        _speak('Sürüş modu aktif', isDriving, _turn);
        break;
      }
      case 'TOGGLE_SLEEP_MODE': {
        // MainLayout registerCommandHandler tarafından yakalanır
        _speak('Uyku modu değiştirildi', isDriving, _turn);
        break;
      }
      case 'SHOW_WEATHER': {
        ctx.openWeather?.();
        _speak(getWeatherNarrative(), isDriving, _turn);
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
          _speak('Araç verisi alınamıyor. OBD bağlantısını kontrol edin.', isDriving, _turn);
          break;
        }

        const maintenance = await getMaintenanceSummaryText();
        parts.push(maintenance);
        _speak(parts.join('. ') + '.', isDriving, _turn);   // MAVI-M6: tek otorite üzerinden
        break;
      }

      /* ── Araç Teşhis (AI Doctor) ────────────────────────── */
      case 'CHECK_VEHICLE_HEALTH': {
        _speakProgress('Araç sistemleri taranıyor', isDriving, _turn);   // ara bilgi — nihai cevap DTC özeti
        await readDTCCodes();
        const healthSnap = _getDTCSnapshot();
        /* MAVI-M4 · SAHTE "TEMİZ" YASAĞI: `isStale` = son okuma BAŞARISIZ
         * (OBD bağlı değil / adaptör yanıt vermiyor). Eskiden bu durumda da
         * `succeeded` + "Araç sistemleri temiz, sorun yok" dönüyordu — yani
         * OKUMA YAPILAMADIĞI HALDE aracın sağlıklı olduğu iddia ediliyordu.
         * Bu, M3'ün kapattığı sahte-ACK sınıfının ta kendisidir. */
        if (healthSnap.isStale) {
          return intentResult(intent.type, 'failed', 'scan_unavailable', healthSnap.error ?? undefined);
        }
        return intentResult(intent.type, 'succeeded', 'health_read', _buildDTCSpeech(healthSnap, isDriving));
      }
      case 'CLEAR_DTC_CODES': {
        const clearSnap = _getDTCSnapshot();
        if (clearSnap.codes.length === 0) {
          return intentResult(intent.type, 'succeeded', 'nothing_to_clear', 'Temizlenecek arıza kodu yok');
        }
        // OBD-OS-F0-6: sesli komut da WriteGate'ten GEÇER — seyir halinde ECU'ya yazılmaz.
        // Sesli istek açık kullanıcı talebidir (confirmed), ama hız/tazelik kapıları geçerli.
        // SAHTE ONAY YASAK: silinmediyse "silindi" DENMEZ — kapının sebebi söylenir.
        _speakProgress('Arıza kayıtları siliniyor', isDriving, _turn);   // ara bilgi — nihai cevap WriteGate sonucu
        // Onay MAVI-M4 kapısında alındı (`ctx.actionConfirmed`); WriteGate fiziksel
        // önkoşulları (bağlantı · tazelik · hız) AYRICA denetler — bypass YOK.
        const clearResult = await clearDTCCodes({ confirmed: true });
        if (!clearResult.allowed) {
          return intentResult(intent.type, 'denied', 'write_gate_denied', clearResult.userMessage);
        }
        return intentResult(intent.type, 'succeeded', 'dtc_cleared', 'Arıza kayıtları silindi');
      }

      /* ── Araç Bakım ─────────────────────────────────────── */
      case 'CHECK_MAINTENANCE': {
        _speakProgress('Araç bakım durumu kontrol ediliyor', isDriving, _turn);   // ara bilgi
        const summary = await getMaintenanceSummaryText();
        _speak(summary, isDriving, _turn);
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
        if (!sensorQuery) return intentResult(intent.type, 'unknown', 'no_sensor_name', 'Hangi sensörü soruyorsun?');
        _speakProgress('Bakıyorum', isDriving, _turn);   // ara bilgi — nihai cevap sensör değeri
        const answer = await querySensor(sensorQuery);
        if (!answer) return intentResult(intent.type, 'unknown', 'sensor_unknown', 'Bu sensörü tanımıyorum');
        // VIN gibi uzun metin DID'leri TTS'te OKUNMAZ (ISO 15008) — ekrana yönlendir.
        if (typeof answer.value === 'string' && answer.value.length > 20) {
          showToast({ type: 'info', title: answer.name, message: answer.value, duration: 8000 });
          return intentResult(intent.type, 'succeeded', 'sensor_read_screen', `${answer.name} ekranda gösteriliyor`);
        }
        return intentResult(intent.type, 'succeeded', 'sensor_read', answer.text);
      }
      case 'OPEN_APPOINTMENT_LINK': {
        _speak('Muayene randevu sayfası açılıyor', isDriving, _turn);
        openInApp('https://www.tuvturk.com.tr/randevu-al.aspx');
        break;
      }

      /* ── Araç Donanım (CAN Bus) ──────────────────────────── */
      case 'HARDWARE_LOCK': {
        // Manuel müdahale önceliği: araçta kullanıcı varken uzaktan kilit komutu engellenir.
        // Sürücü güvenliği — birisi içerideyken kapı kilitlenmesi panik yaratabilir.
        if (ctx.isRemote && _isOccupied(ctx)) {
          return intentResult(intent.type, 'denied', 'remote_vehicle_occupied', 'Araçta kullanıcı var, uzaktan kilit engellendi');
        }
        // MAVI-M4: capability kapısı yukarıda geçildi → port GARANTİ var.
        // L2 ACK beklenir — başarı YALNIZ donanım onayıyla iddia edilir.
        const lockResult = await _runVehiclePort(intent.type, ctx.hwLockDoors!, 'Kapılar kilitlendi');
        if (lockResult.status === 'succeeded') {
          showToast({ type: 'success', title: 'Kapılar Kilitlendi', message: 'Tüm kapılar başarıyla kilitlendi', duration: 3000 });
        }
        return lockResult;
      }
      case 'HARDWARE_UNLOCK': {
        /* MAVI-M2/M4: "doğrulanmış duruyor" kapısı ARTIK TEK OTORİTEDE
         * (`maviActionAuthority.evaluateVehicleAction` → `requires_stopped`).
         * Buraya yalnız o kapı geçildiğinde gelinir; `motionState` taşımayan
         * eski çağıranlar için de sözleşme orada birebir korunur. */
        // Uzaktan komut + kontak açık (araçta kullanıcı var) → engel
        if (ctx.isRemote && _isOccupied(ctx)) {
          return intentResult(intent.type, 'denied', 'remote_vehicle_occupied', 'Araçta kullanıcı var, uzaktan açma engellendi');
        }
        // MAVI-M4: capability kapısı yukarıda geçildi → port GARANTİ var.
        const unlockResult = await _runVehiclePort(intent.type, ctx.hwUnlockDoors!, 'Kapılar açıldı');
        if (unlockResult.status === 'succeeded') {
          showToast({ type: 'success', title: 'Kapılar Açıldı', message: 'Tüm kapılar başarıyla açıldı', duration: 3000 });
        }
        return unlockResult;
      }

      /* Kalan donanım sınıfı — AYNI tek ACK sözleşmesi. Kapı port yokluğunda
       * zaten `unsupported` döndüğü için buraya port GARANTİLİ gelinir; bu
       * yüzden eskiden `default → "Anlayamadım"`a düşen sessiz boşluk KAPANDI. */
      case 'HARDWARE_HORN':
        return _runVehiclePort(intent.type, ctx.hwHonkHorn!, 'Korna çalındı');
      case 'HARDWARE_FLASH':
        return _runVehiclePort(intent.type, ctx.hwFlashLights!, 'Farlar yakıldı');
      case 'HARDWARE_ALARM_ON':
        return _runVehiclePort(intent.type, ctx.hwAlarmOn!, 'Alarm açıldı');
      case 'HARDWARE_ALARM_OFF':
        return _runVehiclePort(intent.type, ctx.hwAlarmOff!, 'Alarm kapatıldı');

      /* ── Uzun-dönem kişisel hafıza ──────────────────────── */
      case 'REMEMBER': {
        // Kullanıcının açıkça istediği kalıcı fact'i sakla. Boş/geçersizse
        // SAHTE ONAY YOK — dürüstçe "neyi hatırlayayım" der.
        const fact = addFact(intent.payload.memoryText ?? '');
        _speak(fact ? 'Tamam, aklımda tutuyorum' : 'Neyi hatırlamamı istersin?', isDriving, _turn);
        break;
      }
      case 'FORGET': {
        const removed = forgetFact(intent.payload.memoryText ?? '');
        _speak(
          removed === 'all' ? 'Hepsini unuttum'
          : removed          ? 'Tamam, unuttum'
          :                    'Öyle bir şey hatırlamıyorum zaten',
          isDriving, _turn,
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
        return intentResult(intent.type, 'not_handled', 'unknown_intent');
      }
    }
  } catch {
    // MAVI-M4: exception BAŞARIYA ÇEVRİLMEZ. Araç etkili eylemde dürüst `failed`
    // sonucu döner (M6 onu tek zarfla söyler); diğerlerinde eski hata sesi korunur.
    if (isVehicleEffectiveIntent(intent.type)) {
      return intentResult(intent.type, 'failed', 'exception');
    }
    _error('Uygulama açılamadı');
    return intentResult(intent.type, 'failed', 'exception');
  }
  /* Araç etkili OLMAYAN intentler (UI · medya · tema · navigasyon) kendi
   * seslendirmelerini yapar ve M3 sözleşmesi dışındadır → `not_handled`. */
  return intentResult(intent.type, 'not_handled', 'legacy_path');
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
): Promise<IntentExecutionResult> {
  const result = await dispatchIntent(intent, ctx);
  /* MAVI-M4-LAB-2: yürütücünün GERÇEK sonucu, kapı kararıyla AYNI turId altında
   * gözlem halkasına yazılır. Tek nokta — `dispatchIntent`in onlarca `return`ü
   * dolaşılmaz. Yalnız araç etkili intentler kaydedilir (defter dışı UI/medya
   * komutları zinciri kirletmez).
   *
   * GİZLİLİK: `result.detail` KAYDEDİLMEZ — içinde gerçek kullanıcı metni vardır
   * (`"${contact.name} aranıyor"` → KİŞİ ADI, araç sağlığı özeti, sensör değeri).
   * Yalnız `status` + makine-okur `reason` alınır. Kayıt fail-soft'tur ve
   * dönüşü DEĞİŞTİRMEZ. */
  if (isVehicleEffectiveIntent(intent.type)) {
    recordMaviActionStage({
      stage:    'result',
      intent:   intent.type,
      actionId: getVehicleActionDef(intent.type)?.actionId ?? null,
      status:   result.status,
      reason:   result.reason ?? '',
    });
  }
  return result;
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
 * - **Sonuç ve çözülen intent ÇAĞIRANA DÖNER** — onay gerektiren eylemlerde
 *   (`needs_confirmation`) çağıran bekleyen eylemi kurabilsin diye.
 */
export interface AIExecutionOutcome {
  /** Çözülen intent — bekleyen onay eylemini kurmak için gerekir. */
  readonly intent: AppIntent;
  readonly result: IntentExecutionResult;
}

export async function executeAIResult(
  result: AIVoiceResult,
  ctx:    CommandContext,
): Promise<AIExecutionOutcome | null> {
  if (result.confidence < 0.45) {
    _error('Anlayamadım');
    return null;
  }

  /* MAVI-M6: JENERİK ÖN-YANKI KALDIRILDI. Eskiden burada `result.feedback`
   * ("Yapılıyor") seslendirilir, hemen ardından `dispatchIntent` case metnini
   * ("Ankara adresine gidiyoruz"), en sonda da `voiceService` beynin feedback'ini
   * söylerdi → tek komutta 2-3 ses. Artık cevabı SONUÇ üreten katman verir; bu
   * katman yalnız yürütür. Hiçbir case konuşmazsa `voiceService` beynin
   * feedback'ini TEK otorite üzerinden söyler (kapsama boşluğu yok). */

  const intent = fromAIResponse(result, result.payload['sourceText'] as string ?? '');
  if (!intent) {
    _error('Anlayamadım');
    return null;
  }

  /* SONUÇ ARTIK YUKARI TAŞINIR (saha 2026-07-31). Eskiden `await dispatchIntent(...)`
   * çağrılıp sonuç ATILIYORDU. Bunun bedeli sadece "sessizlik" değildi: `OPEN_PHONE`
   * gibi ONAY GEREKTİREN eylemler `needs_confirmation` döndürüyor, çağıran bunu
   * göremediği için ne onay sorusunu soruyor ne de bekleyen eylemi kuruyordu →
   * kullanıcı "annemi ara" diyor, beynin iyimser metni "aranıyor" deniyor ama
   * ARAMA HİÇ BAŞLAMIYORDU. Yerel parser yolu bu sonucu zaten tüketiyordu;
   * AI yolu artık AYNI sözleşmeyi kullanır (ikinci otorite YOK). */
  const execResult = await dispatchIntent(intent, ctx);
  return { intent, result: execResult };
}

/**
 * Kayıtlı ses seviyesini dışarıdan güncelle (slider değişimlerinde).
 * commandExecutor'ın iç state'i ile slider'ı senkronize tutar.
 */
export function syncVolume(percent: number): void {
  _currentVolume = Math.max(0, Math.min(100, percent));
}
