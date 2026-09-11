/**
 * Command Executor — AI intent → native service dispatch merkezi.
 *
 * Akış:
 *   AIVoiceResult → executeAIResult() → dispatchIntent() → bridge / mediaService / …
 *   AppIntent     → executeIntent()  → dispatchIntent()
 *   Bileşik plan  → capabilityPlanRunner → (adım başına) yukarıdaki iki yol
 *                   — MAVI-F13: ayrı bir `executeSequence` yolu YOKTUR.
 *
 * 8-Kelime TTS Kuralı (ISO 15008 / NHTSA §3.4):
 *   Araç hareket halindeyken (isDriving=true) tüm sesli geri bildirimler
 *   ≤ 8 kelimeye kısaltılır. Bu kural sürücü dikkatini korur.
 */

import { bridge, type CommandResult }   from './bridge';
import { fromAIResponse, type AppIntent } from './intentEngine';
import type { AIVoiceResult, VehicleContext } from './aiVoiceService';
/* MAVI-F5: yürütme SONUCUNU capability gözlem seviyesine çevirir. Bu katman
   yeni bir yürütücü ya da ikinci bir gerçeklik kaynağı KURMAZ — yalnız kanonik
   `IntentExecutionResult`ü bounded bir gözlem sınıfına EŞLER ve sayar. */
import { classifyObservation, recordCapabilityObservation } from './capability/fabric/capabilityFabric';
/* MAVI-F7: gözlem katmanı — YÜRÜTME/GÜVENLİK OTORİTESİ DEĞİLDİR. Alan
   otoritelerini (navigasyon hedef defteri · `playbackTruth` · ayar portu)
   OKUR ve "yaptım" iddiasını yalnız KANITA kadar açık tutar. */
import {
  evidenceFromSettingApply, reconcileObservation,
  type DomainEvidence, type SettingApplyEvidence,
} from './capability/observation/observationContract';
import {
  captureObservationBaseline, hasDeferredEvidence, readImmediateEvidence,
  type ObservationBaseline,
} from './capability/observation/observationAdapters';
import {
  OBSERVATION_WINDOW_MS, openPendingObservation, recordReconciliation,
} from './capability/observation/observationLedger';
import { setMaviLatencyCapability } from './assistant/maviLatencyTrace';
import { findByLegacyIntent } from './capability/fabric/carosCapabilityCatalog';
import {
  playWithResult, pauseWithResult, setMediaPreferredPackage,
} from './mediaService';
/* MUSIC F9 ÖLÇÜMÜ: atlama buradan `mediaService`e DOĞRUDAN gidiyordu; bu,
   F7.3'te kurulan KUYRUK-FARKINDA tek girişi atlıyordu (sağlayıcı arama
   listesinde Mavi'nin "sonraki"si `unsupported_capability` ile düşüyordu).
   Artık tek girişten geçer. Statik döngüyü kırmak için dinamik yüklenir. */
async function _queueAwareNext(): Promise<MediaCommandResult> {
  const layer = await import('./media/carosMediaLayer');
  return layer.next('mavi');
}
async function _queueAwarePrevious(): Promise<MediaCommandResult> {
  const layer = await import('./media/carosMediaLayer');
  return layer.previous('mavi');
}
import type { MediaCommandResult } from './mediaService';
import { setVolume }                    from './systemSettingsService';
/* SAHA 2026-08-30 (kütük #1054): ses yüzdesinin KANONİK kaynağı store'dur
 * (`settings.volume`) — ayarlar slider'ı da tam olarak bunu yazar. Modül-yerel
 * `_currentVolume` gölgesi ne cihazla ne store'la senkrondu. */
import { useStore } from '../store/useStore';
import { CarLauncher } from './nativePlugin';
import { isNative } from './bridge';
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
import { readDTCCodes, clearDTCCodes, getClearableDtcSnapshot, onDTCState, type DTCState } from './dtcService';
import { evaluateVehicleDtcVerdict } from './obd/dtcAuthority';
import { querySensor } from './obd/sensorQueryService';
import { getMaintenanceSummaryText } from './vehicleMaintenanceService';
import { openInApp } from './inAppBrowser';
import { applyLiveStyle } from './liveStyleEngine';
import { getWeatherNarrative } from './weatherService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { resolveAppByName } from './appRegistry';
import { resolveScreen } from './screenRegistry';
import { searchContacts, recordCall } from './contactsService';
/* MAVI-F10: hafızanın TEK kanonik cephesi. `companionMemory.addFact/forgetFact`
   ARTIK ÇAĞRILMAZ — o yol hassas-veri kapısından GEÇMİYORDU (ölçülen kusur A)
   ve sildiği kaydı konuşma geçmişinden düşürmüyordu (kusur: unutulan hafıza
   8 tur daha prompt'ta yaşıyordu). */
