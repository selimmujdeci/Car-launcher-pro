/**
 * maviWorkload.ts — **MAVİ F8 · SÜRÜŞ İŞ YÜKÜ FARKINDALIĞI.**
 *
 * ── NE ÇÖZER ────────────────────────────────────────────────────────────────
 * Bugüne kadar Mavi'nin iletişim yoğunluğunu belirleyen TEK sinyal
 * `VehicleContext.isDriving` boolean'ıydı: ya 8 kelime ya sınırsız. Arada hiçbir
 * şey yoktu — yaklaşan bir kavşakta da, boş otoyolda da, park hâlinde de aynı
 * politika uygulanıyordu. F8 bunu **bounded bir durum modeline** çevirir:
 *
 *   LOW · NORMAL · ELEVATED · HIGH · CRITICAL · UNKNOWN
 *
 * ── NE DEĞİLDİR (pazarlıksız sınırlar) ──────────────────────────────────────
 *  · **SAFETY AUTHORITY DEĞİLDİR.** Hiçbir güvenlik kararı vermez; gerçek
 *    kapılar (`maviActionAuthority` · `AiSafetyGate` · `obd/writeGate`) bu
 *    modülü OKUMAZ ve okumamalıdır.
 *  · **ARACI KONTROL ETMEZ · NAVİGASYON KARARINI DEĞİŞTİRMEZ.** Rota, sesli
 *    yönlendirme ve audio arbitration otoriteleri AYNEN kalır.
 *  · **CAPABILITY KAPATMAZ.** Kullanıcının açık komutu HER seviyede yürür;
 *    kısılan yalnız Mavi'nin KENDİ konuşma bütçesidir.
 *  · **PRESENCE (F1) İLE KARIŞTIRILMAZ.** Yol Arkadaşı ON/OFF kişiliktir;
 *    workload AYRI eksendir. Companion ON + HIGH = yetenekler açık, gereksiz
 *    sohbet kapalı. Companion OFF + LOW = tam yetenekli asistan.
 *  · **YALNIZ TAVAN KOYAR, GEVŞETMEZ.** Mevcut ISO 15008 sürüş kısıtı
 *    (`trimForDriving`, ≤8 kelime) yerinde kalır; workload onu ASLA açmaz.
 *  · **LLM SEVİYEYİ BELİRLEYEMEZ.** Seviye yalnız bu saf çözümleyiciden ve
 *    yalnız MEVCUT kanıtlardan doğar; model çıktısı girdi DEĞİLDİR.
 *
 * ── UNKNOWN POLİTİKASI (bilinçli ve kilitli) ────────────────────────────────
 * `UNKNOWN` **NORMAL ile aynı bütçeyi** alır. Gerekçe: iletişim politikası bir
 * güvenlik otoritesi değildir ve `unknown`da Mavi'yi susturmak, OBD'si olmayan
 * (yani sahadaki çoğu) head unit'te asistanı sessizce sakat bırakırdı —
 * karşılığında hiçbir güvenlik kazancı olmadan. Gerçek fail-closed davranış
 * ZATEN eylem kapılarındadır (`motionState:'unknown'` riskli eylemi açmaz).
 * `UNKNOWN`ın dürüstlük yükümlülüğü şudur: **LOW olduğunu İDDİA ETMEZ**, ayrı
 * raporlanır ve ölçülür.
 *
 * ── SAFLIK ──────────────────────────────────────────────────────────────────
 * Çözümleyici SAFTIR: I/O · timer · `Date.now` · store importu YOK. Canlı okuma
 * DI ile kaydedilen tek adaptördedir (`maviWorkloadSource`) — `maviVehicleContext`
 * ve `assistantSafetyKernel` ile BİREBİR aynı desen.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Eşikler — hepsi MEVCUT, gerekçelendirilmiş değerlerin AYNASIDIR
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * "Manevra yakın" sınırı (m). `hazardService.calculateDriverAttentionBudget`
 * içindeki `distToTurnM < 200` eşiğinin AYNASIDIR — yeni bir keyfi sayı
 * ÜRETİLMEDİ; repo bu mesafeyi zaten "dikkat bütçesi düşer" sınırı sayıyor.
 */
