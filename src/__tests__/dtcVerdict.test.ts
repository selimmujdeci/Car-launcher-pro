/**
 * dtcVerdict — Fail-Closed DTC verdi regresyon kilidi (OBD-OS-F0-1).
 *
 * KİLİTLENEN DAVRANIŞ (bir daha sessizce fail-OPEN'a dönmesin):
 *  - "temiz" ANCAK tarama yapıldı + hiç bulgu yok + hiçbir mod düşmediyse.
 *  - Mode 03 boş ama bekleyen/kalıcı kod veya MIL varsa → 'issues' (yalancı temiz YASAK).
 *  - Bulgu yok ama bir okuma düştüyse → 'inconclusive' (kısmi tarama).
 *  - 'unsupported' bir hata değildir; belirsizlik üretmez.
 */

import { describe, it, expect } from 'vitest';
import { computeDtcVerdict, type DtcVerdictInput } from '../platform/obd/dtcVerdict';

/** Tüm modlar başarılı + hiç bulgu yok → temiz taban. Testler bunu daraltır. */
function base(): DtcVerdictInput {
  return {
    scanRan: true,
    storedCount: 0,
    pendingCount: 0,
    permanentCount: 0,
    mil: false,
    pid01DtcCount: 0,
    failedModes: [],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   OBD-OS-F1-2 — MIL/DTC TUTARSIZLIĞI (Car Scanner farkının ilk UI sinyali).
   ECU "arıza var" diyor ama standart modların (03/07/0A) HİÇBİRİNDE kod yok →
   kod üretici tabanındadır (UDS 0x19). Kullanıcıya "kod yok" demek yanlış güven;
   "standart tarama YETMİYOR" demek dürüst olandır.
═══════════════════════════════════════════════════════════════════════════ */
describe('OBD-OS-F1-2 — MIL/DTC tutarsızlık uyarısı', () => {
  it('🔒 KİLİT: MIL yanıyor + hiçbir standart modda kod yok → mil_without_codes uyarısı', () => {
    const v = computeDtcVerdict({ ...base(), mil: true });
    expect(v.advisories).toContain('mil_without_codes');
    expect(v.verdict).toBe('issues');   // MIL zaten bulgudur — "temiz" DEMEZ
  });

  it('🔒 KİLİT: PID01 kod sayacı > 0 + standart modlar boş → uyarı üretilir', () => {
    const v = computeDtcVerdict({ ...base(), pid01DtcCount: 3 });
    expect(v.advisories).toContain('mil_without_codes');
  });

  it('standart modda kod VARSA uyarı üretilmez (tutarsızlık yok — kod bulundu)', () => {
    expect(computeDtcVerdict({ ...base(), mil: true, storedCount: 1 }).advisories).toHaveLength(0);
    expect(computeDtcVerdict({ ...base(), mil: true, pendingCount: 1 }).advisories).toHaveLength(0);
    expect(computeDtcVerdict({ ...base(), mil: true, permanentCount: 1 }).advisories).toHaveLength(0);
  });

  it('ZERO-TRUST: MIL/sayaç OKUNAMADIYSA (null) uyarı UYDURULMAZ', () => {
    const v = computeDtcVerdict({ ...base(), mil: null, pid01DtcCount: null });
    expect(v.advisories).toHaveLength(0);
  });

  it('ECU arıza bildirmiyorsa (MIL kapalı, sayaç 0) uyarı yok — temiz araçta gürültü YASAK', () => {
    expect(computeDtcVerdict(base()).advisories).toHaveLength(0);
  });

  it('kısmi tarama (inconclusive) sırasında da uyarı taşınır — bilgi kaybolmaz', () => {
    const v = computeDtcVerdict({ ...base(), mil: true, failedModes: ['pending'] });
    expect(v.advisories).toContain('mil_without_codes');
  });
});

describe('OBD-OS-F0-1 — computeDtcVerdict (fail-closed)', () => {
  it('tarama yapılmadıysa → not_scanned', () => {
    expect(computeDtcVerdict({ ...base(), scanRan: false }).verdict).toBe('not_scanned');
  });

  it('tüm modlar başarılı + bulgu yok → clean', () => {
    expect(computeDtcVerdict(base()).verdict).toBe('clean');
  });

  it('onaylı (Mode 03) kod var → issues', () => {
    expect(computeDtcVerdict({ ...base(), storedCount: 2 }).verdict).toBe('issues');
  });

  // ── Car Scanner farkı senaryosu: Mode 03 boş ama başka kanıt var → ASLA temiz ──
  it('Mode 03 boş AMA bekleyen (Mode 07) kod var → issues (yalancı temiz YASAK)', () => {
    const v = computeDtcVerdict({ ...base(), pendingCount: 1 });
    expect(v.verdict).toBe('issues');
    expect(v.issueSources).toContain('bekleyen kod');
  });

  it('Mode 03 boş AMA kalıcı (Mode 0A) kod var → issues', () => {
    expect(computeDtcVerdict({ ...base(), permanentCount: 1 }).verdict).toBe('issues');
  });

  it('Mode 03 boş AMA MIL yanıyor → issues', () => {
    const v = computeDtcVerdict({ ...base(), mil: true });
    expect(v.verdict).toBe('issues');
    expect(v.issueSources.some((s) => s.includes('MIL'))).toBe(true);
  });

  it('Mode 03 boş AMA PID01 DTC sayısı > 0 (üretici kodu) → issues', () => {
    const v = computeDtcVerdict({ ...base(), pid01DtcCount: 3 });
    expect(v.verdict).toBe('issues');
    expect(v.issueSources.some((s) => s.includes('üretici'))).toBe(true);
  });

  // ── Fail-closed belirsizlik ──
  it('bulgu yok ama bir okuma düştü → inconclusive (temiz DEĞİL)', () => {
    const v = computeDtcVerdict({ ...base(), failedModes: ['pending'] });
    expect(v.verdict).toBe('inconclusive');
    expect(v.reason).toContain('pending');
  });

  it('PID01 (status) okunamadı → inconclusive', () => {
    expect(computeDtcVerdict({ ...base(), mil: null, pid01DtcCount: null, failedModes: ['status'] }).verdict)
      .toBe('inconclusive');
  });

  it('bulgu VE düşen mod birlikte → bulgu önceliklidir (issues)', () => {
    expect(computeDtcVerdict({ ...base(), pendingCount: 1, failedModes: ['permanent'] }).verdict).toBe('issues');
  });

  it("'unsupported' hata sayılmaz — completeness kaynağı failedModes'a girmez → clean korunur", () => {
    // failedModes yalnız gerçek hataları taşır; unsupported mod belirsizlik yapmaz.
    expect(computeDtcVerdict(base()).verdict).toBe('clean');
  });
});
