/**
 * maviSurfaceState.ts — **MAVİ F11 · KULLANICIYA GÖRÜNEN DURUMUN TEK MODELİ (SAF).**
 *
 * ── NE ÇÖZER (ölçülen kusur G10 / B11 / B11b) ───────────────────────────────
 * Denetim ölçtü:
 *   · `livingThemeState.CompanionStatus` yalnız **4 durum** taşıyor
 *     (`idle · listening · processing · speaking`). `action` · `confirmation` ·
 *     `proactive` · `deferred` · `degraded` · `ambient` **hiç yok**.
 *   · `VoiceAssistant.tsx` durum etiketini KENDİ İÇİNDE üretiyordu ve tam ekran
 *     yüzeyde **"AI düşünüyor…"** yazıyordu → bu bir **iç akıl yürütme
 *     göstergesidir** ve F2/I7 ile yasaktır.
 *   · Tam ekran overlay `fixed inset-0` ile navigasyon/müzik ekranını KAPATIYOR
 *     (spec §21.2: "Mavi navigasyon veya müzik ekranını kapatmaz").
 *   · Compact (sürüş) / expanded (park) ayrımı bir POLİTİKA değil, çağıranın
 *     elle geçtiği `minimal` prop'uydu — tek kaynak yoktu.
 *
 * ── BU DOSYANIN ROLÜ ────────────────────────────────────────────────────────
 * Kullanıcıya görünen durumun TEK kanonik türetmesi. **I/O · timer · `Date.now`
 * · store · React importu YOKTUR** (`maviWorkload` · `proactivePolicyEngine` ·
 * `maviMemoryModel` ile aynı desen). Canlı okuma React köprüsündedir.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · **UI DURUMU BİR OTORİTE DEĞİLDİR.** Eylem yürütmez, gerçek üretmez, capability
 *    açıp kapatmaz, güvenlik kararı vermez. Yalnız KANONİK kaynaklardan TÜRETİR.
 *  · **"THINKING" GÖSTERİLMEZ (F2/I7).** `UNDERSTANDING` bir düşünme göstergesi
 *    değildir; "seni duydum" görselidir. Model düşüncesi, aşama adı, plan içeriği
 *    ve "bakıyorum/kontrol ediyorum" gibi ara sözler bu katmandan ÇIKAMAZ —
 *    yasak sözcük listesi kilitle korunur.
 *  · **`ACCEPTED` "tamamlandı" DEĞİLDİR (F7).** Gözlem seviyesi etiketleri
 *    doğrulanmamış başarıyı başarı gibi göstermez.
 *  · **DEGRADED YALAN SÖYLEMEZ.** "AI çalışmıyor" gibi genelleme yasaktır; hangi
 *    yeteneğin AYAKTA kaldığı söylenir.
 *  · **NAVİGASYON/MÜZİK KAPANMAZ.** Tam ekran yüzey yalnız `EXPANDED` (park) +
 *    kullanıcı isteğiyle; sürüşte yüzey şerittir.
 */

import type { MaviWorkloadLevel } from './maviWorkload';
import type { CapabilityObservation } from '../capability/fabric/capabilityContract';

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded durum kümesi
 * ════════════════════════════════════════════════════════════════════════ */

/** Kullanıcıya görünen Mavi durumu — kapalı küme, serbest metin YOK. */
export type MaviSurfaceState =
  /** Hiçbir şey gösterilmez. */
  | 'IDLE'
  /** Wake sözü dinleniyor — küçük, sessiz varlık işareti. */
  | 'AMBIENT'
  /** Mikrofon açık. */
  | 'LISTENING'
  /** Kullanıcı bitirdi, cevap hazırlanıyor. **Düşünme göstergesi DEĞİLDİR.** */
  | 'UNDERSTANDING'
  /** Nihai cevap seslendiriliyor. */
  | 'SPEAKING'
  /** Süren bir iş var (uzun işlem). */
  | 'ACTION'
  /** Kullanıcının açık onayı bekleniyor. */
  | 'CONFIRMATION'
  /** Proaktif bir bildirim teslim ediliyor. */
  | 'PROACTIVE'
  /** Cevap iş yükü nedeniyle ertelendi. **`COMPLETED` DEĞİLDİR.** */
  | 'DEFERRED'
  /** Yetenek kaybı var ama sistem ayakta. */
  | 'DEGRADED'
  /** Dürüst hata. */
  | 'ERROR';