export const MAVI_WORKLOAD_MANEUVER_M = 200;

/**
 * "Hızlı seyir" sınırı (km/h). `hazardService`in otoyol tespitiyle
 * (`adım hızı > 70 km/h → otoyol benzeri`) AYNI değerdir.
 */
export const MAVI_WORKLOAD_FAST_KMH = 70;

/** ELEVATED/UNKNOWN üstü seviyelerde ek kelime tavanı. */
export const MAVI_WORKLOAD_SHORT_WORDS = 24;

/**
 * HIGH/CRITICAL kelime tavanı — `maviSpeech.MAVI_DRIVING_MAX_WORDS` ile AYNI
 * değerdir (ISO 15008). Burada tekrar TANIMLANMAZ, çağıran ikisinin KÜÇÜĞÜNÜ
 * uygular; bu sabit yalnız bütçe tablosunun okunabilirliği içindir.
 */
export const MAVI_WORKLOAD_MINIMAL_WORDS = 8;

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/** Sürüş iş yükü — BOUNDED. `UNKNOWN` bir seviye değil, kanıt yokluğudur. */
export type MaviWorkloadLevel =
  | 'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

/**
 * Hükmü DOĞURAN kanıt — bounded kod kümesi. Serbest metin YOK, ölçüm YOK
 * (hız değeri · mesafe · konum bu kümeye GİRMEZ).
 */
export type MaviWorkloadEvidence =
  /** Geri vites etkin (`useSystemStore.isReverseActive`). */
  | 'reverse_active'
  /** `assistantSafetyKernel` kritik severity bildirdi. */
  | 'safety_critical'
  /** Bilişsel motor CRITICAL/LIMP_HOME seviyesinde. */
  | 'cognitive_critical'
  /** Bilişsel motor PROTECTION seviyesinde. */
  | 'cognitive_protection'
  /** Rehberlik aktif ve bir sonraki manevra yakın. */
  | 'maneuver_near'
  /** Rehberlik (ACTIVE/REROUTING) sürüyor. */
  | 'guidance_active'
  /** Doğrulanmış hareket + hızlı seyir. */
  | 'motion_fast'
  /** Doğrulanmış hareket. */
  | 'motion_moving'
  /** Doğrulanmış duruş. */
  | 'motion_stopped'
  /** Hiçbir kanıt okunamadı. */
  | 'no_evidence';

/** Bilişsel motorun bounded özeti — store `MODE_RANK` bu katmana SIZMAZ. */
export type MaviCognitiveLoad = 'normal' | 'protection' | 'critical';

/**
 * Çözümleyicinin SAF girdisi. Her alan MEVCUT bir otoriteden gelir; `null`
 * "bu kaynak bu an bilgi vermiyor" demektir — sıfır/false DEĞİL.
 *
 * ⚠️ **Telefon görüşmesi alanı YOKTUR.** Denetim ölçtü: repoda üretimde
 * telefon çağrı durumu üreten hiçbir kaynak yok (`DuckReason 'PHONE'` tanımlı
 * ama üretimde `duck('PHONE')` çağıran YOK; native telephony dinleyicisi de
 * yok). Olmayan sinyal UYDURULMAZ — bu bir açık borçtur, sahte alan değil.
 */
export interface MaviWorkloadSnapshot {
  /** `maviVehicleContext` üç durumlu hareket hükmü. */
  readonly motionState: 'moving' | 'stopped' | 'unknown';
  /** Doğrulanmış hız (km/h). `null` = bilinmiyor (0 DEĞİL). */
  readonly speedKmh: number | null;
  /** Geri vites. `null` = canlı kaynak yok. */
  readonly reverseActive: boolean | null;
  /** `navigationService.isGuidanceActive` — önizleme rehberlik DEĞİLDİR. */
  readonly guidanceActive: boolean | null;
  /** Bir sonraki manevraya mesafe (m). `null` = bilinmiyor. */
  readonly maneuverDistanceM: number | null;
  /** Mesafenin nasıl bulunduğu — `UNKNOWN` kanıt SAYILMAZ. */
  readonly maneuverDistanceSource: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN' | null;
  /** `assistantSafetyKernel.evaluatePreGate().severity === 'critical'`. */
  readonly safetyCritical: boolean | null;
  /** Bilişsel motorun bounded özeti. `null` = okunamadı. */
  readonly cognitiveLoad: MaviCognitiveLoad | null;
}

