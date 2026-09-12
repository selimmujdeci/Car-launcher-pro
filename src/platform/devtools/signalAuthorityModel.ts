/**
 * signalAuthorityModel — Sinyal Otoritesi ekranının SAF karar katmanı.
 *
 * SÖZLEŞME (CLAUDE.md · gözlemlenebilirlik deseni):
 *   I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 *   Girdi zaten okunmuş bir `SignalAuthoritySnapshot`; çıktı ekranın çizeceği satırlar.
 *
 * ⚠️ PARALEL OTORİTE KURULMAZ: `SignalState` (valid/stale/suspect/no_data/unsupported)
 * **hub'ın sözleşmesidir** ve burada YENİDEN HESAPLANMAZ, yalnız `sessionInspectorModel`
 * gözlemlenebilirlik sınıfına (OBSERVED/DERIVED/UNAVAILABLE/STALE) EŞLENİR. Ham durum
 * satırda ayrıca gösterilir — eşleme bilgi kaybettiği için ham hakikat gizlenmez.
 *
 * ⚠️ HÜKÜM ÜRETMEZ: "motor sağlıklı" gibi bir yorum burada doğmaz. Yalnız
 * "kaç sinyal kanıtlı, kaç tanesi bayat, kaynak gerçek mi mock mu" sayılır.
 */
import type { SignalEnvelope, SignalState } from '../obd/signalEnvelope';
import type { SignalAuthoritySnapshot, SignalRow } from './signalAuthoritySources';
import type { InspectorField, Observability } from './sessionInspectorModel';

/** Ham sinyal durumunun Türkçe etiketi — enum değeri `data-state`'te AYNEN kalır. */
export const SIGNAL_STATE_LABEL: Readonly<Record<SignalState, string>> = {
  valid:       'GEÇERLİ',
  stale:       'BAYAT',
  suspect:     'ŞÜPHELİ',
  no_data:     'VERİ YOK',
  unsupported: 'DESTEKLENMİYOR',
} as const;

/**
 * Zarf → LAB gözlemlenebilirlik sınıfı.
 *
 * EŞLEME GEREKÇESİ (her dal bilinçli):
 *  · `valid`   → OBSERVED    : gerçek ölçüm var (0 bir DEĞERDİR).
 *  · `suspect` → OBSERVED    : ölçüm GERÇEKTEN geldi, yalnız fiziksel sınır dışında.
 *                              UNAVAILABLE demek "kaynak yok" yalanı olurdu; not alanında
 *                              karar için kullanılamayacağı AÇIKÇA yazılır.
 *  · `stale`   → STALE       : bir zamanlar geçerliydi, tazeliğini yitirdi.
 *  · `no_data` / `unsupported` → UNAVAILABLE : değer YOK (sahte 0 üretilmez).
 *  · `source === 'mock'`      → UNAVAILABLE : mock KANIT DEĞİLDİR. Durumu ne olursa olsun
 *                              gerçek ölçüm sayılmaz — "sahte sağlıklı" yasağı.
 *
 * DERIVED HİÇ ÜRETİLMEZ: hub değer türetmez, depolardan okur.
 */
export function classifySignal(env: SignalEnvelope): Observability {
  if (env.source === 'mock') return 'UNAVAILABLE';
  switch (env.state) {
    case 'valid':   return 'OBSERVED';
    case 'suspect': return 'OBSERVED';
    case 'stale':   return 'STALE';
    default:        return 'UNAVAILABLE';   // no_data · unsupported
  }
}

/** Değerin ekranda görünecek metni. Değer yoksa '—' — sahte 0 ASLA yazılmaz. */
export function formatSignalValue(env: SignalEnvelope): string {
  if (env.value === null || !Number.isFinite(env.value)) return '—';
  const v = Math.abs(env.value) >= 100 ? env.value.toFixed(0) : env.value.toFixed(1);
  return env.unit ? `${v} ${env.unit}` : v;
}

/** Güvenin yüzdesi (0..100, tam sayı). Zarf üretmediyse 0 döner — uydurulmaz. */
export function confidencePct(env: SignalEnvelope): number {
  const c = env.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c)) return 0;
  return Math.max(0, Math.min(100, Math.round(c * 100)));
}

/** Satır başına dürüstlük notu — neden bu sınıfta olduğu açıkça yazılır. */
function noteFor(env: SignalEnvelope): string {
  if (env.source === 'mock') {
    return 'MOCK kaynak — gerçek ölçüm DEĞİL, karar için kullanılamaz.';
  }
  switch (env.state) {
    case 'valid':
      return 'Gerçek ölçüm. Değerin 0 olması da bir ölçümdür (veri yokluğu değil).';
    case 'suspect':
      return 'Ölçüm geldi ama fiziksel sınır dışında (sanitize) — karar için KULLANILMAZ.';
    case 'stale':
      return 'Bir zamanlar geçerliydi; tazeliğini yitirdi. Güven yaşla birlikte düşer.';
    case 'no_data':
      return 'ECU yanıt vermedi / paket düştü. DEĞER YOK — "0" DEĞİL.';
    case 'unsupported':
      return 'Araç bu sinyali hiç vermiyor. ARIZA DEĞİL, araç sınırı (bitmask kanıtı).';
    default:
      return '';
  }
}

