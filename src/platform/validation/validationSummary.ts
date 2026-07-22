/**
 * validationSummary — tek dokunuşla üretilen, insan-okur saha özeti (SAF).
 *
 * ⚠️ YENİ ÖLÇÜM YOK. Girdi yalnız `ValidationSnapshot` + `ValidationSummary` +
 * kontrol listesidir; çıktı panoya kopyalanıp WhatsApp/e-postayla paylaşılabilen
 * düz metindir. JSON rapor MAKİNE içindir, bu metin İNSAN içindir.
 *
 * Gizlilik: metin, JSON ile AYNI kaynaklardan beslenir (zaten maskeli) ve son
 * satırda `maskSensitiveText`'ten geçirilir — ham VIN/MAC/koordinat çıkamaz.
 */

import { checklistProgress, FIELD_CHECKLIST, PHASE_LABEL, type ValidationPhase } from './validationChecklist';
import { maskSensitiveText } from './validationExport';
import type { ValidationSnapshot, ValidationStatus, ValidationSummary } from './validationTypes';

const ICON: Readonly<Record<ValidationStatus, string>> = Object.freeze({
  pass: '[OK] ', warn: '[UYARI] ', fail: '[DUSTU] ', skip: '[OLCULMEDI] ',
});

/** null → "ölçülmedi" (uydurma yok). */
function v(value: number | null, unit = ''): string {
  return value === null ? 'ölçülmedi' : `${value}${unit}`;
}

function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min} dk ${sec} sn` : `${sec} sn`;
}

/**
 * Saha özeti metnini kurar — SAF, ASLA throw etmez.
 *
 * `generatedAtWallMs` DIŞARIDAN verilir (saat bu modülde okunmaz) → deterministik test.
 */
export function buildValidationSummaryText(
  snap: ValidationSnapshot,
  summary: ValidationSummary,
  generatedAtWallMs = 0,
): string {
  const L: string[] = [];
  const o = snap.obd;
  const p = snap.perf;
  const prog = checklistProgress(snap.checklistDone);
  const done = new Set(snap.checklistDone);

  L.push('CAROS PRO — SAHA DOĞRULAMA ÖZETİ');
  L.push('='.repeat(44));
  L.push(`Oturum   : ${snap.sessionId || '(yok)'}`);
  L.push(`Süre     : ${durationText(snap.durationMs)}${snap.active ? ' (kayıt sürüyor)' : ''}`);
  if (generatedAtWallMs > 0) L.push(`Üretildi : ${new Date(generatedAtWallMs).toISOString()}`);
  L.push('');

  /* ── Genel karar ── */
  L.push(`GENEL SONUÇ: ${ICON[summary.overall].trim()}`);
  L.push(`  ${summary.passed} geçti · ${summary.warned} uyarı · ${summary.failed} düştü · ${summary.skipped} ölçülmedi`);
  L.push('');

  /* ── Testler ── */
  L.push('TESTLER');
  L.push('-'.repeat(44));
  for (const t of summary.tests) L.push(`${ICON[t.status]}${t.label}: ${t.detail}`);
  L.push('');

  /* ── Ölçümler ── */
  L.push('OBD');
  L.push('-'.repeat(44));
  L.push(`  Adaptör        : ${o.adapterName || '(bilinmiyor)'} ${o.adapterAddrMasked}`.trimEnd());
  L.push(`  Transport      : ${o.transport}`);
  L.push(`  Bağlantı süresi: ${v(o.connectDurationMs, ' ms')}`);
  L.push(`  Protokol       : aktif ${o.protocolActive ?? 'yok'} / denenen ${o.protocolTried ?? 'yok'}`);
  L.push(`  VIN            : ${o.vinPresent ? (o.vinMasked ?? 'okundu') : 'okunmadı'}`);
  L.push(`  ECU / PID / DTC: ${v(o.ecuCount)} / ${o.pidCount} / ${v(o.dtcCount)}`);
  L.push(`  Kopma / deneme : ${o.disconnectCount} / ${o.reconnectAttempts}`);
  L.push('');

  L.push('PERFORMANS');
  L.push('-'.repeat(44));
  L.push(`  Canlı paket      : ${p.liveDataSamples}`);
  L.push(`  Ort. veri yaşı   : ${v(p.avgLiveLatencyMs, ' ms')}`);
  L.push(`  Ort. polling     : ${v(p.avgPollIntervalMs, ' ms')}`);
  L.push(`  Maks. boşluk     : ${v(p.maxLatencyMs, ' ms')}`);
  L.push(`  Timeout/kurtarma : ${p.timeoutCount} / ${p.recoveryCount}`);
  L.push(`  Bellek (an/tepe) : ${v(p.memoryUsedMb, ' MB')} / ${v(p.memoryPeakMb, ' MB')}`);
  L.push(`  FPS (ort/min)    : ${v(p.avgFps)} / ${v(p.minFps)}`);
  L.push('');

  /* ── Mavi ── */
  L.push(`MAVİ (${snap.mavi.length} çağrı)`);
  L.push('-'.repeat(44));
  if (snap.mavi.length === 0) {
    L.push('  Bu oturumda Mavi çağrısı yapılmadı.');
  } else {
    const ok = snap.mavi.reduce((n, r) => n + (r.ok ? 1 : 0), 0);
    const avg = Math.round(snap.mavi.reduce((n, r) => n + r.durationMs, 0) / snap.mavi.length);
    L.push(`  Başarılı: ${ok}/${snap.mavi.length} · ortalama ${avg} ms`);
    for (const r of snap.mavi.slice(-5)) {
      L.push(`  ${r.ok ? '[OK]' : '[HATA]'} ${r.intentKind}/${r.operatorTask} · ${Math.round(r.durationMs)} ms`
        + `${r.errorKind ? ` · ${r.errorKind}` : ''}`);
    }
  }
  L.push('');

  /* ── Kontrol listesi (beyan — ölçüm değil) ── */
  L.push(`SAHA ADIMLARI (${prog.done}/${prog.total} · %${prog.pct})`);
  L.push('-'.repeat(44));
  let lastPhase: ValidationPhase | null = null;
  for (const item of FIELD_CHECKLIST) {
    if (item.phase !== lastPhase) {
      L.push(`  ${PHASE_LABEL[item.phase]}`);
      lastPhase = item.phase;
    }
    L.push(`    [${done.has(item.id) ? 'X' : ' '}] ${item.label}`);
  }
  L.push('');

  /* ── Dürüstlük notu ── */
  L.push('-'.repeat(44));
  L.push('NOT: "ölçülmedi" bir BAŞARISIZLIK DEĞİLDİR — o ölçüm bu oturumda hiç');
  L.push('yapılamamıştır. İşaretlenmemiş saha adımları, ilgili ölçümün hangi');
  L.push('koşulda toplandığının BİLİNMEDİĞİ anlamına gelir.');

  // Uzun belge → alan-bazlı kırpma UYGULANMAZ, maskeleme UYGULANIR.
  return maskSensitiveText(L.join('\n'), Number.POSITIVE_INFINITY);
}