/** Çözümleyici hükmü — SAF VERİ, dondurulmuş. */
export interface MaviWorkloadVerdict {
  readonly level: MaviWorkloadLevel;
  /** Hükmü doğuran kanıtlar (sıralı, bounded, tekrarsız). */
  readonly evidence: readonly MaviWorkloadEvidence[];
  /** Hükmün üretildiği an (çağıran verir). */
  readonly resolvedAtMs: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF çözümleyici
 * ════════════════════════════════════════════════════════════════════════ */

function _finite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Manevra kanıtı GEÇERLİ mi (kaynak `UNKNOWN` ise kanıt SAYILMAZ). */
function _maneuverNear(s: MaviWorkloadSnapshot): boolean {
  if (s.guidanceActive !== true) return false;
  const src = s.maneuverDistanceSource;
  if (src !== 'ALONG_ROUTE' && src !== 'STRAIGHT_LINE') return false;
  const d = _finite(s.maneuverDistanceM);
  if (d === null || d < 0) return false;
  /* `STRAIGHT_LINE` virajda KISA çıkar → manevra "daha yakın" görünür ve Mavi
   * daha erken susar. Hata yönü GÜVENLİ taraftadır, bu yüzden kabul edilir;
   * `UNKNOWN` ise kanıt değildir ve reddedilir (uydurma yakınlık YOK). */
  return d <= MAVI_WORKLOAD_MANEUVER_M;
}

/**
 * Snapshot → workload hükmü. **SAF · throw ETMEZ · `Date.now` OKUMAZ.**
 *
 * Karar sırası (ilk eşleşme kazanır — en kısıtlayıcıdan en serbeste):
 *  1. **CRITICAL** — geri manevra · kritik güvenlik durumu · bilişsel CRITICAL.
 *  2. **HIGH** — bilişsel PROTECTION · yakın manevra · hızlı seyir.
 *  3. **ELEVATED** — doğrulanmış hareket ya da süren rehberlik.
 *  4. **NORMAL** — doğrulanmış duruş + rota açık (yolculuk sürüyor, araç durdu).
 *  5. **LOW** — doğrulanmış duruş, rehberlik yok.
 *  6. **UNKNOWN** — kanıt yok. LOW İDDİA EDİLMEZ.
 */
export function resolveMaviWorkload(
  snapshot: MaviWorkloadSnapshot | null | undefined,
  nowMs: number,
): MaviWorkloadVerdict {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const s = snapshot ?? null;
  if (!s) {
    return Object.freeze({
      level: 'UNKNOWN' as const,
      evidence: Object.freeze(['no_evidence' as const]),
      resolvedAtMs: now,
    });
  }

  const ev: MaviWorkloadEvidence[] = [];
  const verdict = (level: MaviWorkloadLevel): MaviWorkloadVerdict => Object.freeze({
    level,
    evidence: Object.freeze(ev.length > 0 ? [...ev] : ['no_evidence' as const]),
    resolvedAtMs: now,
  });

  /* ── 1 · CRITICAL ─────────────────────────────────────────────────────── */
  if (s.reverseActive === true) ev.push('reverse_active');
  if (s.safetyCritical === true) ev.push('safety_critical');
  if (s.cognitiveLoad === 'critical') ev.push('cognitive_critical');
  if (ev.length > 0) return verdict('CRITICAL');

  /* ── 2 · HIGH ─────────────────────────────────────────────────────────── */
  if (s.cognitiveLoad === 'protection') ev.push('cognitive_protection');
  if (_maneuverNear(s)) ev.push('maneuver_near');
  const speed = _finite(s.speedKmh);
  if (s.motionState === 'moving' && speed !== null && speed >= MAVI_WORKLOAD_FAST_KMH) {
    ev.push('motion_fast');
  }
  if (ev.length > 0) return verdict('HIGH');

  /* ── 3 · ELEVATED ─────────────────────────────────────────────────────── */
  if (s.motionState === 'moving') ev.push('motion_moving');
  if (s.guidanceActive === true) ev.push('guidance_active');
  /* Duruş KANITI varsa ELEVATED denmez — o durum aşağıda NORMAL/LOW olarak
   * ayrışır (kırmızı ışıkta rota açık olması yüksek iş yükü DEĞİLDİR). */
  if (ev.length > 0 && s.motionState !== 'stopped') return verdict('ELEVATED');

  /* ── 4/5 · NORMAL · LOW ───────────────────────────────────────────────── */
  if (s.motionState === 'stopped') {
    ev.push('motion_stopped');
    /* Rota açıkken duruş "yolculuk sürüyor" demektir (kırmızı ışık · trafik) —
     * tam sohbet serbesttir ama LOW değildir. */
    return verdict(s.guidanceActive === true ? 'NORMAL' : 'LOW');
  }

  /* ── 6 · UNKNOWN ──────────────────────────────────────────────────────── */
  return verdict('UNKNOWN');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Cevap bütçesi (response policy)
 * ════════════════════════════════════════════════════════════════════════ */

/** Bütçenin bounded sınıfı — telemetri/LAB etiketi. */
export type MaviResponseBudgetClass = 'FULL' | 'SHORT' | 'MINIMAL' | 'ESSENTIAL_ONLY';

/**
 * Workload → konuşma bütçesi.
 *
 * **Bu bütçe yalnız MAVİ'NİN KENDİ KONUŞMASINI sınırlar.** Komut yürütme,
 * capability çözümleme, güvenlik uyarısı ve navigasyon anonsu KAPSAM DIŞIDIR.
 */
export interface MaviResponseBudget {
  readonly level: MaviWorkloadLevel;
  readonly klass: MaviResponseBudgetClass;
  /** Ek kelime tavanı. `null` = ek tavan YOK (mevcut ISO kısıtı yine geçerli). */
  readonly maxWords: number | null;
  /** Serbest sohbet cevabı seslendirilebilir mi. */
  readonly allowChat: boolean;
  /** Cevap sonrası mikrofonun kendiliğinden açılması (companion döngüsü). */
  readonly allowFollowUp: boolean;
  /** **GÜVENLİK DIŞI** proaktif konuşma (selamlama · mola · yolculuk yorumu). */
  readonly allowProactiveChatter: boolean;
  /** F4 akış cevabı açılabilir mi. */
  readonly allowStreaming: boolean;
}

const FULL_BUDGET = Object.freeze({
  klass: 'FULL' as const, maxWords: null, allowChat: true, allowFollowUp: true,
  allowProactiveChatter: true, allowStreaming: true,
});

const BUDGETS: Readonly<Record<MaviWorkloadLevel, Omit<MaviResponseBudget, 'level'>>> =
  Object.freeze({
    LOW:    FULL_BUDGET,
    NORMAL: FULL_BUDGET,
    /* UNKNOWN = NORMAL. Gerekçe dosya başlığındadır: kanıt yokluğu Mavi'yi
     * susturma sebebi DEĞİLDİR; ama LOW olduğu da İDDİA EDİLMEZ. */
    UNKNOWN: FULL_BUDGET,
    ELEVATED: Object.freeze({
      klass: 'SHORT' as const, maxWords: MAVI_WORKLOAD_SHORT_WORDS,
      allowChat: true, allowFollowUp: false,
      allowProactiveChatter: false, allowStreaming: true,
    }),
    HIGH: Object.freeze({
      klass: 'MINIMAL' as const, maxWords: MAVI_WORKLOAD_MINIMAL_WORDS,
      allowChat: true, allowFollowUp: false,
      allowProactiveChatter: false, allowStreaming: false,
    }),
    CRITICAL: Object.freeze({
      klass: 'ESSENTIAL_ONLY' as const, maxWords: MAVI_WORKLOAD_MINIMAL_WORDS,
      allowChat: false, allowFollowUp: false,
      allowProactiveChatter: false, allowStreaming: false,
    }),
  });

export function responseBudgetFor(level: MaviWorkloadLevel): MaviResponseBudget {
  const b = BUDGETS[level] ?? BUDGETS.UNKNOWN;
  return Object.freeze({ level, ...b });
}

/**
 * Metni bütçeye indirir — **SAF**.
 *
 * `maviSpeech.trimForDriving` ile ÇAKIŞMAZ, onu TAMAMLAR: iki kısıt de
 * uygulanır ve **daima KÜÇÜK olan kazanır** → workload bir kısıtı asla
 * GEVŞETEMEZ (ISO 15008 tavanı yerinde kalır).
 *
 * Kesme KELİME sınırındadır; cümle ortasından harf kesilmez.
 */
export function applyResponseBudget(text: string, maxWords: number | null): string {
  if (typeof text !== 'string') return '';
  if (maxWords === null || !Number.isFinite(maxWords) || maxWords <= 0) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ertelenmiş cevap — **DEFERRED ≠ COMPLETED**
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Erteleme bir DURUMDUR, bir cümle DEĞİLDİR.
 *
 * F2 koruması: "Şimdi yola odaklan" · "sonra söylerim" gibi kalıp cümleler her
 * turda ÜRETİLMEZ — bu, kaldırdığımız filler'ın kılık değiştirmiş hâli olurdu.
 * Bunun yerine erteleme bounded bir kayıt olarak tutulur, **süresi dolunca
 * DÜŞER** ve **kendiliğinden TEKRAR OYNATILMAZ** (bayat öneri konuşulmaz).
 */
export const MAVI_DEFERRAL_TTL_MS = 60_000;

export interface MaviDeferredResponse {
  readonly turnId: number | null;
  readonly level: MaviWorkloadLevel;
  readonly atMs: number;
  readonly expiresAtMs: number;
}

let _deferred: MaviDeferredResponse | null = null;

/** Ertelemeyi kaydeder (tek yuva — birikmez). */
export function recordDeferredResponse(turnId: number | null, level: MaviWorkloadLevel, nowMs: number): void {
  try {
    const at = Number.isFinite(nowMs) ? nowMs : 0;
    _deferred = Object.freeze({ turnId, level, atMs: at, expiresAtMs: at + MAVI_DEFERRAL_TTL_MS });
    _deferrals = _bump(_deferrals);
  } catch { /* fail-soft */ }
}

/**
 * Bekleyen ertelemeyi okur. **Süresi dolmuşsa `null` döner ve yuvayı temizler**
 * — bayat bir erteleme sonradan "cevap hazır" gibi sunulamaz.
 */
export function peekDeferredResponse(nowMs: number): MaviDeferredResponse | null {
  const d = _deferred;
  if (!d) return null;
  if (Number.isFinite(nowMs) && nowMs >= d.expiresAtMs) {
    _deferred = null;
    _deferralsExpired = _bump(_deferralsExpired);
    return null;
  }
  return d;
}

/** Ertelemeyi düşürür (yeni tur · barge-in · iptal). */
export function clearDeferredResponse(): void { _deferred = null; }

/* ══════════════════════════════════════════════════════════════════════════
 * Canlı kaynak (DI — `setMaviVehicleSnapshotSource` deseniyle BİREBİR)
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviWorkloadSnapshotSource = () => MaviWorkloadSnapshot;

let _source: MaviWorkloadSnapshotSource | null = null;

/**
 * Canlı kaynağı kaydeder (idempotent). Kaynak KAYITLI DEĞİLSE
 * `currentMaviWorkload()` DÜRÜSTÇE `UNKNOWN` döner — "park hâlinde" varsayılmaz.
 */
export function setMaviWorkloadSnapshotSource(source: MaviWorkloadSnapshotSource | null): void {
  _source = typeof source === 'function' ? source : null;
}

/**
 * Canlı workload hükmü. Kaynak yoksa/düşerse `UNKNOWN` — throw ETMEZ.
 * `nowMs` yalnız damga içindir; karar zamana BAĞLI DEĞİLDİR.
 */
export function currentMaviWorkload(nowMs = 0): MaviWorkloadVerdict {
  let snap: MaviWorkloadSnapshot | null = null;
  try { snap = _source ? _source() : null; } catch { snap = null; }
  const v = resolveMaviWorkload(snap, nowMs);
  _record(v);
  return v;
}

/** Canlı bütçe — çağrı yerlerinin TEK kısayolu. */
export function currentMaviResponseBudget(nowMs = 0): MaviResponseBudget {
  return responseBudgetFor(currentMaviWorkload(nowMs).level);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded tanı — CAROS LAB · **PII YOK**
 * ════════════════════════════════════════════════════════════════════════ */

const MAX_COUNTER = 1_000_000;
function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }

let _resolutions = 0;
let _deferrals = 0;
let _deferralsExpired = 0;
let _proactiveSuppressed = 0;
let _responsesShortened = 0;
let _streamsShortened = 0;
let _followUpSuppressed = 0;
let _lastLevel: MaviWorkloadLevel | null = null;
const _levelCounts: Record<string, number> = {};
const _evidenceCounts: Record<string, number> = {};

function _record(v: MaviWorkloadVerdict): void {
  try {
    _resolutions = _bump(_resolutions);
    _lastLevel = v.level;
    _levelCounts[v.level] = _bump(_levelCounts[v.level] ?? 0);
    for (const e of v.evidence) _evidenceCounts[e] = _bump(_evidenceCounts[e] ?? 0);
  } catch { /* fail-soft */ }
}

/** Güvenlik DIŞI proaktif konuşmanın workload yüzünden susturulduğunu sayar. */
export function noteProactiveSuppressed(): void { _proactiveSuppressed = _bump(_proactiveSuppressed); }
/** Cevabın bütçe yüzünden kısaldığını sayar. */
export function noteResponseShortened(): void { _responsesShortened = _bump(_responsesShortened); }
/** Akış cevabının yükselen iş yükü nedeniyle erken kapandığını sayar. */
export function noteStreamShortened(): void { _streamsShortened = _bump(_streamsShortened); }
/** Takip dinlemesinin bütçe yüzünden kurulmadığını sayar. */
export function noteFollowUpSuppressed(): void { _followUpSuppressed = _bump(_followUpSuppressed); }

export interface MaviWorkloadDiagnostics {
  readonly lastLevel: MaviWorkloadLevel | null;
  readonly resolutions: number;
  readonly levels: Readonly<Record<string, number>>;
  readonly evidence: Readonly<Record<string, number>>;
  readonly proactiveSuppressed: number;
  readonly responsesShortened: number;
  readonly streamsShortened: number;
  readonly followUpSuppressed: number;
  readonly deferrals: number;
  readonly deferralsExpired: number;
  /** Kaynak bağlı mı — `false` ise seviye DAİMA `UNKNOWN`dur (dürüstlük). */
  readonly sourceBound: boolean;
}

export function getMaviWorkloadDiagnostics(): MaviWorkloadDiagnostics {
  return Object.freeze({
    lastLevel: _lastLevel,
    resolutions: _resolutions,
    levels: Object.freeze({ ..._levelCounts }),
    evidence: Object.freeze({ ..._evidenceCounts }),
    proactiveSuppressed: _proactiveSuppressed,
    responsesShortened: _responsesShortened,
    streamsShortened: _streamsShortened,
    followUpSuppressed: _followUpSuppressed,
    deferrals: _deferrals,
    deferralsExpired: _deferralsExpired,
    sourceBound: _source !== null,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetMaviWorkloadForTest(): void {
  _source = null;
  _deferred = null;
  _resolutions = 0; _deferrals = 0; _deferralsExpired = 0;
  _proactiveSuppressed = 0; _responsesShortened = 0; _streamsShortened = 0;
  _followUpSuppressed = 0;
  _lastLevel = null;
  for (const k of Object.keys(_levelCounts)) delete _levelCounts[k];
  for (const k of Object.keys(_evidenceCounts)) delete _evidenceCounts[k];
}
