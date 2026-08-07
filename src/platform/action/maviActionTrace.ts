/**
 * maviActionTrace — Mavi eylem zincirinin TEK bounded aşama halkası (MAVI-M4-LAB-2).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M4-LAB kapı kararlarını görünür kıldı, ama zincirin GERİ KALANI görünmezdi:
 * "kapı ne dedi" biliniyordu, "yürütücü ne döndürdü" ve "kullanıcı ne duydu"
 * bilinmiyordu. Tek bir komutun hikâyesi üç ayrı katmanda dağınıktı.
 *
 * ── YENİ DEPO DEĞİLDİR ──────────────────────────────────────────────────────
 * Bu dosya M4-LAB'ın ZATEN VAR OLAN karar halkasının taşınmış ve genelleştirilmiş
 * hâlidir. İkinci bir olay veri yolu / store / abonelik sistemi KURULMAZ:
 *   · Tek dairesel tampon, tek modül durumu.
 *   · `maviActionAuthority.getActionAuthorityDiagnostics()` artık BUNU okur
 *     (kapı aşamalarını süzerek) → M4-LAB ekranı ve kilitleri DEĞİŞMEDEN çalışır.
 *   · Kanıt Görüntüleyici de BUNU okur → ayrı bir zaman çizelgesi doğmaz.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · SAF DEPO: konuşmaz · UI açmaz · servis çağırmaz · store/localStorage yazmaz.
 *  · Kayıt FAIL-SOFT: `record()` asla throw etmez ve çağıranın davranışını
 *    DEĞİŞTİRMEZ (üretim akışına dal eklemez).
 *  · SABİT boyutlu dairesel tampon + DOYAN sayaç → uzun oturumda bellek büyümez.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 * Kayıt tipinde metin taşıyan hiçbir kullanıcı-içeriği alanı YOKTUR. Özellikle:
 *  · `IntentExecutionResult.detail` **KAYDEDİLMEZ** — içinde gerçek kullanıcı
 *    metni bulunur (ör. `"${contact.name} aranıyor"` → KİŞİ ADI, araç sağlığı
 *    özeti, sensör değeri). Yalnız `status` ve makine-okur `reason` alınır.
 *  · Ham komut · telefon numarası · VIN · konum · sağlayıcı cevabı GİRMEZ.
 *  · Korelasyon YALNIZ `turnId` (süreç-içi monotonik sayaç) iledir — kullanıcıya
 *    veya araca bağlanabilir bir kimlik DEĞİLDİR.
 */

import { getActiveMaviTurn } from '../assistant/maviTurn';

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Zincirdeki aşama.
 *
 * `proactive_speech` BİLİNÇLİ olarak ayrı bir türdür ve **kullanıcı turuna
 * BAĞLANMAZ** (`turnId: null`): proaktif kritik güvenlik uyarısı bir kullanıcı
 * komutunun cevabı değildir; kullanıcı turu değişince susturulamaz (M6 sözleşmesi).
 * Gruplama katmanı bu türü asla bir turun içine koymaz.
 */
export type MaviActionStage =
  /** Kullanıcı komutu kabul edildi ve tur başladı ("komut alındı"). */
  | 'turn_started'
  /** M4 kapı kararı (hareket · AiSafetyGate · onay · capability). */
  | 'gate'
  /** M3 `IntentExecutionResult` — yürütücünün gerçek sonucu. */
  | 'result'
  /** M6 tek TTS otoritesinin sonucu (konuştu / düşürüldü). */
  | 'speech'
  /** Proaktif kritik güvenlik uyarısı — KULLANICI TURU DEĞİLDİR. */
  | 'proactive_speech';

export interface MaviActionTraceRecord {
  readonly stage: MaviActionStage;
  /** Korelasyon anahtarı. `null` = tur bağlamı YOK (proaktif hat veya tur dışı). */
  readonly turnId: number | null;
  /** Defter kimliği — yalnız `gate`/`result` aşamalarında. */
  readonly actionId: string | null;
  /** `IntentType` enum değeri — serbest metin DEĞİL. */
  readonly intent: string | null;
  /** Makine-okur durum (`allowed` · `denied` · `succeeded` · `spoken` …). */
  readonly status: string;
  /** Makine-okur gerekçe. Kullanıcı metni ASLA buraya konmaz. */
  readonly reason: string;
  readonly atMs: number;
}