/** İki yüzey (spec §21.2). */
export type MaviSurfaceMode = 'COMPACT' | 'EXPANDED';

/**
 * Yetenek kaybı sınıfı. **Bounded ve SPESİFİK** — "AI çalışmıyor" gibi
 * genelleme yasaktır; her sınıf ayakta kalan yeteneği söyler.
 */
export type MaviDegradedClass =
  | 'NONE'
  /** Ağ yok. */
  | 'OFFLINE'
  /** Ağ var ama sağlayıcı devre kesicide. */
  | 'CLOUD_UNAVAILABLE'
  /** Sağlayıcı kota/429 soğumasında. */
  | 'PROVIDER_COOLDOWN'
  /** Ses tanıma yedek yolda. */
  | 'STT_FALLBACK'
  /** Seslendirme yedek yolda. */
  | 'TTS_FALLBACK';

/** Duruma NEDEN geçildiği — bounded telemetri kodu (serbest metin DEĞİL). */
export type MaviSurfaceReason =
  | 'error'
  | 'confirmation_pending'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'action_in_flight'
  | 'proactive_delivery'
  | 'deferred_pending'
  | 'degraded_only'
  | 'wake_armed'
  | 'idle';

/* ══════════════════════════════════════════════════════════════════════════
 * Girdi — hepsi MEVCUT kanonik otoritelerden OKUNUR
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviSurfaceInputs {
  /** `voiceService.VoiceState.status`. */
  readonly voiceStatus: string;
  /** `voiceService.VoiceState.followUp` — takip dinlemesi kurulu mu. */
  readonly followUp: boolean;
  /** Gerçek hata METNİ VAR MI (metnin kendisi ayrı taşınır). */
  readonly hasError: boolean;
  /** Wake sözü dinleniyor mu (`wakeWordService` etkin + ayar açık). */
  readonly wakeArmed: boolean;
  /** F8 iş yükü — yüzey kipini belirler, capability KAPATMAZ. */
  readonly workload: MaviWorkloadLevel;
  /** `maviVehicleContext` hareket hükmü. `unknown` ≠ park (fail-safe). */
  readonly motionState: 'moving' | 'stopped' | 'unknown';
  /** F-M4: açık onay bekleyen bir eylem var mı. */
  readonly pendingConfirmation: boolean;
  /** Uzun süren bir iş uçuşta mı (F6 plan/executor). */
  readonly actionInFlight: boolean;
  /** F9: proaktif bir konuşma teslim ediliyor mu. */
  readonly proactiveInFlight: boolean;
  /** F8: geçerli (bayat OLMAYAN) bir erteleme var mı. */
  readonly deferredPending: boolean;
  /** Yetenek kaybı sınıfı — `NONE` = kayıp yok. */
  readonly degraded: MaviDegradedClass;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çıktı
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviSurfaceView {
  readonly state: MaviSurfaceState;
  readonly mode: MaviSurfaceMode;
  readonly reason: MaviSurfaceReason;
  /** Kısa, nötr durum etiketi. Boş = etiket gösterilmez. */
  readonly label: string;
  /**
   * Yetenek kaybı rozeti — duruma DİK eksendir: `LISTENING` sırasında da
   * görünebilir (kalıcı küçük rozet, spec §21.1).
   */
  readonly degraded: MaviDegradedClass;
  /** Rozet metni; kayıp yoksa boş. **Ayakta kalan yeteneği söyler.** */
  readonly degradedLabel: string;
  /** Yüzey ekranda YER KAPLIYOR mu (şerit dahil). */
  readonly visible: boolean;
  /**
   * Tam ekran alınabilir mi. **Sürüşte ASLA** — navigasyon/müzik kapanmaz
   * (spec §21.2). Yalnız `EXPANDED` kipte ve kullanıcı isteğiyle.
   */
  readonly allowsFullScreen: boolean;
  /** Otomatik kapanma YASAK mı (kullanıcı cevabı/onayı bekleniyor). */
  readonly blocksAutoClose: boolean;
  /** Dokunma hedefi taban ölçüsü (px) — sürüşte büyür. */
  readonly minTouchPx: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Etiketler — **YASAK SÖZCÜK LİSTESİ KİLİTLİDİR**
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kullanıcıya ASLA gösterilmeyecek iç-akıl-yürütme sözcükleri (F2/I7).
 * Bu liste testte kilitlidir: bu dosyadan çıkan hiçbir etiket bunları içeremez.
 */
export const MAVI_FORBIDDEN_LABEL_STEMS: readonly string[] = Object.freeze([
  'düşün', 'dusun', 'bakıyor', 'bakiyor', 'kontrol ediyor', 'analiz',
  'yorumluyor', 'hesaplıyor', 'hesapliyor', 'işliyor', 'isliyor',
  'plan yapıyor', 'muhakeme', 'akıl yürüt', 'akil yurut',
]);

/**
 * Durum etiketleri. Kısa ve NÖTRdür; hiçbiri modelin iç işleyişini anlatmaz.
 *
 * `UNDERSTANDING` = *"Seni duydum"* — bu bir DÜŞÜNME göstergesi değil, bir
 * ALINDI bildirimidir. "İşleniyor/düşünüyor" gibi bir ifade F2 ihlalidir.
 */
export const MAVI_SURFACE_LABEL: Readonly<Record<MaviSurfaceState, string>> =
  Object.freeze({
    IDLE:          '',
    AMBIENT:       '',
    LISTENING:     'Dinliyorum',
    UNDERSTANDING: 'Seni duydum',
    SPEAKING:      'Cevaplıyorum',
    ACTION:        'Yapılıyor',
    CONFIRMATION:  'Onayını bekliyorum',
    PROACTIVE:     'Bilgi',
    DEFERRED:      'Sonraya bırakıldı',
    DEGRADED:      'Sınırlı kipte',
    ERROR:         'Anlaşılamadı',
  });

/**
 * Yetenek kaybı rozetleri. **Her biri AYAKTA KALANI söyler** — "AI çalışmıyor"
 * gibi genelleme yasaktır (kullanıcı hâlâ yerel komut verebiliyor).
 */
export const MAVI_DEGRADED_LABEL: Readonly<Record<MaviDegradedClass, string>> =
  Object.freeze({
    NONE:              '',
    OFFLINE:           'Çevrimdışı — yerel komutlar çalışıyor',
    CLOUD_UNAVAILABLE: 'Bulut yanıt vermiyor — yerel komutlar çalışıyor',
    PROVIDER_COOLDOWN: 'Sağlayıcı beklemede — yerel komutlar çalışıyor',
    STT_FALLBACK:      'Ses tanıma yedek kipte',
    TTS_FALLBACK:      'Seslendirme yedek kipte',
  });

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlem seviyesi etiketleri (F7 dürüstlüğü)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir eylemin sonucunun KULLANICIYA nasıl yazılacağı.
 *
 * **`ACCEPTED` ASLA "tamamlandı" DEĞİLDİR** — yürütücüye teslim edildi ama sonuç
 * doğrulanmadı. Bu ayrım F7'nin tüm anlamıdır; UI onu ezemez.
 */
export const MAVI_OBSERVATION_LABEL: Readonly<Record<CapabilityObservation, string>> =
  Object.freeze({
    REQUESTED: 'gönderildi',
    ACCEPTED:  'iletildi — doğrulanmadı',
    EXECUTED:  'yapıldı',
    OBSERVED:  'doğrulandı',
    FAILED:    'başarısız',
    UNKNOWN:   'sonuç bilinmiyor',
    CANCELLED: 'iptal edildi',
  });

/** Bu seviye "iş bitti, doğrulandı" olarak GÖSTERİLEBİLİR mi. */
export function observationCountsAsDone(level: CapabilityObservation): boolean {
  return level === 'OBSERVED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF türetme
 * ════════════════════════════════════════════════════════════════════════ */

const WORKLOAD_RANK: Readonly<Record<MaviWorkloadLevel, number>> = Object.freeze({
  LOW: 0, NORMAL: 1, UNKNOWN: 1, ELEVATED: 2, HIGH: 3, CRITICAL: 4,
});

/** Sürüşte dokunma hedefi büyür (OEM ergonomi). */
export const MAVI_TOUCH_PX_COMPACT = 76;
export const MAVI_TOUCH_PX_EXPANDED = 56;

/**
 * Yüzey kipi.
 *
 * `COMPACT` ⟺ iş yükü `ELEVATED` ve üstü **VEYA** doğrulanmış hareket **VEYA**
 * hareket BİLİNMİYOR. Son madde bilinçlidir: `unknown` park DEĞİLDİR ve
 * kanıtsızken daha az dikkat yükü seçilir (fail-safe).
 */
export function deriveSurfaceMode(
  workload: MaviWorkloadLevel,
  motionState: MaviSurfaceInputs['motionState'],
): MaviSurfaceMode {
  const rank = WORKLOAD_RANK[workload] ?? WORKLOAD_RANK.UNKNOWN;
  if (rank >= WORKLOAD_RANK.ELEVATED) return 'COMPACT';
  return motionState === 'stopped' ? 'EXPANDED' : 'COMPACT';
}

/**
 * Girdi → görünür durum. **SAF · throw ETMEZ · `Date.now` OKUMAZ.**
 *
 * Öncelik (ilk eşleşen kazanır — en çok kullanıcı ilgisi gerektirenden en aza):
 *  1. `ERROR` — dürüst hata gizlenmez.
 *  2. `CONFIRMATION` — kullanıcı onayı bekleniyor; hiçbir şey bunu örtemez.
 *  3. `LISTENING` · 4. `UNDERSTANDING` · 5. `SPEAKING` — canlı tur.
 *  6. `ACTION` — süren iş.
 *  7. `PROACTIVE` — Mavi'nin kendi bildirimi.
 *  8. `DEFERRED` — ertelenmiş cevap (**tamamlanmış DEĞİL**).
 *  9. `DEGRADED` — başka bir şey olmuyorsa yetenek kaybı bir kez görünür.
 * 10. `AMBIENT` — wake dinliyor.
 * 11. `IDLE`.
 *
 * `degraded` alanı DİK eksendir ve her durumda taşınır (kalıcı rozet).
 */
export function deriveMaviSurface(input: MaviSurfaceInputs | null | undefined): MaviSurfaceView {
  const i: MaviSurfaceInputs = input ?? {
    voiceStatus: 'idle', followUp: false, hasError: false, wakeArmed: false,
    workload: 'UNKNOWN', motionState: 'unknown', pendingConfirmation: false,
    actionInFlight: false, proactiveInFlight: false, deferredPending: false,
    degraded: 'NONE',
  };

  const mode = deriveSurfaceMode(i.workload, i.motionState);
  const degraded = MAVI_DEGRADED_LABEL[i.degraded] !== undefined ? i.degraded : 'NONE';

  const pick = (): { state: MaviSurfaceState; reason: MaviSurfaceReason } => {
    if (i.hasError || i.voiceStatus === 'error') return { state: 'ERROR', reason: 'error' };
    if (i.pendingConfirmation) return { state: 'CONFIRMATION', reason: 'confirmation_pending' };
    if (i.voiceStatus === 'listening') return { state: 'LISTENING', reason: 'listening' };
    if (i.voiceStatus === 'processing') return { state: 'UNDERSTANDING', reason: 'processing' };
    if (i.voiceStatus === 'success') return { state: 'SPEAKING', reason: 'speaking' };
    if (i.actionInFlight) return { state: 'ACTION', reason: 'action_in_flight' };
    if (i.proactiveInFlight) return { state: 'PROACTIVE', reason: 'proactive_delivery' };
    /* DEFERRED yalnız GEÇERLİ (bayat olmayan) erteleme için gösterilir. Bayatlık
       kararı `maviWorkload.peekDeferredResponse` otoritesindedir; bu katman onu
       YENİDEN hesaplamaz — `deferredPending` zaten süzülmüş gelir. */
    if (i.deferredPending) return { state: 'DEFERRED', reason: 'deferred_pending' };
    if (degraded !== 'NONE') return { state: 'DEGRADED', reason: 'degraded_only' };
    if (i.wakeArmed) return { state: 'AMBIENT', reason: 'wake_armed' };
    return { state: 'IDLE', reason: 'idle' };
  };

  const { state, reason } = pick();

  /* Otomatik kapanma kilidi — mevcut `voiceOverlayShouldAutoClose(followUp)`
     kilidinin GENELLEŞTİRİLMİŞ hâli: takip dinlemesine EK OLARAK onay ve süren
     iş de pencereyi kapatamaz (kullanıcı cevabını/onayını veremeden kapanma
     saha bug'ı 2026-07-03'ün sınıfıdır). */
  const blocksAutoClose = i.followUp === true
    || state === 'CONFIRMATION' || state === 'ACTION';

  return Object.freeze({
    state,
    mode,
    reason,
    label: MAVI_SURFACE_LABEL[state],
    degraded,
    degradedLabel: MAVI_DEGRADED_LABEL[degraded],
    visible: state !== 'IDLE',
    /* Tam ekran YALNIZ park kipinde mümkündür; sürüşte navigasyon/müzik
       ekranı KAPANMAZ (spec §21.2 — pazarlıksız). */
    allowsFullScreen: mode === 'EXPANDED',
    blocksAutoClose,
    minTouchPx: mode === 'COMPACT' ? MAVI_TOUCH_PX_COMPACT : MAVI_TOUCH_PX_EXPANDED,
  });
}

/**
 * Otomatik kapanma kilidi — **mevcut sözleşmenin ARDIŞIK GENİŞLEMESİ.**
 * `voiceOverlayShouldAutoClose(followUp)` bunun dar hâlidir ve davranışı
 * KORUNUR: `followUp === true` iken hâlâ ASLA kapanmaz.
 */
export function surfaceShouldAutoClose(view: MaviSurfaceView | null | undefined): boolean {
  return !(view?.blocksAutoClose ?? false);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded tanı — CAROS LAB · **PII YOK** (metin · transkript TAŞINMAZ)
 * ════════════════════════════════════════════════════════════════════════ */

const MAX_COUNTER = 1_000_000;
function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }

let _transitions = 0;
let _lastState: MaviSurfaceState | null = null;
let _lastReason: MaviSurfaceReason | null = null;
let _lastMode: MaviSurfaceMode | null = null;
let _lastDegraded: MaviDegradedClass = 'NONE';
let _fullScreenBlocked = 0;
const _stateCounts: Record<string, number> = {};

/**
 * Durum geçişini bounded deftere yazar. **Yalnız SAYAÇ** — etiket metni bile
 * taşınmaz (etiketler sabit olsa da defterin sözleşmesi budur).
 * Aynı durum tekrar gelirse geçiş SAYILMAZ (gürültü önleme).
 */
export function noteMaviSurface(view: MaviSurfaceView | null | undefined): void {
  try {
    if (!view) return;
    _lastMode = view.mode;
    _lastDegraded = view.degraded;
    if (view.state === _lastState) return;
    _lastState = view.state;
    _lastReason = view.reason;
    _transitions = _bump(_transitions);
    _stateCounts[view.state] = _bump(_stateCounts[view.state] ?? 0);
  } catch { /* fail-soft: gözlem üretim yüzeyini ASLA bozmaz */ }
}

/** Sürüş kipinde tam ekran isteği REDDEDİLDİ (navigasyon/müzik korundu). */
export function noteFullScreenBlocked(): void {
  _fullScreenBlocked = _bump(_fullScreenBlocked);
}

export interface MaviSurfaceDiagnostics {
  readonly transitions: number;
  readonly lastState: MaviSurfaceState | null;
  readonly lastReason: MaviSurfaceReason | null;
  readonly lastMode: MaviSurfaceMode | null;
  readonly lastDegraded: MaviDegradedClass;
  readonly states: Readonly<Record<string, number>>;
  readonly fullScreenBlocked: number;
}

export function getMaviSurfaceDiagnostics(): MaviSurfaceDiagnostics {
  return Object.freeze({
    transitions: _transitions,
    lastState: _lastState,
    lastReason: _lastReason,
    lastMode: _lastMode,
    lastDegraded: _lastDegraded,
    states: Object.freeze({ ..._stateCounts }),
    fullScreenBlocked: _fullScreenBlocked,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetMaviSurfaceForTest(): void {
  _transitions = 0;
  _lastState = null; _lastReason = null; _lastMode = null; _lastDegraded = 'NONE';
  _fullScreenBlocked = 0;
  for (const k of Object.keys(_stateCounts)) delete _stateCounts[k];
}
