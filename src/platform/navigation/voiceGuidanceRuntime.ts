/**
 * voiceGuidanceRuntime.ts — sesli yönlendirmenin GÖRÜNÜMDEN BAĞIMSIZ sahibi.
 *
 * ── ÇÖZDÜĞÜ ARIZA (NAVIGATION_DELIVERY_CORE_P0) ─────────────────────────────
 * Kademeli anons `NavigationHUD.tsx` içindeki bir `useEffect`'teydi ve
 * `NavigationHUD` YALNIZ `FullMapView` içinde mount ediliyordu. Sonuç: sürücü
 * mini haritaya döndüğü an **hazırlık · yaklaşma · dönüş anonslarının hepsi
 * susuyordu**. `navigationSessionRuntime` başlığı bu arızanın çözüldüğünü
 * yazıyordu ama motor yalnız store'u güncelliyordu; sesi tetikleyen efekt hâlâ
 * bileşendeydi (belge–kod çelişkisi, bu turda kapatıldı).
 *
 * İkinci arıza: "hangi kademe söylendi" bilgisi bir bileşen ref'iydi. Görünüm
 * kapanıp açılınca sıfırlanıyor ve **aynı manevra ikinci kez** seslendiriliyordu.
 * Artık durum MODÜL düzeyindedir ve `(oturum, rota revizyonu, adım)` üçlüsüyle
 * anahtarlanır.
 *
 * ── SINIRLAR (bilinçli) ─────────────────────────────────────────────────────
 *  · Yeni anons algoritması YOK — eşikler ve metinler `voiceGuidanceModel`de,
 *    eski koddan birebir taşındı.
 *  · Bu modül kendi GPS aboneliğini veya timer'ını KURMAZ. Tek besleyicisi
 *    `navigationSessionRuntime` tick'idir (tek sahiplik kuralı).
 *  · Şerit / dönel kavşak verisi ÜRETMEZ; yoksa hiçbir şey söylemez.
 *  · TTS kuyruğunu yönetmez — `speakNavigation` mevcut kanalı kullanır.
 */

import { speakNavigation } from '../ttsService';
import {
  recordAnnouncementTiming, recordMissedGuidance, resetGuidanceAudit,
} from './core/voiceGuidanceAudit';
import {
  decideGuidance, maneuverId,
  type GuidanceStage, type GuidanceDecisionInput,
  finalTierMetres, FAR_TIER_M, NEAR_TIER_M,
} from './core/voiceGuidanceModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Durum (modül düzeyinde — görünüm ömründen BAĞIMSIZ)
 * ════════════════════════════════════════════════════════════════════════ */

export type VoiceRuntimeState =
  /** Navigasyon aktif ve anonslar bu modülden üretiliyor. */
  | 'ACTIVE'
  /** Navigasyon yok / aktif değil — ses üretilmez. */
  | 'IDLE'
  /** Yeniden rota hesaplanıyor — manevra anonsu bastırılır. */
  | 'REROUTING';

export const VOICE_RUNTIME_STATE_LABEL: Readonly<Record<VoiceRuntimeState, string>> = {
  ACTIVE:    'ETKİN',
  IDLE:      'BOŞTA',
  REROUTING: 'YENİDEN ROTA (bastırıldı)',
} as const;

/** Bir rotada izlenecek azami manevra sayısı — bounded (bellek sızıntısı yok). */
const MAX_TRACKED_MANEUVERS = 64;

/** `maneuverId` → söylenmiş kademe bit maskesi. */
let _spoken = new Map<string, number>();
/** Maskelerin ait olduğu rota kimliği — değişince kuyruk TEMİZLENİR. */
let _routeKey = '';
let _state: VoiceRuntimeState = 'IDLE';
let _lastSpokenManeuverId: string | null = null;
let _lastSpokenStage: GuidanceStage | null = null;
let _spokenCount = 0;
/** Aynı manevra+kademe için bastırılan tekrar sayısı (LAB kanıtı). */
let _duplicateSuppressed = 0;
/** "Rota yeniden hesaplanıyor" anonsu bu reroute turunda söylendi mi. */
let _rerouteAnnounced = false;

/* ── P0-NAV-16 · KAÇIRILAN ANONS ÖLÇÜMÜ ───────────────────────────────────
 * Runtime bugüne kadar yalnız SÖYLENENİ sayıyordu. NAV-16'nın dört sorusundan
 * (çok erken · çok geç · iki kez · HİÇ) yalnız "iki kez" ölçülebiliyordu.
 * Sürücünün gerçekten yaşadığı kusur ise ötekiler: dönüşü kaçırmak, anonsu
 * dönüşün üstünde duymak. Manevra GEÇİLDİĞİNDE (adım indeksi ilerlediğinde)
 * geride bıraktığımız manevra yargılanır. */
