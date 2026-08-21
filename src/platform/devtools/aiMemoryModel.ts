/**
 * aiMemoryModel — CAROS LAB · Bellek Gezgini SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 *  · Kaynak okunamadıysa `UNAVAILABLE`; "0 kayıt" ile KARIŞTIRILMAZ.
 *  · Araç geçmişi otoritesi BAĞLI DEĞİLSE 0 bir ÖLÇÜM DEĞİLDİR — ayrı söylenir.
 *  · Damgası olmayan kaydın yaşı HESAPLANMAZ.
 *  · İçerik hiçbir biçimde (metin · uzunluk · özet · hash) taşınmaz.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';
import type { MemoryRecordShape } from './aiMemorySources';

const SRC_SHORT  = 'ai/memory/shortTermMemory.getShortTermMemory';
const SRC_MAVI   = 'ai/memory/concrete/maviMemorySources';
const SRC_POLICY = 'ai/memory/{memoryEngine,sensitiveMemoryGuard}';

/** Girdi tipi YAPISALDIR — `aiMemorySources` çıktısının şeklidir. */
export interface AiMemoryFieldsInput {
  readonly shortTerm: readonly MemoryRecordShape[] | null;
  readonly shortTermCapacity: number;
  readonly preferenceCount: number | null;
  readonly vehicleFactCount: number | null;
  readonly vehicleHistoryWired: boolean;
  readonly confidentVehicleFactCount: number | null;
  readonly maxTextLength: number;
  readonly minVehicleFactConfidence: number;
  readonly budgetMaxRecords: number;
  readonly budgetMaxLongTerm: number;
  readonly budgetMaxShortTerm: number;
  readonly budgetMaxChars: number;
  readonly nowMs: number;
}

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export type MemoryVerdict =
  /** Kısa dönem okuması düştü. */
  | 'UNAVAILABLE'
  /** Hiç kayıt yok — uygulama yeni başlamış olabilir (RAM hafıza). */
  | 'EMPTY'
  /** Kayıt var, kapasitenin altında. */
  | 'LEARNING'
  /** Halka tampon DOLU — en eski kayıt her yenisinde düşüyor. */
  | 'AT_CAPACITY';

export const MEMORY_VERDICT_LABEL: Readonly<Record<MemoryVerdict, string>> = {
  UNAVAILABLE: 'OKUNAMADI',
  EMPTY:       'BOŞ — bu oturumda kayıt yok',
  LEARNING:    'KAYIT VAR',
  AT_CAPACITY: 'TAMPON DOLU — en eski kayıt düşüyor',
} as const;

export type MemoryTone = 'ok' | 'muted' | 'warn';

export function memoryVerdictTone(v: MemoryVerdict): MemoryTone {
  return v === 'LEARNING' ? 'ok' : v === 'AT_CAPACITY' ? 'warn' : 'muted';
}

export function deriveMemoryVerdict(input: {
  readonly shortTerm: readonly MemoryRecordShape[] | null;
  readonly capacity: number;
}): MemoryVerdict {
  if (input.shortTerm === null) return 'UNAVAILABLE';
  if (input.shortTerm.length === 0) return 'EMPTY';
  return input.shortTerm.length >= input.capacity ? 'AT_CAPACITY' : 'LEARNING';
}

/** Köken sınıfına göre adet — içerik taşımaz. */
export function countByOrigin(
  records: readonly MemoryRecordShape[] | null,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (records === null) return out;
  for (const r of records) out[r.origin] = (out[r.origin] ?? 0) + 1;
  return out;
}

/** En eski geçerli damga; `null` = hiç damgalı kayıt yok. */
export function oldestStampMs(
  records: readonly MemoryRecordShape[] | null,
): number | null {
  if (records === null) return null;
  let oldest: number | null = null;
  for (const r of records) {
    if (!(r.atMs > 0)) continue;            // damga YOK — yaşa katılmaz
    if (oldest === null || r.atMs < oldest) oldest = r.atMs;
  }
  return oldest;
}

/* ── Alanlar ─────────────────────────────────────────────────────────────── */

