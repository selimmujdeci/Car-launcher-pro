/**
 * markdown-writer.mjs — Markdown raporlar YALNIZCA report.json'dan render edilir.
 *
 * Bu dosyada dosya sistemi okuması, komut çalıştırma veya yeniden hesaplama YOKTUR:
 * render fonksiyonları SAF'tır (report → string). Böylece "JSON şunu diyor ama
 * markdown bunu yazıyor" ayrışması yapısal olarak imkânsızdır.
 *
 * Üç okuyucu, üç rapor:
 *  - QA_REPORT.md    → mühendis: her faz, her bulgu, her artefakt
 *  - OEM_REPORT.md   → karar verici: verdict, skor, coverage, ne eksik
 *  - BUILD_REPORT.md → paket kimliği: hash, sürüm, imza, izin yüzeyi
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERDICT_ICON = Object.freeze({
  REJECTED:         '⛔',
  HOST_VERIFIED:    '🟡',
  OEM_READY:        '🟢',
  PRODUCTION_READY: '🟢',
  FLAGSHIP_READY:   '🏆',
});

const RESULT_ICON = Object.freeze({
  PASS:               '✅',
  PASS_WITH_WARNINGS: '⚠️',
  FAIL:               '❌',
  SKIPPED_NA:         '⏭️',
  MANUAL_PENDING:     '🖐️',
  INCOMPLETE:         '🚧',
});

const SEVERITY_ICON = Object.freeze({ blocker: '⛔', major: '🔴', minor: '🟠', info: 'ℹ️' });

function pct(ratio) { return `${Math.round((ratio ?? 0) * 100)}%`; }

function coverageTable(report) {
  const c = report.coverage ?? {};
  const rows = ['host', 'device', 'vehicle'].map((d) => {
    const b = c[d] ?? { planned: 0, executed: 0, skipped: 0, manual: 0, ratio: 0 };
    return `| ${d} | ${b.executed}/${b.planned} | ${pct(b.ratio)} | ${b.skipped} | ${b.manual} |`;
  });
  return [
    '| Alan | Kanıt üreten / planlanan | Coverage | Atlanan | Manuel bekleyen |',
    '|------|--------------------------|----------|---------|-----------------|',
    ...rows,
  ].join('\n');
}

/** Mühendis raporu — tam döküm. */
export function renderQaReport(report) {
  const lines = [];
  lines.push('# OEM Validation Lab — QA Raporu', '');
  lines.push(`**Koşu:** \`${report.runId}\` · **Profil:** ${report.profile.name} (\`${report.profile.lane}\` lane)`);
  lines.push(`**Verdict:** ${VERDICT_ICON[report.verdict.value] ?? ''} **${report.verdict.value}** · **Skor:** ${report.score.value}/100 · **Süre:** ${(report.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  lines.push('## Coverage', '', coverageTable(report), '');
  if (!report.capabilities.deviceLayerImplemented) {
    lines.push('> ⚠️ **Cihaz katmanı bu koşuda YOK** (PR-1 host foundation). Device/vehicle coverage 0 → verdict tavanı `HOST_VERIFIED`.', '');
  }

  lines.push('## Fazlar', '');
  lines.push('| # | Faz | Sonuç | Ağırlık | Süre | Bulgu |');
  lines.push('|---|-----|-------|---------|------|-------|');
  for (const p of report.phases) {
    lines.push(`| ${p.order} | ${p.name} | ${RESULT_ICON[p.result] ?? ''} ${p.result} | ${p.effectiveWeight ?? p.weight} | ${(p.durationMs / 1000).toFixed(1)}s | ${p.findings.length} |`);
  }
  lines.push('');

  for (const p of report.phases) {
    lines.push(`### ${RESULT_ICON[p.result] ?? ''} ${p.id} — ${p.result}`, '');
    if (p.skippedReason) lines.push(`**Atlanma sebebi:** ${p.skippedReason}`, '');
    if (p.manualFallback) lines.push(`**Manuel karşılık:** ${p.manualFallback}`, '');

    const checks = p.metrics?.checks;
    if (Array.isArray(checks) && checks.length > 0) {
      lines.push('| Kontrol | Durum | Detay |', '|---------|-------|-------|');
      for (const c of checks) lines.push(`| ${c.id} | ${RESULT_ICON[c.status] ?? ''} ${c.status} | ${c.detail ?? ''} |`);
      lines.push('');
    }

    if (p.findings.length > 0) {
      lines.push('**Bulgular:**', '');
      for (const f of p.findings) {
        lines.push(`- ${SEVERITY_ICON[f.severity] ?? ''} **${f.title}** (\`${f.severity}\`)`);
        if (f.detail)      lines.push(`  - Detay: ${f.detail}`);
        if (f.remediation) lines.push(`  - Çözüm: ${f.remediation}`);
        if (f.evidence)    lines.push(`  - Kanıt: \`${f.evidence}\``);
      }
      lines.push('');
    }

    if (p.artifacts.length > 0) {
      lines.push('**Artefaktlar:** ' + p.artifacts.map((a) => `\`${a.path}\`${a.truncated ? ' (kesildi)' : ''}`).join(', '), '');
    }
  }

  lines.push('---', '', `Şema v${report.schemaVersion} · report.json tek gerçek kaynaktır; bu dosya ondan render edilmiştir.`);
  return lines.join('\n') + '\n';
}

