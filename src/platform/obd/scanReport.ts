/**
 * scanReport — Tarama Kapsamı (Scan Completeness) modeli (OBD-OS-F1-4).
 *
 * NEDEN: "SİSTEM TEMİZ" demek yetmez — kullanıcının NE KADARININ tarandığını bilmesi
 * gerekir. Mode 07 timeout verdiyse ekran "temiz" demiyor (F0-1 bunu çözdü), ama
 * kullanıcı hâlâ NEYİN eksik kaldığını göremiyordu. Bu modül taramanın kapsamını
 * ölçülebilir hale getirir: hangi mod denendi, başardı, düştü, araç desteklemiyor.
 *
 * DÜRÜST COVERAGE TANIMI: 'unsupported' (araç o modu HİÇ bilmiyor — ör. Mode 0A, 2010
 * öncesi araçlarda yok) bir KAPSAM KAYBI DEĞİLDİR; okunamayan şey değil, var olmayan
 * şeydir → paydaya girmez. Kapsam kaybı yalnız GERÇEK hatadır (timeout/hata). Aksi halde
 * eski bir araçta coverage sonsuza dek <1 kalır ve rozet anlamını yitirir (gürültü).
 *
 * SAF: modül-durumu yok, yan-etki yok — tam test edilebilir.
 */

import type { DtcScanMode } from './dtcVerdict';

/** Bir teşhis modunun tarama sonucu. */
export type ScanModeStatus = 'ok' | 'failed' | 'unsupported' | 'not_run';

export interface ScanModeEntry {
  mode: DtcScanMode;
  /** Kullanıcıya gösterilecek TR etiket ('Onaylı kodlar (Mode 03)'…). */
  label: string;
  status: ScanModeStatus;
}

export interface ScanReport {
  modes: ScanModeEntry[];
  /**
   * Kapsam oranı 0..1 = başarılı / (başarılı + düşen). 'unsupported' ve 'not_run'
   * paydaya GİRMEZ (bkz. dürüst coverage tanımı). Hiç mod denenmediyse 0.
   */
  coverage: number;
  /** coverage === 1 VE en az bir mod başarıyla okundu. */
  complete: boolean;
  /** Gerçek hata/timeout ile düşen mod sayısı. */
  failedCount: number;
  /** Araç tarafından desteklenmeyen mod sayısı (kapsam kaybı DEĞİL — bilgi). */
  unsupportedCount: number;
  /** UI rozeti için tek satır özet. */
  summary: string;
}

const LABELS: Record<DtcScanMode, string> = {
  stored:    'Onaylı kodlar',
  pending:   'Bekleyen kodlar',
  permanent: 'Kalıcı kodlar',
  status:    'MIL / monitörler',
};

export interface ScanReportInput {
  /** Her mod için sonuç. Eksik bırakılan mod 'not_run' sayılır. */
  stored?: ScanModeStatus;
  pending?: ScanModeStatus;
  permanent?: ScanModeStatus;
  status?: ScanModeStatus;
}

/**
 * Tarama kapsam raporu üretir (saf).
 * Kabul kriteri (F1-4): kısmi taramada coverage < 1 raporlanır.
 */
export function buildScanReport(input: ScanReportInput): ScanReport {
  const order: DtcScanMode[] = ['stored', 'pending', 'permanent', 'status'];
  const modes: ScanModeEntry[] = order.map((mode) => ({
    mode,
    label: LABELS[mode],
    status: input[mode] ?? 'not_run',
  }));

  const ok = modes.filter((m) => m.status === 'ok').length;
  const failed = modes.filter((m) => m.status === 'failed').length;
  const unsupported = modes.filter((m) => m.status === 'unsupported').length;

  const denom = ok + failed;
  const coverage = denom === 0 ? 0 : ok / denom;
  const complete = coverage === 1 && ok > 0;

  let summary: string;
  if (ok === 0 && failed === 0) {
    summary = 'Tarama yapılmadı.';
  } else if (failed > 0) {
    const failedLabels = modes.filter((m) => m.status === 'failed').map((m) => m.label).join(', ');
    summary = `Kısmi tarama — okunamadı: ${failedLabels}.`;
  } else if (unsupported > 0) {
    const unsupLabels = modes.filter((m) => m.status === 'unsupported').map((m) => m.label).join(', ');
    summary = `Tam tarama — araç şunları desteklemiyor: ${unsupLabels}.`;
  } else {
    summary = 'Tam tarama — denetlenen tüm modlar okundu.';
  }

  return { modes, coverage, complete, failedCount: failed, unsupportedCount: unsupported, summary };
}
