/**
 * mode06LabModel — SERVİS 06 GÖZLEMİNİN SAF MODELİ (P0-OBD-05).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── MODELİN TEK İŞİ ───────────────────────────────────────────────────────
 * Ham tarama sonucunu ekrana çevirmek. HÜKÜM ÜRETMEZ: geçti/kaldı kararı
 * `mode06.ts` içinde, ECU'nun KENDİ min/max sınırlarına göre verilir. Burada
 * yalnız biçimlendirme ve sınıflandırma vardır.
 *
 * ── ÜÇ DURUM BİRLEŞTİRİLMEZ ───────────────────────────────────────────────
 *   GEÇTİ · KALDI · YORUMLANAMADI   (+ ECU sustu / yanıt bozuk)
 * "Yorumlanamadı" GEÇTİ SAYILMAZ: ölçek kimliği tanınmadığında karşılaştırmanın
 * yönü bile garanti değildir.
 */

import type { Mode06Scan, Mode06EcuResult, Mode06MidResult } from '../obd/mode06Service';
import type { Mode06Test } from '../obd/mode06';

export type Mode06Tone = 'ok' | 'warn' | 'bad' | 'muted';

/** Test sonucu → ton. `UNKNOWN` UYARI DEĞİLDİR: yorumlayamadık demektir. */
export function testTone(result: Mode06Test['result']): Mode06Tone {
  return result === 'PASS' ? 'ok' : result === 'FAIL' ? 'bad' : 'muted';
}

/** MID durumu → ton. `no_data`/`malformed` ASLA `ok` tonunda gösterilmez. */
export function midTone(status: Mode06MidResult['status']): Mode06Tone {
  switch (status) {
    case 'ok':          return 'ok';
    case 'no_data':     return 'muted';
    case 'malformed':   return 'warn';
    case 'unsupported': return 'muted';
    default:            return 'warn';
  }
}

export const MID_STATUS_LABEL: Readonly<Record<Mode06MidResult['status'], string>> = {
  ok:          'OKUNDU',
  no_data:     'ECU SUSTU',
  malformed:   'YANIT BOZUK',
  unsupported: 'DESTEKLENMİYOR',
  error:       'OKUNAMADI',
};

export const ECU_STATUS_LABEL: Readonly<Record<Mode06EcuResult['status'], string>> = {
  ok:          'OKUNDU',
  unsupported: 'MODE 06 YOK',
  failed:      'DÜŞTÜ',
};

export interface TestRow {
  readonly id: string;
  readonly tid: string;
  readonly uas: string;
  /** `12,34 V` · ölçek tanınmıyorsa `ham 4660`. */
  readonly value: string;
  readonly min: string;
  readonly max: string;
  readonly result: Mode06Test['result'];
  readonly tone: Mode06Tone;
  /** Sınıra yakınlık — `null` = hesaplanamaz (yorumlanamayan ölçek). */
  readonly marginPct: number | null;
  readonly note: string | null;
}