/** Karar verici raporu — "satılabilir mi?" */
export function renderOemReport(report) {
  const v = report.verdict.value;
  const lines = [];
  lines.push('# OEM Hazırlık Raporu', '');
  lines.push(`## ${VERDICT_ICON[v] ?? ''} ${v}`, '');
  lines.push(`**Skor:** ${report.score.value}/100 · **Koşu:** \`${report.runId}\` · **Profil:** ${report.profile.name}`, '');

  lines.push('### Karar gerekçesi', '');
  for (const r of report.verdict.reasons) lines.push(`- ${r}`);
  lines.push('');

  lines.push('### Kanıt kapsamı', '', coverageTable(report), '');

  lines.push('### Bu verdict ne DEMEK DEĞİL', '');
  if (v === 'HOST_VERIFIED') {
    lines.push('- ❌ Gerçek araçta/head unit\'te çalıştığı **kanıtlanmadı**.');
    lines.push('- ❌ Performans, termal, sensör, OBD davranışı **ölçülmedi**.');
    lines.push('- ✅ Yalnız: derleme çıktısı bütünlüğü host tarafında doğrulandı.');
    lines.push('- 📌 `OEM_READY` için gerçek cihaz lane\'i (sonraki PR) gerekir — skor ne olursa olsun.');
  } else if (v === 'REJECTED') {
    lines.push('- Bu paket dağıtılamaz. Aşağıdaki blocker/eksikler kapatılmalı.');
  }
  lines.push('');

  const blockers = report.phases.flatMap((p) => p.findings.filter((f) => f.severity === 'blocker' || f.severity === 'major'));
  if (blockers.length > 0) {
    lines.push('### Kapatılması gerekenler', '');
    for (const f of blockers) lines.push(`- ${SEVERITY_ICON[f.severity]} **${f.title}** — ${f.remediation ?? f.detail ?? ''}`);
    lines.push('');
  }

  const gaps = report.phases.filter((p) => p.result === 'SKIPPED_NA' || p.result === 'MANUAL_PENDING' || p.result === 'INCOMPLETE');
  if (gaps.length > 0) {
    lines.push('### Kanıt boşlukları (skoru şişirmez — coverage düşürür)', '');
    for (const p of gaps) lines.push(`- ${RESULT_ICON[p.result]} \`${p.id}\` — ${p.skippedReason ?? 'kanıt üretilemedi'}`);
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

/** Paket kimliği raporu. */
export function renderBuildReport(report) {
  const build = report.phases.find((p) => p.id === 'build-validation');
  const lines = ['# Build Doğrulama Raporu', ''];
  lines.push(`**Koşu:** \`${report.runId}\``, '');

  if (!build) {
    lines.push('> Build Validation fazı bu koşuda çalışmadı.', '');
    return lines.join('\n') + '\n';
  }

  const m = build.metrics ?? {};
  lines.push(`**Sonuç:** ${RESULT_ICON[build.result] ?? ''} ${build.result} · **Kontroller:** ${m.checksExecuted ?? 0}/${m.checksPlanned ?? 0} (coverage ${pct(m.checkCoverage)})`, '');

  lines.push('## Paket kimliği', '');
  lines.push('| Alan | Değer |', '|------|-------|');
  lines.push(`| Variant | ${m.variant ?? '—'} |`);
  lines.push(`| Paket | ${m.packageName ?? '— (aapt2 yok / APK yok)'} |`);
  lines.push(`| Sürüm | ${m.versionName ?? '—'} (code ${m.versionCode ?? '—'}) |`);
  lines.push(`| SHA-256 | \`${m.sha256 ?? '—'}\` |`);
  lines.push(`| Boyut | ${m.apkBytes ? (m.apkBytes / 1_048_576).toFixed(1) + ' MB' : '—'} |`);
  lines.push(`| İzin sayısı | ${m.permissionCount ?? '—'} |`);
  lines.push('');

  if (Array.isArray(m.checks) && m.checks.length > 0) {
    lines.push('## Kontroller', '', '| Kontrol | Durum | Detay |', '|---------|-------|-------|');
    for (const c of m.checks) lines.push(`| ${c.id} | ${RESULT_ICON[c.status] ?? ''} ${c.status} | ${c.detail ?? ''} |`);
    lines.push('');
  }

  if (build.findings.length > 0) {
    lines.push('## Bulgular', '');
    for (const f of build.findings) {
      lines.push(`- ${SEVERITY_ICON[f.severity] ?? ''} **${f.title}** — ${f.detail ?? ''}`);
      if (f.remediation) lines.push(`  - Çözüm: ${f.remediation}`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

/** Üç markdown raporu diske yazar (yalnız report'tan render). */
export function writeMarkdownReports(outDir, report) {
  mkdirSync(outDir, { recursive: true });
  const files = [
    ['QA_REPORT.md',    renderQaReport(report)],
    ['OEM_REPORT.md',   renderOemReport(report)],
    ['BUILD_REPORT.md', renderBuildReport(report)],
  ];
  const written = [];
  for (const [name, content] of files) {
    const target = join(outDir, name);
    writeFileSync(target, content, 'utf8');
    written.push(target);
  }
  return written;
}
