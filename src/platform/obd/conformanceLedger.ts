/**
 * conformanceLedger — P0-VDK-F2C2 · SON UYGUNLUK KOŞUSUNUN KAYDI.
 *
 * `conformanceRun` SAFTIR ve hiçbir yere yazmaz; bu dosya onun tek yan-etkili
 * kabuğudur: son koşunun sonucunu tutar ve boşluk sinyallerini `gapRegistry`ye
 * geçirir.
 *
 * ── BU DOSYA NE DEĞİLDİR ────────────────────────────────────────────────────
 * (1) **KOŞU BAŞLATMAZ.** Yalnız biten bir koşunun sonucunu KAYDEDER.
 * (2) **HÜKÜM ÜRETMEZ.** `verdict` koşunun kendisinden gelir; burada
 *     yeniden hesaplanmaz.
 * (3) **KALICI DEPO DEĞİLDİR.** Süreç ömürlü; diske/buluta yazmaz.
 *
 * TEK kayıt (son koşu) · timer yok · I/O yok · `Date.now` yok (damga enjekte).
 */

import type { ConformanceRunResult } from './conformanceRun';
import { recordGaps } from './gapRegistry';

let _last: ConformanceRunResult | null = null;

/**
 * Koşu sonucunu kaydeder ve boşluk sinyallerini sicile geçirir.
 *
 * Sicil kaydı KOŞUNUN KENDİSİNDEN ayrıdır: koşu `PASS` verse bile ölçülemeyen
 * bir alan varsa o sinyal sicile düşer — "geçti" demek "her şey ölçüldü"
 * demek DEĞİLDİR ve bu ayrım gelecekteki çözücünün tek girdisidir.
 */
/**
 * ⚠️ P0-VDK-F5D — BU ÜRETİCİ KANIT ZARFI TAŞIMAZ (bilinçli, uydurma değil).
 *
 * Uygunluk/parite boşluğu bir ECU ölçümünden DEĞİL, iki kaydın
 * KARŞILAŞTIRILMASINDAN doğar: ortada hedeflenebilir tek bir
 * (ECU × servis × alt fonksiyon × NRC) künyesi YOKTUR. Buraya boş bir zarf
 * yazmak "kanıt var" izlenimi verirdi; ham gövde kopyalamak ise §4 gizlilik
 * kuralını çiğnerdi (parser boşluğu ham gövdeyi ASLA taşımaz).
 *
 * Bu yüzden kayıt zarfsız yazılır ve sicilde dürüstçe `UNAVAILABLE` görünür;
 * LAB bunu FAIL-CLOSED "KANIT BAĞI EKSİK" olarak gösterir. Çözücü zaten bu
 * sınıfı `PARSER_BOUND` sayıp `BLOCKED` bırakır — ölçümle kapanmaz.
 */
export function recordConformanceRun(
  result: ConformanceRunResult, atMs: number | null,
): void {
  try {
    _last = result;
    if (result.gapSignals.length > 0) {
      recordGaps(result.gapSignals, 'CONFORMANCE',
        `conformance:${result.provenance}`, atMs, result.runId);
    }
    /* Ölçülemeyen alanlar da yapısal bir boşluktur: hangi katmanda ölçüm
       yapılamadığı, ileride "neyi tamamlamalıyım" sorusunun cevabıdır. */
    for (const c of result.checks) {
      if (c.outcome !== 'UNMEASURED') continue;
      recordGaps(['TRANSPORT_LIMITATION'], c.layer === 'UNKNOWN' ? 'UNKNOWN' : c.layer,
        `unmeasured:${c.id}`, atMs, result.runId);
    }
  } catch { /* kayıt ASLA koşuyu düşürmez */ }
}

/** LAB salt-okuma yüzeyi. Koşu yapılmadıysa `null` — "geçti" VARSAYILMAZ. */
export function getLastConformanceRun(): ConformanceRunResult | null { return _last; }

/** @internal — testler arası izolasyon. */
export function _resetConformanceLedgerForTest(): void { _last = null; }