/** İzlenen manevranın kimliği ve o manevra boyunca toplanan bağlam. */
let _watchedId: string | null = null;
/** İzlenen manevra boyunca mesafe kaynağı en az bir kez kullanılabildi mi. */
let _watchedHadDistance = false;
/** İzlenen manevra boyunca reroute sürdü mü. */
let _watchedWasRerouting = false;

/** Geride bırakılan manevrayı yargılar ve izlemeyi yeni manevraya taşır. */
function _closeWatchedManeuver(nextId: string | null, nowMs: number): void {
  if (_watchedId !== null && _watchedId !== nextId) {
    recordMissedGuidance(_watchedId, {
      spokenBits: _spoken.get(_watchedId) ?? 0,
      hadUsableDistance: _watchedHadDistance,
      wasRerouting: _watchedWasRerouting,
    }, nowMs);
  }
  if (_watchedId !== nextId) {
    _watchedId = nextId;
    _watchedHadDistance = false;
    _watchedWasRerouting = false;
  }
}

export interface VoiceGuidanceSnapshot {
  readonly state: VoiceRuntimeState;
  /** Ses üretiminin sahibi — görünüm ASLA olamaz. */
  readonly owner: 'NAV_SESSION_RUNTIME';
  readonly lastSpokenManeuverId: string | null;
  readonly lastSpokenStage: GuidanceStage | null;
  readonly spokenCount: number;
  readonly duplicateSuppressed: number;
  /** İzlenen manevra sayısı (bounded). */
  readonly trackedManeuvers: number;
  /** Maskelerin ait olduğu rota anahtarı (`oturum:revizyon`). */
  readonly routeKey: string;
}