/** Halka kapasitesi — Mali-400 render bütçesi + sabit bellek. */
export const MAX_ACTION_TRACE = 120;
/** Sayaç tavanı (doyan) — taşma yok. */
const MAX_TRACE_COUNTER = 1_000_000;

const _ring: Array<MaviActionTraceRecord | undefined> = new Array(MAX_ACTION_TRACE);
let _writeIdx = 0;
let _written = 0;
let _recorded = 0;
let _dropped = 0;   // kapasite aşımıyla düşen kayıt sayısı (gözlem dürüstlüğü)

function _sat(v: number): number {
  return v >= MAX_TRACE_COUNTER ? MAX_TRACE_COUNTER : v + 1;
}

function _str(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : '';
}

function _identOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export interface MaviActionTraceInput {
  readonly stage: MaviActionStage;
  readonly status: string;
  readonly reason?: string;
  readonly actionId?: string | null;
  readonly intent?: string | null;
  /**
   * Korelasyon turu. Verilmezse AKTİF turdan okunur. `proactive_speech` için
   * çağıran açıkça `null` geçer → kullanıcı turuna karışmaz.
   */
  readonly turnId?: number | null;
}

/**
 * Bir aşamayı halkaya yazar. **ASLA throw etmez** ve çağıranın dönüşünü/akışını
 * DEĞİŞTİRMEZ. Üretim davranışı bu çağrıdan etkilenmez.
 */
export function recordMaviActionStage(input: MaviActionTraceInput): void {
  try {
    if (!input || typeof input.stage !== 'string') return;

    let turnId: number | null;
    if (input.turnId !== undefined) {
      turnId = typeof input.turnId === 'number' && Number.isFinite(input.turnId) ? input.turnId : null;
    } else {
      // Aktif tur okunamazsa korelasyon YOK — tahmin edilmez.
      let active: number | null = null;
      try { active = getActiveMaviTurn()?.id ?? null; } catch { active = null; }
      turnId = active;
    }

    if (_ring[_writeIdx] !== undefined) _dropped = _sat(_dropped);   // üzerine yazılıyor
    _ring[_writeIdx] = Object.freeze({
      stage:    input.stage,
      turnId,
      actionId: _identOrNull(input.actionId),
      intent:   _identOrNull(input.intent),
      status:   _str(input.status),
      reason:   _str(input.reason),
      atMs:     Date.now(),
    });
    _writeIdx = (_writeIdx + 1) % MAX_ACTION_TRACE;
    if (_written < MAX_TRACE_COUNTER) _written++;
    _recorded = _sat(_recorded);
  } catch { /* gözlem ASLA üretimi bozmaz */ }
}

/**
 * Halkanın salt-okunur görüntüsü — **EN YENİ → EN ESKİ**.
 * Dönen dizi dondurulmuştur; çağıran halkayı değiştiremez.
 */
export function getMaviActionTrace(): readonly MaviActionTraceRecord[] {
  const out: MaviActionTraceRecord[] = [];
  const filled = Math.min(_written, MAX_ACTION_TRACE);
  for (let i = 1; i <= filled; i++) {
    const rec = _ring[(_writeIdx - i + MAX_ACTION_TRACE) % MAX_ACTION_TRACE];
    if (rec) out.push(rec);
  }
  return Object.freeze(out);
}

/** Bounded sayaçlar (PII YOK — yalnız adet). */
export function getMaviActionTraceCounters(): {
  readonly recorded: number;
  readonly dropped: number;
  readonly capacity: number;
  readonly saturated: boolean;
} {
  return Object.freeze({
    recorded: _recorded,
    dropped: _dropped,
    capacity: MAX_ACTION_TRACE,
    saturated: _recorded >= MAX_TRACE_COUNTER,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetMaviActionTraceForTest(): void {
  _ring.fill(undefined);
  _writeIdx = 0;
  _written = 0;
  _recorded = 0;
  _dropped = 0;
}