/** Ekran satırı — `InspectorField` sözleşmesine ham zarf bilgisi eklenir. */
export interface SignalFieldRow extends InspectorField {
  readonly kind:       SignalRow['kind'];
  readonly state:      SignalState;
  readonly confidence: number;   // 0..100
  readonly envSource:  SignalEnvelope['source'];
}

/**
 * Satırları kurar. SIRALAMA YOK — hub'ın döndürdüğü sıra korunur (core önce, sonra PID);
 * "önemliye göre sırala" gibi bir hüküm bu ekranın işi değildir.
 */
export function buildSignalFields(snap: SignalAuthoritySnapshot): readonly SignalFieldRow[] {
  const out: SignalFieldRow[] = [];
  for (const row of snap.rows) {
    const env = row.env;
    out.push({
      id:        row.id,
      label:     row.kind === 'pid' ? `${row.id} · ${row.name}` : row.name,
      value:     formatSignalValue(env),
      klass:     classifySignal(env),
      source:    `signalHub.readSignal('${row.id}') · ${env.source}`,
      /* 0 = hiç ölçülmedi → damga YOK (bayatlık HESAPLANMAZ; sahte tarih yasağı). */
      updatedAt: env.updatedAt > 0 ? env.updatedAt : null,
      note:      noteFor(env),
      kind:      row.kind,
      state:     env.state,
      confidence: confidencePct(env),
      envSource:  env.source,
    });
  }
  return out;
}

/** Sınıf sayacı — ekran başlığındaki özet. */
export function countBySignalClass(
  fields: readonly SignalFieldRow[],
): Readonly<Record<Observability, number>> {
  const counts: Record<Observability, number> = {
    OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0,
  };
  for (const f of fields) counts[f.klass]++;
  return counts;
}

/**
 * Okuma yüzeyinin hükmü — SİNYALLER hakkında değil, YÜZEY hakkında.
 * "Motor iyi" demez; "hub'dan kanıtlı sinyal geliyor mu" der.
 */
export type SignalAuthorityVerdict =
  /** Hub okunamadı (kaynak hata verdi) — hiçbir şey iddia edilmez. */
  | 'READ_FAILED'
  /** Kaynak mock — ekrandaki hiçbir satır gerçek araç kanıtı DEĞİL. */
  | 'MOCK_SOURCE'
  /** En az bir taze, geçerli sinyal var. */
  | 'LIVE'
  /** Satır var ama hepsi bayat — bağlantı yaşıyor olabilir, veri akmıyor. */
  | 'STALE_ONLY'
  /** Hiç değer yok (no_data/unsupported) — araç bağlı değil ya da hiç vermiyor. */
  | 'NO_DATA';

export const SIGNAL_VERDICT_LABEL: Readonly<Record<SignalAuthorityVerdict, string>> = {
  READ_FAILED: 'OKUNAMADI',
  MOCK_SOURCE: 'MOCK KAYNAK',
  LIVE:        'CANLI',
  STALE_ONLY:  'YALNIZ BAYAT',
  NO_DATA:     'VERİ YOK',
} as const;

export interface SignalAuthorityVerdictResult {
  readonly status:  SignalAuthorityVerdict;
  /** Hükmün ham gerekçeleri — hüküm cümlesi değil, SAYILAR. */
  readonly reasons: readonly string[];
}

/**
 * Hüküm sırası (ilk eşleşen kazanır):
 *   1. okuma hatası · 2. mock kaynak · 3. en az bir geçerli · 4. en az bir bayat · 5. veri yok.
 * Mock, "canlı"dan ÖNCE gelir: mock veriyle "CANLI" yazmak sahte güven üretirdi.
 */
export function deriveSignalVerdict(
  snap: SignalAuthoritySnapshot,
  fields: readonly SignalFieldRow[],
): SignalAuthorityVerdictResult {
  const reasons: string[] = [];

  if (snap.error !== null) {
    reasons.push(`Kaynak okuma hatası: ${snap.error}`);
    return { status: 'READ_FAILED', reasons };
  }

  const mock  = fields.filter((f) => f.envSource === 'mock').length;
  const valid = fields.filter((f) => f.envSource !== 'mock' && f.state === 'valid').length;
  const stale = fields.filter((f) => f.envSource !== 'mock' && f.state === 'stale').length;
  const dead  = fields.filter((f) => f.state === 'no_data' || f.state === 'unsupported').length;

  reasons.push(`${fields.length} sinyal okundu · geçerli ${valid} · bayat ${stale} · değersiz ${dead}`);
  if (snap.trimmedPidCount > 0) {
    reasons.push(
      `Desteklenen ${snap.supportedPidCount} PID'in ${snap.trimmedPidCount} tanesi ekrana sığmadı (kırpıldı).`,
    );
  }

  if (mock > 0) {
    reasons.push(`${mock} satır MOCK kaynaktan — gerçek araç kanıtı değil.`);
    return { status: 'MOCK_SOURCE', reasons };
  }
  if (valid > 0) return { status: 'LIVE', reasons };
  if (stale > 0) return { status: 'STALE_ONLY', reasons };
  return { status: 'NO_DATA', reasons };
}