/** Senkron okuma — CAROS LAB ve testler için. Yan etkisi YOKTUR. */
export function getVoiceGuidanceSnapshot(): VoiceGuidanceSnapshot {
  return {
    state: _state,
    owner: 'NAV_SESSION_RUNTIME',
    lastSpokenManeuverId: _lastSpokenManeuverId,
    lastSpokenStage: _lastSpokenStage,
    spokenCount: _spokenCount,
    duplicateSuppressed: _duplicateSuppressed,
    trackedManeuvers: _spoken.size,
    routeKey: _routeKey,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tick
 * ════════════════════════════════════════════════════════════════════════ */

export interface VoiceGuidanceTickInput {
  readonly navActive: boolean;
  readonly isRerouting: boolean;
  readonly sessionId: number;
  readonly routeRevision: number;
  readonly stepIndex: number;
  readonly instruction: string;
  readonly distanceM: number;
  readonly distanceSource: GuidanceDecisionInput['distanceSource'];
  readonly speedKmh: number;
}

/** Anons gerçekten yapıldığında çağrılır (test/gözlem için enjekte edilebilir). */
export type SpeakFn = (text: string) => void;
/** İlk yeni talimat damgası — reroute gecikme zincirinin son halkası. */
export type MarkFirstInstructionFn = () => void;

/**
 * Bir ilerleme tick'inde sesli yönlendirmeyi değerlendirir.
 *
 * `navigationSessionRuntime` tarafından, ilerleme güncellendikten SONRA çağrılır.
 * Hem gerçek GPS hem ölü-hesaplama (DR) tick'lerinden gelir — tünelde de
 * yönlendirme sürer.
 *
 * @returns Söylenen anons (test/gözlem) veya `null`.
 */
export function noteVoiceGuidanceTick(
  input: VoiceGuidanceTickInput,
  speak: SpeakFn = speakNavigation,
  markFirstInstruction?: MarkFirstInstructionFn,
): { stage: GuidanceStage; text: string; maneuverId: string } | null {
  /* ── Navigasyon aktif değil → ses YOK, durum temizlenir ─────────────────── */
  if (!input.navActive) {
    if (_state !== 'IDLE') resetVoiceGuidance('navigasyon aktif değil');
    return null;
  }

  /* ── Rota kimliği değişti (yeni hedef veya reroute) → KUYRUK TEMİZLENİR ──
     Eski rotanın "söylendi" maskesi yeni rotada geçerli DEĞİLDİR; taşınırsa
     yeni rotanın ilk manevrası hiç seslendirilmez (eski kodda yaşanan kusur). */
  const routeKey = `${input.sessionId}:${input.routeRevision}`;
  if (routeKey !== _routeKey) {
    _routeKey = routeKey;
    _spoken = new Map();
    _rerouteAnnounced = false;
  }

  /* ── Yeniden rota: manevra anonsu BASTIRILIR, bir kez durum bildirilir ──── */
  if (input.isRerouting) {
    _state = 'REROUTING';
    _watchedWasRerouting = true;
    if (!_rerouteAnnounced) {
      _rerouteAnnounced = true;
      try { speak('Rota yeniden hesaplanıyor'); } catch { /* TTS yoksa sessiz */ }
    }
    return null;
  }
  _state = 'ACTIVE';
  _rerouteAnnounced = false;

  const id = maneuverId(input.sessionId, input.routeRevision, input.stepIndex);
  /* Manevra DEĞİŞTİYSE geride bırakılanı yargıla (kaçırılan anons ölçümü). */
  _closeWatchedManeuver(id, Date.now());
  if (input.distanceSource !== 'UNKNOWN') _watchedHadDistance = true;
  const bits = _spoken.get(id) ?? 0;

  const decision = decideGuidance({
    navActive: true,
    isRerouting: false,
    distanceM: input.distanceM,
    distanceSource: input.distanceSource,
    speedKmh: input.speedKmh,
    instruction: input.instruction,
    spokenBits: bits,
  });

  if (!decision) {
    // Kademe ZATEN söylenmiş olduğu için mi geri döndük? Öyleyse bu bir
    // bastırılmış tekrardır — LAB'da sayılır (dedupe kanıtı).
    if (bits !== 0) _duplicateSuppressed++;
    return null;
  }

  // Bounded: çok uzun rotalarda harita sınırsız büyümesin.
  if (_spoken.size >= MAX_TRACKED_MANEUVERS && !_spoken.has(id)) {
    const oldest = _spoken.keys().next();
    if (!oldest.done) _spoken.delete(oldest.value);
  }
  _spoken.set(id, decision.nextBits);
  _lastSpokenManeuverId = id;
  _lastSpokenStage = decision.stage;
  _spokenCount++;

  /* Anonsun ZAMANLAMASI ölçülür — "çok geç" sınıfı sahada görünür olsun.
     Kademe eşiği kademeye göre değişir; `IMMINENT` hıza bağlıdır. */
  recordAnnouncementTiming(
    id, decision.stage, input.distanceM,
    decision.stage === 'IMMINENT' ? finalTierMetres(input.speedKmh)
      : decision.stage === 'NEAR' ? NEAR_TIER_M
      : FAR_TIER_M,
    Date.now(),
  );

  try { speak(decision.text); } catch { /* TTS yoksa sessiz — navigasyon bozulmaz */ }
  try { markFirstInstruction?.(); } catch { /* ölçüm hatası anonsu bozmaz */ }

  return { stage: decision.stage, text: decision.text, maneuverId: id };
}

/**
 * Oturum bitti / navigasyon durdu → tüm ses durumunu temizle.
 *
 * Böylece bir sonraki navigasyonda ESKİ oturumun anonsları "zaten söylendi"
 * sayılmaz ve süreç yeniden başladıktan sonra geçmiş anonslar TEKRAR OYNATILMAZ
 * (maske boş başlar ama araç zaten manevraya yakınsa yalnız SON kademe söylenir —
 * `decideGuidance` yakın kademede uzaktakileri de kapatır).
 */
export function resetVoiceGuidance(_reason = 'sıfırlandı'): void {
  _spoken = new Map();
  _routeKey = '';
  _state = 'IDLE';
  _lastSpokenManeuverId = null;
  _lastSpokenStage = null;
  _rerouteAnnounced = false;
  /* P0-NAV-16: izlenen manevra da düşer — oturum bitince yarım kalan bir
     manevrayı "kaçırıldı" diye saymak yanlış olurdu (sürücü zaten durdu). */
  _watchedId = null;
  _watchedHadDistance = false;
  _watchedWasRerouting = false;
  /* Yeni oturum: eski yolculuğun anons kusurları yenisine TAŞINMAZ. */
  resetGuidanceAudit();
}

/** @internal — testler arası izolasyon (sayaçlar dahil). */
export function _resetVoiceGuidanceForTest(): void {
  resetVoiceGuidance('test');
  _spokenCount = 0;
  _duplicateSuppressed = 0;
}