import { rememberExplicit, forgetMemory } from './assistant/maviMemory';
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
  /**
   * Sesli ayar kontrolü — key/action/value ile AppSettings (veya wifi/bt/brightness).
   *
   * MAVI-F7: port artık NE YAPTIĞINI BİLDİREBİLİR (`SettingApplyEvidence`).
   * Dönüş `void` ise kanıt YOKTUR ve yürütücü "uygulandı" DEMEZ — F5'in açık
   * sahte-ACK borcu (kütük #986/b) burada kapanır. Dönüş tipi geriye
   * uyumludur: kanıt üretmeyen eski bağlantılar aynen çalışır, yalnız
   * DÜRÜSTÇE daha düşük seviyede raporlanır.
   */
  applySetting?: (
    key: string, action: string, value?: string, kind?: string, label?: string,
  ) => SettingApplyEvidence | void;
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
 * **SEMANTİK ACK** ("Araç sistemleri taranıyor") — NİHAİ CEVAP DEĞİLDİR ve
 * BAŞARI İDDİASI DEĞİLDİR: yalnız gerçek ve süren bir işin BAŞLADIĞINI bildirir.
 * Tur başına en fazla bir kez geçer, cevap verildikten sonra hiç konuşmaz.
 *
 * MAVI-F2 (I11): buradan geçen metin NE YAPILDIĞINI SÖYLEMELİDİR. İçeriksiz
 * bekletme cümlesi ("Bakıyorum", "Bir saniye") `maviSpeech` kapısında
 * KONUŞULMADAN düşürülür — ayrım `assistant/maviAckPolicy.ts` içindedir.
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
    /* MUSIC F9 · ÖLÇÜLEN KUSUR: burada `playByQuery` bir parça döndürdüğü anda
       KOŞULSUZ "<başlık> çalınıyor" deniyordu. `playByQuery` yalnız seçimin
       KANONİK hatta gönderildiğini söyler; sesin çıktığını DOĞRULAMAZ. Artık
       niyet kanonik yönlendiriciden geçer ve cümle YALNIZ kanıt derecesine
       göre kurulur (`ACCEPTED_UNVERIFIED` → "çalıyor" DEMEZ).
       Lazy import: statik döngü kırılır. */
    const [{ dispatchMusicIntent }, { makeIntent }, { speakMusicOutcome }] = await Promise.all([
      import('./media/intent/musicIntentRouter'),
      import('./media/intent/musicIntent'),
      import('./media/intent/musicIntentSpeech'),
    ]);
    const outcome = await dispatchMusicIntent(makeIntent('PLAY_QUERY', { query }));
    if (outcome.status !== 'UNAVAILABLE' && outcome.status !== 'NOT_ATTEMPTED') {
      ctx.openDrawer?.('music');         // uygulama-içi çalma ekranını öne getir
      _speak(speakMusicOutcome(outcome), isDriving, _turn);
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
  /* P0-OBD-CORE-03 — SAHTE "TEMİZ" KAPATILDI.
     Eski satır `state.codes.length === 0` → "Araç sistemleri temiz, sorun yok"
     idi. `state.codes` YALNIZ Mode 03'tür; bekleyen (07), kalıcı (0A),
     çoklu-ECU ve üretici (UDS/KWP) bulguları o dizide YOKTUR. Dahası boş dizi
     "okuma yapılmadı"yı da kapsıyordu → ECU sustuğunda da "temiz" deniyordu.
     Hüküm artık TEK kanonik otoriteden gelir. */
  const verdict = evaluateVehicleDtcVerdict();
  if (verdict.verdict !== 'issues' && state.codes.length === 0) {
    return verdict.verdict === 'clean'
      ? 'Araç sistemleri temiz, sorun yok'
      : verdict.message;
  }
  if (state.codes.length === 0) return verdict.message;

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
    /* MUSIC F9 · ÖLÇÜLEN KUSUR: burada "Müzik açılıyor" ve "<başlık> çalınıyor"
       KOŞULSUZ dönüyordu. `resumeLastMedia`/`playByQuery` yalnız komutun
       kanonik hatta GÖNDERİLDİĞİNİ söyler; sesin çıktığını DOĞRULAMAZ.
       Artık iki yol da kanonik niyet yönlendiricisinden geçer ve cümle
       yalnız kanıt derecesinden doğar.
       Lazy import: statik döngü kırılır. */
    const [{ dispatchMusicIntent }, { makeIntent }, { speakMusicOutcome }] = await Promise.all([
      import('./media/intent/musicIntentRouter'),
      import('./media/intent/musicIntent'),
      import('./media/intent/musicIntentSpeech'),
    ]);
    // 1) Kaldığı yer varsa oradan devam.
    const resume = await dispatchMusicIntent(makeIntent('CONTINUE_LISTENING'));
    if (resume.status !== 'UNAVAILABLE' && resume.status !== 'NOT_ATTEMPTED') {
      return speakMusicOutcome(resume);
    }
    // 2) Kaldığı yer yok → gömülü arama tohumuyla kanonik arama yolu.
    const played = await dispatchMusicIntent(
      makeIntent('PLAY_QUERY', { query: EMBEDDED_MUSIC_SEED, evidence: 'DERIVED' }),
    );
    if (played.status !== 'UNAVAILABLE' && played.status !== 'NOT_ATTEMPTED') {
      return speakMusicOutcome(played);
    }
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

/**
 * MAVI-F7 · medya durum komutu (play/pause) için DÜRÜST cevap.
 *
 * `verified` YALNIZ `playbackTruth` `VERIFIED` dediğinde gelir. Doğrulanmamış
 * yolda "başlattım/gönderdim" denir — "çalıyor" DENMEZ.
 */
function _mediaStateReply(
  r: MediaCommandResult, verifiedText: string, acceptedText: string,
): string {
  if (r.verified) return verifiedText;
  if (!r.dispatched) return 'Şu anda çalan bir şey yok.';
  switch (r.failureCode) {
    case 'no_media':
    case 'empty_queue':
      return 'Şu anda çalan bir şey yok.';
    case 'focus_denied':
      return 'Ses odağını alamadım.';
    default:
      /* Gönderildi ama etkisi GÖZLENEMEZ (harici MediaSession · in-app toggle). */
      return `${acceptedText} ama çaldığını doğrulayamıyorum.`;
  }
}

/**
 * MAVI-F7 · TEK ATIŞLIK AYAR KANIDI YUVASI.
 *
 * `SET_SETTING` yürütücüsü kanıtı `dispatchIntent` İÇİNDE üretir; gözlem kaydı
 * ise `executeIntent`/`executeAIResult`ta yapılır. Sözleşmeyi genişletmek
 * yerine (F6'daki `takeLastCapabilityObservation` deseniyle AYNI) tek atışlık
 * bir yuva kullanılır: okunur ve TEMİZLENİR → bayat kanıt başka bir tura
 * bağlanamaz. Yürütme ARDIŞIKTIR; yarış yoktur.
 */
let _pendingSettingEvidence: DomainEvidence | null = null;

function _takeSettingEvidence(): DomainEvidence | null {
  const e = _pendingSettingEvidence;
  _pendingSettingEvidence = null;
  return e;
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
      /* MAVI-F7 · PORT YOKKEN SAHTE ROTA İDDİASI KAPANDI ───────────────────
       * `navigateToPlace` OPSİYONEL bir porttur. Bağlı değilken eski kod
       * yalnız harita uygulamasını açıyor ama yine "… adresine gidiyoruz"
       * diyordu → hedef HİÇ girilmemişken kullanıcı rotanın kurulduğunu
       * duyuyordu. Artık iki yol AYRI konuşur. (Rota isteği asenkrondur; port
       * BAĞLIYKEN bile cümle `ACCEPTED` seviyesindedir — doğrulama iddiası
       * taşımaz. Gerçek kanıt bekleyen gözlemle ölçülür.) */
      case 'NAVIGATE_ADDRESS': {
        const dest = intent.payload.destination;
        if (dest && ctx.navigateToPlace) {
          ctx.navigateToPlace(dest);
          _speak(`${dest} için rota kuruyorum`, isDriving, _turn);
        } else {
          ctx.launch(ctx.defaultNav);
          _speak(dest ? 'Haritayı açtım; hedefi oradan seçmen gerekiyor' : 'Haritayı açtım',
            isDriving, _turn);
        }
        break;
      }
      case 'NAVIGATE_PLACE': {
        const place = intent.payload.destination;
        if (place && ctx.navigateToPlace) {
          ctx.navigateToPlace(place);
          _speak(`${place} aranıyor`, isDriving, _turn);
        } else {
          ctx.launch(ctx.defaultNav);
          _speak(place ? 'Haritayı açtım; yeri oradan arayabilirsin' : 'Haritayı açtım',
            isDriving, _turn);
        }
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
          /* MUSIC F9: `play()` ateşle-unut + KOŞULSUZ "açılıyor" idi. Tek
             medya gerçeği `playbackTruth`tır; cümle artık kanıta bağlı. */
          const openR = await playWithResult();
          ctx.openDrawer?.('music');
          _speak(_mediaStateReply(openR, 'Müzik çalıyor', 'Müziği başlatmayı deniyorum'),
            isDriving, _turn);
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
          const r = await playWithResult();
          ctx.openDrawer?.('music');
          _speak(_mediaStateReply(r, 'Müzik çalıyor', 'Müziği başlatmayı deniyorum'),
            isDriving, _turn);
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
          const r = await playWithResult();
          ctx.openDrawer?.('music');
          _speak(_mediaStateReply(r, 'Müzik çalıyor', 'Müziği başlatmayı deniyorum'),
            isDriving, _turn);
        }
        break;
      }
      case 'ADD_MUSIC_FAVORITE': {
        /* MUSIC F13 · ÖLÇÜLEN KUSUR: bu dal her zaman "desteklenmiyor" diyen
           ölü bir uçtu — kanonik bir favori otoritesi hiç YOKTU. Artık F9
           niyet yönlendiricisinden `musicCollectionAuthority`ye (F13) geçer;
           diğer gömülü müzik dalları (`_playMusicInAppOrFallback` vb.) ile
           AYNI lazy-import + `dispatchMusicIntent` deseni. */
        try {
          const [{ dispatchMusicIntent }, { makeIntent }, { speakMusicOutcome }] = await Promise.all([
            import('./media/intent/musicIntentRouter'),
            import('./media/intent/musicIntent'),
            import('./media/intent/musicIntentSpeech'),
          ]);
          const outcome = await dispatchMusicIntent(makeIntent('ADD_FAVORITE'));
          _speak(speakMusicOutcome(outcome), isDriving, _turn);
        } catch {
          _speak('Bu özellik şu an kullanılamıyor', isDriving, _turn);
        }
        break;
      }
      case 'SET_MUSIC': {
        const appId = intent.payload.targetApp;
        if (appId) ctx.launch(appId);
        _speak('Müzik uygulaması açılıyor', isDriving, _turn);
        break;
      }

      /* ── Medya kontrolü ─────────────────────────────────── */
      /* ── MAVI-F7: "çalıyor/duraklatıldı" ARTIK KANITA BAĞLI ──────────────
       * Eskiden `play()`/`pause()` ateşle-unut çağrılıp KOŞULSUZ "Devam ediyor"
       * / "Duraklatıldı" deniyordu. Oysa tek medya gerçeği `playbackTruth`tır
       * ve o gerçek `VERIFIED` demedikçe komut yalnız GÖNDERİLMİŞTİR.
       * `next()`/`previous()` bu deseni zaten kullanıyordu; play/pause artık
       * AYNI sözleşmeye bağlandı — paralel bir "Mavi medya durumu" KURULMADI. */
      case 'PLAY_MEDIA': {
        const r = await playWithResult();
        _speak(_mediaStateReply(r, 'Devam ediyor', 'Çalmayı başlattım'), isDriving, _turn);
        break;
      }
      case 'PAUSE_MEDIA': {
        const r = await pauseWithResult();
        _speak(_mediaStateReply(r, 'Duraklatıldı', 'Duraklatma komutunu gönderdim'), isDriving, _turn);
        break;
      }
      /* ── Parça atlama — SAHTE ONAY YOK (saha 2026-08-08) ────────────────
       * Eskiden `next()` çağrılıp SONUÇ BEKLENMEDEN "Sonraki parça" deniyordu.
       * Kuyruk boşken / otorite reddettiğinde / harici oturum komutu yutunca
       * hiçbir şey değişmiyor ama asistan değişmiş gibi konuşuyordu.
       * Artık YALNIZ doğrulanmış sonuçta başarı söylenir; aksi hâlde neden
       * söylenir. Yönlendirme ve komut akışı DEĞİŞMEDİ. */
      case 'MEDIA_NEXT': {
        const r = await _queueAwareNext();
        _speak(_mediaSkipReply(r, 'Sonraki parça'), isDriving, _turn);
        break;
      }
      case 'MEDIA_PREV': {
        const r = await _queueAwarePrevious();
        _speak(_mediaSkipReply(r, 'Önceki parça'), isDriving, _turn);
        break;
      }

      /* ── Ses ────────────────────────────────────────────── */
      case 'VOLUME_UP': {
        _currentVolume = await _applyVolumeStep(+1);
        /* `setVolume` bu legacy yolda gözlem döndürmez. İstek gönderildi diye
         * gerçek medya seviyesi değişti denemez (#1047); plan varsa nihai metin
         * yalnız F7 gözleminden gelir. */
        _speak('Ses ayarlama komutunu gönderdim ama sonucu doğrulayamıyorum.', isDriving, _turn);
        break;
      }
      case 'VOLUME_DOWN': {
        _currentVolume = await _applyVolumeStep(-1);
        _speak('Ses ayarlama komutunu gönderdim ama sonucu doğrulayamıyorum.', isDriving, _turn);
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
      /* ── AYAR — MAVI-F7: SAHTE "UYGULANDI" KAPANDI ────────────────────
       * ÖLÇÜLEN KUSUR (F5 borcu, kütük #986/b): `ctx.applySetting` OPSİYONEL
       * bir porttu ve `void` dönüyordu; yürütücü port BAĞLI OLMASA BİLE
       * koşulsuz "Ayar uygulandı" diyordu. Yani hiçbir şey olmadığı hâlde
       * kullanıcı ayarın değiştiğini duyuyordu.
       * Artık iddia KANITA bağlıdır: `APPLIED` = depoya yazıldı ve GERİ
       * OKUNDU · `DELIVERED` = gönderildi ama kanıt yok · `SURFACE_OPENED` =
       * yalnız ekran açıldı, ayar UYGULANMADI · port yok/`REJECTED` = dürüst
       * başarısızlık. Kanıt üretmeyen porta SAHTE başarı EKLENMEDİ. */
      case 'SET_SETTING': {
        const applied = ctx.applySetting?.(
          intent.payload.settingKey ?? '',
          intent.payload.settingAction ?? '',
          intent.payload.settingValue,
          intent.payload.settingKind,
        );
        const ev: SettingApplyEvidence | null = applied ?? null;
        _pendingSettingEvidence = evidenceFromSettingApply(ev);
        if (!ev) {
          return intentResult(intent.type, 'failed', 'setting_port_missing',
            'Ayarı uygulayamadım.');
        }
        switch (ev.kind) {
          case 'APPLIED':
            return intentResult(intent.type, 'succeeded', 'setting_readback', 'Ayar uygulandı');
          case 'DELIVERED':
            /* §12.3 `TRANSPORT_ACK` satırı: gönderdim, olduğunu göremiyorum. */
            return intentResult(intent.type, 'started', 'setting_unverified',
              'Komutu gönderdim ama uygulandığını doğrulayamıyorum.');
          case 'SURFACE_OPENED':
            return intentResult(intent.type, 'started', 'setting_surface_only',
              'Ayarlar ekranını açtım; bunu oradan seçmen gerekiyor.');
          default:
            return intentResult(intent.type, 'failed', 'setting_rejected',
              'Ayarı değiştiremedim.');
        }
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
        /* P0-OBD-10: envanter YALNIZ Mode 03'e bakmaz — BEKLEYEN (Mode 07) kod da
           silinebilir. Eskiden burada `_getDTCSnapshot().codes` (yalnız onaylanmış)
           okunuyordu; bekleyen-yalnız araçta sesli komut "temizlenecek kod yok"
           diyor ve ECU'ya HİÇ komut göndermiyordu. */
        if (getClearableDtcSnapshot().count === 0) {
          return intentResult(intent.type, 'succeeded', 'nothing_to_clear', 'Temizlenecek arıza kodu yok');
        }
        // OBD-OS-F0-6: sesli komut da WriteGate'ten GEÇER — seyir halinde ECU'ya yazılmaz.
        // Sesli istek açık kullanıcı talebidir (confirmed), ama hız/tazelik kapıları geçerli.
        // SAHTE ONAY YASAK: silinmediyse "silindi" DENMEZ — kapının sebebi söylenir.
        _speakProgress('Arıza kayıtları siliniyor', isDriving, _turn);   // ara bilgi — nihai cevap WriteGate sonucu
        // Onay MAVI-M4 kapısında alındı (`ctx.actionConfirmed`); WriteGate fiziksel
        // önkoşulları (bağlantı · tazelik · hız) AYRICA denetler — bypass YOK.
        /* ARCH-05: sesli asistan KENDİ sınıfıyla çağırır. `MAVI` principal'ının
           CLEAR_DTC yetkisi YOKTUR (yetki tablosu `security/enforcement.ts`);
           LLM metni ya da onaylanmış bir niyet bu yetkiyi ÜRETEMEZ. Varsayılana
           (`LOCAL_UI`) yaslanmak sessizce ayrıcalık kazanmak olurdu. */
        const clearResult = await clearDTCCodes({
          confirmed: true, principal: 'MAVI',
          operationId: `mavi.dtc.clear:${Date.now()}`,
        });
        if (!clearResult.allowed) {
          return intentResult(intent.type, 'denied', 'write_gate_denied', clearResult.userMessage);
        }
        /* P0-OBD-10 — SAHTE ONAY KAPATILDI. Eskiden burada kapı izin verdiyse
           koşulsuz "Arıza kayıtları silindi" deniyordu: ECU reddetse, sussa veya
           kod anında geri gelse bile sesli asistan "silindi" diyordu. Artık
           konuşulan cümle ÖLÇÜLEN hükümden gelir (tek metin kaynağı: dtcClearModel). */
        const clearReport = clearResult.clear ?? null;
        if (clearReport === null) {
          // Web/demo yolu — gerçek araç yok; ölçüm de yok, iddia da yok.
          return intentResult(intent.type, 'succeeded', 'dtc_cleared', 'Arıza kayıtları silindi');
        }
        return clearReport.success
          ? intentResult(intent.type, 'succeeded', 'dtc_cleared', clearReport.userMessage)
          : intentResult(intent.type, 'failed', `dtc_clear_${clearReport.verdict.toLowerCase()}`, clearReport.userMessage);
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
        /* MAVI-F2: SEMANTİK ACK — sorulan sensörün ADINI taşır ("yağ sıcaklığı
         * okunuyor"), böylece kullanıcı Mavi'nin NEYİ okuduğunu duyar. Değer
         * İDDİA EDİLMEZ; gerçek değer aşağıda `querySensor`dan gelir. */
        _speakProgress(`${sensorQuery} okunuyor`, isDriving, _turn);
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
        /* MAVI-F10 · AÇIK BEYAN. Dört dürüstlük kuralı:
         *  1. Boş/geçersiz → SAHTE ONAY YOK.
         *  2. Hassas veri (telefon · plaka · VIN · IBAN · e-posta · konum) →
         *     kapı REDDEDER ve bu AÇIKÇA söylenir. F10 öncesi bu kapı canlı
         *     yolda HİÇ YOKTU; böyle bir cümle kalıcı depoya ve HER prompt'a
         *     giriyordu.
         *  3. Depoya GERÇEKTEN yazılamadıysa "hatırladım" DENMEZ.
         *  4. Mevcut bir kayıtla ÇELİŞİYORSA kör silme yapılmaz — çelişki
         *     kullanıcıya bildirilir (eski kayıt işaretlenir, durur). */
        const result = rememberExplicit(intent.payload.memoryText ?? '', Date.now());
        _speak(
          result.outcome === 'empty'              ? 'Neyi hatırlamamı istersin?'
          : result.outcome === 'rejected_sensitive' ? 'Bunu hafızama alamam; kişisel/hassas bilgi içeriyor.'
          : result.outcome === 'not_persisted'    ? 'Şu an hafızama yazamadım, kaydedemedim.'
          : result.contradicts                    ? 'Tamam, not ettim. Bu daha önce söylediğinle çelişiyor; hangisi geçerli?'
          :                                         'Tamam, aklımda tutuyorum',
          isDriving, _turn,
        );
        break;
      }
      case 'FORGET': {
        /* MAVI-F10: unutma artık YALNIZ kalıcı deponun değil, aktif yolculuk
         * hafızasının ve KONUŞMA GEÇMİŞİNİN de temizlenmesidir — aksi hâlde
         * "unuttum" dedikten sonra aynı bilgi 8 tur daha prompt'ta yaşıyordu.
         * Geçmiş temizleme portu bağlı değilse bu AÇIKÇA söylenir. */
        const result = forgetMemory(intent.payload.memoryText ?? '', Date.now());
        const touched = result.removed + result.tripRemoved;
        _speak(
          !result.persisted && touched > 0 ? 'Sildim ama kalıcı olarak kaydedemedim, tekrar dener misin?'
          : result.all && touched > 0      ? 'Hepsini unuttum'
          : touched > 0                    ? 'Tamam, unuttum'
          :                                  'Öyle bir şey hatırlamıyorum zaten',
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
 * MAVI-F5 · GÖZLEM KAYDI — "yaptım" iddiasının TEK kaynağı.
 *
 * Katalogdaki `observationCeiling` burada uygulanır: yürütücü `succeeded` dese
 * bile, o işlemin başarısını DOĞRULAYAN bir kanıt yoksa (tavan `ACCEPTED`)
 * gözlem `ACCEPTED` olarak kaydedilir — sistem doğrulayamadığı bir şeye
 * "doğrulandı" DEMEZ. Katalog dışı intent kaydedilmez (kapsam ölçümü dürüst
 * kalsın; sahte kapsama üretilmez).
 *
 * PII: yalnız intent adı ve bounded enum kaydedilir; `result.detail`
 * (gerçek kullanıcı metni · sensör değeri · kişi adı) ASLA taşınmaz.
 */
function _recordCapabilityOutcome(
  intentType: string, status: string,
  baseline: ObservationBaseline | null, turnId: string | null,
): void {
  try {
    const settingEvidence = _takeSettingEvidence();
    const def = findByLegacyIntent(intentType);
    if (!def) return;
    const base = classifyObservation(status, def.observationCeiling);

    /* MAVI-F7 · UZLAŞTIRMA. Taban yürütücünün kendi beyanıdır; BAĞIMSIZ kanıt
     * varsa o kazanır. Kanıt yoksa/bayatsa taban AYNEN kalır — uydurulmaz. */
    const evidence: DomainEvidence = baseline
      ? readImmediateEvidence(def, baseline, settingEvidence)
      : (settingEvidence ?? readImmediateEvidence(def, { atMs: 0, navChangeCount: -1, mediaCommandCount: -1 }, null));
    const reconciled = reconcileObservation({
      base, evidence, ceiling: def.observationCeiling,
    });
    recordReconciliation(reconciled);
    recordCapabilityObservation(reconciled.level);
    setMaviLatencyCapability({ observation: reconciled.level });

    /* Kanıtı GECİKMELİ gelen alan (navigasyon: geocode → rota) → bekleyen
     * gözlem açılır. Bu kayıt SÖYLENMİŞ CÜMLEYİ DEĞİŞTİRMEZ; yalnız "rota
     * gerçekten kuruldu mu" sorusunu ölçülebilir kılar ve süre dolarsa
     * `UNKNOWN` kapanır (zaman aşımı ASLA başarı olmaz). */
    if (baseline && hasDeferredEvidence(def.domain) && reconciled.level !== 'FAILED'
        && reconciled.level !== 'CANCELLED' && reconciled.level !== 'REQUESTED') {
      openPendingObservation({
        key: `${def.capabilityId}#${def.operation}`,
        capabilityId: def.capabilityId,
        operation: def.operation,
        domain: def.domain,
        ceiling: def.observationCeiling,
        turnId,
        requestedAtMs: baseline.atMs,
        deadlineMs: baseline.atMs + OBSERVATION_WINDOW_MS,
        baseline: baseline.navChangeCount,
        base: reconciled.level,
      }, baseline);
    }
  } catch { /* fail-soft: gözlem kaydı yürütmeyi ETKİLEMEZ */ }
}

/**
 * Tek bir AppIntent'i çalıştır.
 * intentEngine.routeIntent() yerine bu fonksiyon kullanılabilir;
 * TTS geri bildirimi ve hata yönetimini otomatik sağlar.
 */
/**
 * MAVI-M4-LAB-2: yürütücünün GERÇEK sonucunu, kapı kararıyla AYNI `actionId`
 * altında gözlem halkasına yazar — TEK yazıcı, `executeIntent` VE
 * `executeAIResult` bunu çağırır (ikinci bir kopya AÇILMAZ).
 *
 * SAHA 2026-09-11 (CAROS LAB · gerçek cihaz): `executeAIResult` bu kaydı
 * HİÇ yapmıyordu — `dispatchIntent`i DOĞRUDAN çağırıp sonucu yukarı
 * taşıyordu, `stage:'result'` yazımını ATLIYORDU. Sonuç: AI-yönlendirmeli
 * turlarda (`companion_action`/`companion_gateway` rotası) `gate:allowed`
 * kaydı hiçbir zaman eşleşen bir sonuca kavuşmuyordu → forensic anomali
 * `ACTION_DISPATCH_NO_RESULT` (`dispatchWithoutResult=2`, ikisi de
 * `phone.call.start`) ölçüldü. Yalnız DETERMİNİSTİK yoldan (`executeIntent`,
 * `useVoiceCommandHandler`) gelen komutlar kayıt bırakıyordu — iki dispatch
 * yolu AYNI telemetri sözleşmesini paylaşmıyordu.
 *
 * Yalnız araç etkili intentler kaydedilir (defter dışı UI/medya komutları
 * zinciri kirletmez). GİZLİLİK: `result.detail` KAYDEDİLMEZ — içinde gerçek
 * kullanıcı metni vardır (`"${contact.name} aranıyor"` → KİŞİ ADI, araç
 * sağlığı özeti, sensör değeri). Yalnız `status` + makine-okur `reason`
 * alınır. Kayıt fail-soft'tur ve dönüşü DEĞİŞTİRMEZ.
 */
function _recordVehicleActionResult(intent: AppIntent, result: IntentExecutionResult): void {
  if (!isVehicleEffectiveIntent(intent.type)) return;
  recordMaviActionStage({
    stage:    'result',
    intent:   intent.type,
    actionId: getVehicleActionDef(intent.type)?.actionId ?? null,
    status:   result.status,
    reason:   result.reason ?? '',
  });
}

export async function executeIntent(
  intent: AppIntent,
  ctx:    CommandContext,
): Promise<IntentExecutionResult> {
  /* MAVI-F7: alan tabanı YÜRÜTMEDEN ÖNCE alınır. Sonradan bakıp "defterde
     kayıt var" demek hiçbir şey kanıtlamaz — o kayıt önceki turdan kalmış
     olabilir. Kanıt yalnız TABANIN ÜSTÜNE eklenen ve bu isteğin damgasından
     SONRA üretilen kayıtlardan okunur. */
  const _baseline = captureObservationBaseline(Date.now());
  const result = await dispatchIntent(intent, ctx);
  _recordVehicleActionResult(intent, result);
  _recordCapabilityOutcome(intent.type, result.status, _baseline, ctx.turn?.id != null ? String(ctx.turn.id) : null);
  return result;
}

/* ── MAVI-F13 · `executeSequence` KALDIRILDI (ölü ÜÇÜNCÜ bileşik yürütücü) ──
 *
 * Silme kanıtı (2026-08-29 statik tarama):
 *   · üretim çağıranı: **0** (yalnız kendi tanımı ve doküman satırları)
 *   · test çağıranı:   **0**
 *   · kanonik karşılığı VAR: `capability/fabric/capabilityPlan` +
 *     `capabilityPlanRunner` (ardışık · stale kapılı · onay kapılı · gözlemli)
 *
 * Neden yalnız "ölü kod" değil, aynı zamanda YANLIŞ bir sözleşmeydi:
 * `Promise.all` ile PARALEL dağıtım audio focus'u, tek onay slotunu ve
 * tek-cevap sözleşmesini aynı anda zorlar; ne gözlem yazar ne de tur kapısı
 * uygular. Canlanması hâlinde F6/F7 invaryantlarını sessizce delerdi.
 * Geri dönüş: git geçmişi + kanonik plan yolu (`runCapabilityPlan`).
 */

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
  const _baseline = captureObservationBaseline(Date.now());
  const execResult = await dispatchIntent(intent, ctx);
  /* SAHA 2026-09-11: bu yol eskiden `_recordVehicleActionResult` çağırmıyordu
     — bkz. o fonksiyonun başındaki not. `executeIntent` ile AYNI otorite. */
  _recordVehicleActionResult(intent, execResult);
  _recordCapabilityOutcome(intent.type, execResult.status, _baseline, ctx.turn?.id != null ? String(ctx.turn.id) : null);
  return { intent, result: execResult };
}

/**
 * Kayıtlı ses seviyesini dışarıdan güncelle (slider değişimlerinde).
 * commandExecutor'ın iç state'i ile slider'ı senkronize tutar.
 */
export function syncVolume(percent: number): void {
  _currentVolume = Math.max(0, Math.min(100, percent));
}

/**
 * Ses yüzdesini KANONİK kaynaktan (store `settings.volume`) okuyup delta uygular.
 *
 * ── SAHA 2026-08-30 · GERÇEK CİHAZDA ÖLÇÜLEN KUSUR (kütük #1054) ──────────────
 * Eskiden `_currentVolume` modül düzeyinde **60 ile başlıyor** ve üretimde
 * HİÇBİR ŞEY onu beslemiyordu (`syncVolume` dışa veriliyor ama çağıran YOK —
 * "bilgi var, besleyen yok"). Sonuç: cihaz gerçekte 11/15 (≈%73) iken JS %60
 * sanıyordu; *"sesi artır"* 70'e çıkıp `round(70/100*15) = 11` yazıyordu ve
 * **hiçbir şey değişmiyordu** — gerçek seviye daha yüksekse sesi DÜŞÜRÜRDÜ.
 * Cihazda ölçüldü: `dumpsys audio streamVolume` 11 → 11 (55 örnek).
 *
 * Artık taban store'dan gelir (slider'ın yazdığı AYNI alan) ve sonuç store'a
 * geri yazılır → slider ile sesli komut aynı gerçeği paylaşır. İkinci bir ses
 * otoritesi KURULMAZ; `setVolume` yine tek uygulama yoludur.
 */
/**
 * Ses seviyesini CİHAZIN GERÇEK değerinden okuyup **index uzayında** ±1 adım
 * değiştirir; sonucu tek uygulama yolundan (`setVolume`, yüzde) yazar ve
 * store'u senkronlar.
 *
 * ── SAHA 2026-08-30 · GERÇEK CİHAZDA ÖLÇÜLEN KUSUR (kütük #1054) ──────────────
 * İki ayrı kusur üst üste biniyordu:
 *  1. **Okuma yoktu.** `_currentVolume` modül düzeyinde %60 ile başlıyor ve
 *     üretimde hiçbir şey onu beslemiyordu (`syncVolume` çağıransız). Cihaz
 *     11/15 (≈%73) iken JS %60 sanıyordu.
 *  2. **Yüzde uzayı kayıplı.** 15 adımda her adım ≈%6,7; ±%10'luk delta
 *     `round(p/100*15)` sonrası çoğu zaman AYNI index'e düşüyordu →
 *     `dumpsys audio streamVolume` 11 → 11 (55 örnek, iki ayrı derlemede).
 *
 * Çözüm: gerçek `value/max` okunur, index ±1 adım kaydırılır, yüzdeye çevrilip
 * MEVCUT tek yoldan (`setVolume`) uygulanır. Yeni ses otoritesi KURULMAZ.
 * Native okuma başarısızsa store tabanına düşülür (fail-soft) — sessizce
 * yanlış bir taban UYDURULMAZ.
 */
async function _applyVolumeStep(step: number): Promise<number> {
  let percent: number | null = null;
  if (isNative) {
    try {
      const r = await CarLauncher.getVolume();
      if (r && Number.isFinite(r.value) && Number.isFinite(r.max) && r.max > 0) {
        const nextIdx = Math.max(0, Math.min(r.max, r.value + step));
        percent = Math.round((nextIdx * 100) / r.max);
      }
    } catch { /* okunamadı → store tabanına düş */ }
  }
  if (percent === null) {
    let base = _currentVolume;
    try {
      const v = useStore.getState().settings.volume;
      if (typeof v === 'number' && Number.isFinite(v)) base = v;
    } catch { /* fail-soft */ }
    percent = Math.max(0, Math.min(100, base + step * 10));
  }
  setVolume(percent);
  try { useStore.getState().updateSettings({ volume: percent }); } catch { /* fail-soft */ }
  return percent;
}