function _fmt(v: number | null, unit: string | null, raw: number): string {
  if (v === null) return `ham ${raw}`;
  const n = Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${n} ${unit}` : n;
}

/**
 * Sınıra yakınlık (%0 = tam sınırda, %100 = bandın ortasında).
 *
 * NEDEN VAR: Mode 06'nın asıl değeri "geçti mi" değil, **"sınıra ne kadar
 * yakın"**dır. Kod yanmadan önce bozulmayı gösteren şey budur. Ama bu bir
 * TAHMİN DEĞİL, iki ölçüm arasındaki mesafedir — yorum eklenmez.
 */
export function marginPercent(t: Mode06Test): number | null {
  if (!t.interpretable) return null;
  const span = t.rawMax - t.rawMin;
  if (!Number.isFinite(span) || span <= 0) return null;
  const d = Math.min(t.rawValue - t.rawMin, t.rawMax - t.rawValue);
  return Math.max(0, Math.min(100, Math.round((d / (span / 2)) * 100)));
}

export function buildTestRows(mid: Mode06MidResult): readonly TestRow[] {
  return mid.tests.map((t, i) => {
    const margin = marginPercent(t);
    return {
      id: `${mid.mid}-${t.tid}-${i}`,
      tid: t.tid,
      uas: t.uas,
      value: _fmt(t.value, t.unit, t.rawValue),
      min:   _fmt(t.min,   t.unit, t.rawMin),
      max:   _fmt(t.max,   t.unit, t.rawMax),
      result: t.result,
      tone: testTone(t.result),
      marginPct: margin,
      note: t.interpretable
        ? (margin !== null && margin <= 20 && t.result === 'PASS'
            ? 'Sınıra yakın — geçiyor ama payı az.'
            : null)
        : `Ölçek kimliği ${t.uas} tanınmıyor: değer HAM gösteriliyor ve geçti/kaldı `
          + `hükmü VERİLMEDİ (yanlış birimle ölçeklemek, hiç göstermemekten kötüdür).`,
    };
  });
}

export interface Mode06Overview {
  readonly ecuCount: number;
  readonly readable: number;
  readonly pass: number;
  readonly fail: number;
  readonly unknown: number;
  readonly noData: number;
  readonly malformed: number;
  /** Bütçe tavanı yüzünden sorgulanmayan MID toplamı — sessiz kırpma YOK. */
  readonly truncated: number;
}

export function buildOverview(scan: Mode06Scan | null): Mode06Overview {
  const o = { ecuCount: 0, readable: 0, pass: 0, fail: 0, unknown: 0, noData: 0, malformed: 0, truncated: 0 };
  if (scan === null) return o;
  let readable = 0, pass = 0, fail = 0, unknown = 0, noData = 0, malformed = 0, truncated = 0;
  for (const e of scan.ecus) {
    truncated += e.truncated;
    for (const m of e.mids) {
      if (m.status === 'ok') readable++;
      if (m.status === 'no_data') noData++;
      if (m.status === 'malformed') malformed++;
      for (const t of m.tests) {
        if (t.result === 'PASS') pass++;
        else if (t.result === 'FAIL') fail++;
        else unknown++;
      }
    }
  }
  return { ecuCount: scan.ecus.length, readable, pass, fail, unknown, noData, malformed, truncated };
}

/**
 * Ekranın tepesindeki tek cümlelik dürüst hüküm.
 *
 * "Arıza yok" ASLA DENMEZ: taranmamış bir MID, susmuş bir ECU ya da
 * yorumlanamayan bir ölçek varken temiz beyan vermek fail-open olurdu.
 */
export function buildHeadline(
  scan: Mode06Scan | null, stale: boolean,
): { readonly text: string; readonly tone: Mode06Tone } {
  if (scan === null) return { text: 'HENÜZ TARANMADI', tone: 'muted' };
  if (scan.bridgeMissing) {
    return { text: 'KÖPRÜ YOK — bu APK Servis 06 okuyamıyor', tone: 'muted' };
  }
  if (stale) {
    return { text: 'BAYAT — bu sonuç ÖNCEKİ OBD oturumuna ait', tone: 'warn' };
  }
  const o = buildOverview(scan);
  if (o.ecuCount === 0) return { text: 'ECU BULUNAMADI', tone: 'muted' };
  if (o.readable === 0) {
    return { text: 'HİÇBİR MONİTÖR OKUNAMADI — "test yok" DEĞİL, "sorulamadı"', tone: 'muted' };
  }
  if (o.fail > 0) {
    return { text: `${o.fail} test ECU sınırının DIŞINDA — servis değerlendirmesi gerekir`, tone: 'bad' };
  }
  return {
    text: `${o.pass} test ECU sınırları içinde`
      + (o.unknown > 0 ? ` · ${o.unknown} test yorumlanamadı` : '')
      + (o.noData > 0 ? ` · ${o.noData} monitör sustu` : ''),
    tone: o.unknown > 0 || o.noData > 0 ? 'warn' : 'ok',
  };
}
