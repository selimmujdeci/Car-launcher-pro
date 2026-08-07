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
  decideGuidance, maneuverId,
  type GuidanceStage, type GuidanceDecisionInput,
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
    if (!_rerouteAnnounced) {
      _rerouteAnnounced = true;
      try { speak('Rota yeniden hesaplanıyor'); } catch { /* TTS yoksa sessiz */ }
    }
    return null;
  }
  _state = 'ACTIVE';
  _rerouteAnnounced = false;

  const id = maneuverId(input.sessionId, input.routeRevision, input.stepIndex);
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
}

/** @internal — testler arası izolasyon (sayaçlar dahil). */
export function _resetVoiceGuidanceForTest(): void {
  resetVoiceGuidance('test');
  _spokenCount = 0;
  _duplicateSuppressed = 0;
}