export function buildMemoryFields(i: AiMemoryFieldsInput): readonly InspectorField[] {
  const out: InspectorField[] = [];

  if (i.shortTerm === null) {
    out.push(unavailable({
      id: 'st-count', label: 'Kısa dönem kayıt', source: SRC_SHORT, note: '',
    }, 'Okuma hata verdi — "0 kayıt" ile KARIŞTIRILMAZ.'));
  } else {
    out.push(observed({
      id: 'st-count', label: 'Kısa dönem kayıt', source: SRC_SHORT,
      note: 'Yalnız RAM · süreç-ömürlü: uygulama yeniden başlayınca BOŞ başlar, hiçbir kalıcı depoya yazılmaz.',
    }, `${i.shortTerm.length}/${i.shortTermCapacity}`));

    const oldest = oldestStampMs(i.shortTerm);
    out.push(oldest === null
      ? unavailable({ id: 'st-oldest', label: 'En eski kaydın yaşı', source: SRC_SHORT, note: '' },
          i.shortTerm.length === 0 ? 'Kayıt yok.' : 'Damgalı kayıt yok — yaş HESAPLANMAZ.')
      : derived({
          id: 'st-oldest', label: 'En eski kaydın yaşı', source: SRC_SHORT,
          note: 'Damgadan türetildi; damgasız kayıtlar hesaba KATILMAZ.',
          updatedAt: oldest,
        }, formatAge(oldest, i.nowMs)));

    const byOrigin = countByOrigin(i.shortTerm);
    const originText = Object.keys(byOrigin).length === 0
      ? null
      : Object.entries(byOrigin).map(([k, v]) => `${k}=${v}`).join(' · ');
    out.push(originText === null
      ? unavailable({ id: 'st-origin', label: 'Köken dağılımı', source: SRC_SHORT, note: '' },
          'Kayıt yok.')
      : observed({
          id: 'st-origin', label: 'Köken dağılımı', source: SRC_SHORT,
          note: 'Yalnız SINIF ve ADET — kayıt içeriği bu ekrana HİÇ GELMEZ.',
        }, originText));
  }

  out.push(i.preferenceCount === null
    ? unavailable({ id: 'pref-count', label: 'Kullanıcı tercihi', source: SRC_MAVI, note: '' },
        'Okunamadı.')
    : observed({
        id: 'pref-count', label: 'Kullanıcı tercihi', source: SRC_MAVI,
        note: 'Uzun dönem gerçekler — yalnız ADET taşınır, metin taşınmaz.',
      }, i.preferenceCount));

  if (!i.vehicleHistoryWired) {
    out.push(unavailable({
      id: 'veh-facts', label: 'Araç geçmişi gerçeği', source: SRC_MAVI, note: '',
    }, 'Otorite BAĞLI DEĞİL (parmak izi veya bellek deposu yok) → burada 0 bir ÖLÇÜM DEĞİLDİR.'));
  } else {
    out.push(observed({
      id: 'veh-facts', label: 'Araç geçmişi gerçeği', source: SRC_MAVI,
      note: 'Otorite bağlı; 0 geçerli bir cevaptır (henüz öğrenilmedi).',
    }, i.vehicleFactCount ?? 0));

    out.push(i.confidentVehicleFactCount === null
      ? unavailable({ id: 'veh-confident', label: 'Eşik üstü güvenli gerçek', source: SRC_MAVI, note: '' },
          'Hesaplanamadı.')
      : derived({
          id: 'veh-confident', label: 'Eşik üstü güvenli gerçek', source: SRC_MAVI,
          note: `Yalnız güveni ≥ ${i.minVehicleFactConfidence} olanlar taşınır; altındakiler bloğa GİRMEZ.`,
        }, i.confidentVehicleFactCount));
  }

  out.push(observed({
    id: 'policy-guard', label: 'Hassas veri kapısı', source: SRC_POLICY,
    note: 'Her kayıt kapıdan geçer: VIN · plaka · telefon · e-posta · IBAN/kart · API anahtarı · koordinat · uzun rakam dizisi REDDEDİLİR. Geçemeyen kayıt SAKLANMAZ.',
  }, `azami ${i.maxTextLength} karakter`));

  out.push(observed({
    id: 'policy-budget', label: 'Blok bütçesi', source: SRC_POLICY,
    note: 'Bir görevde taşınacak azami kayıt ve karakter — token sınırı ve gizlilik birlikte.',
  }, `kayıt ${i.budgetMaxRecords} (uzun ${i.budgetMaxLongTerm} · kısa ${i.budgetMaxShortTerm}) · ${i.budgetMaxChars} karakter`));

  return out;
}
