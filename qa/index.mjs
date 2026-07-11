/**
 * index.mjs — OEM Validation Lab girişi (runner + CLI).
 *
 * KULLANIM
 *   node qa/index.mjs --profile host-only     → koşu (qa:oem:host)
 *   node qa/index.mjs --validate-profile      → profil şema doğrulaması (qa:oem:validate-profile)
 *   node qa/index.mjs --render-only [runDir]  → mevcut report.json'dan markdown'ları yeniden üret (qa:oem:report)
 *
 * İMPORT YAN ETKİSİZ: bu dosyayı import etmek HİÇBİR şey çalıştırmaz. main() yalnız
 * dosya DOĞRUDAN node ile çağrıldığında koşar (testler runLab'i doğrudan çağırır).
 *
 * KAPSAM (PR-1): host lane. Gerçek cihaz (adb) transport'u YOK — context.exec
 * host lane'de adb'yi REDDEDER.
 */
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRegistry } from './core/registry.mjs';
import { createContext, detectHostCapabilities } from './core/context.mjs';
import { createArtifactStore } from './core/artifact-store.mjs';
import { runPhases } from './core/orchestrator.mjs';
import { computeScore } from './core/scoring.mjs';
import { decideVerdict } from './core/verdict.mjs';
import { buildReport } from './reports/report-schema.mjs';
import { writeReportJson } from './reports/json-writer.mjs';
import { writeMarkdownReports } from './reports/markdown-writer.mjs';
import { validateProfile } from './profiles/_schema.mjs';
import { VERDICT } from './core/result-types.mjs';

import buildValidationPhase from './phases/01-build-validation.mjs';

const QA_DIR    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(QA_DIR, '..');

/** PR-1'in faz kataloğu. Yeni faz = burada bir satır (+ profil listesine ekleme). */
export const BUILT_IN_PHASES = Object.freeze([buildValidationPhase]);

/** Kayıtlı fazlarla dolu registry. */
export function createLabRegistry(phases = BUILT_IN_PHASES) {
  const registry = createRegistry();
  for (const p of phases) registry.register(p);
  return registry;
}

export function loadProfile(profileId, repoRoot = REPO_ROOT) {
  const file = join(repoRoot, 'qa', 'profiles', `${profileId}.json`);
  if (!existsSync(file)) throw new Error(`Profil bulunamadı: ${profileId} (${file})`);
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  const { valid, errors } = validateProfile(profile);
  if (!valid) throw new Error(`Profil geçersiz (${profileId}):\n  - ${errors.join('\n  - ')}`);
  return profile;
}

export function loadThresholds(name = 'global', repoRoot = REPO_ROOT) {
  const file = join(repoRoot, 'qa', 'thresholds', `${name}.json`);
  if (!existsSync(file)) throw new Error(`Eşik dosyası bulunamadı: ${name}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Koşu klasörü adı: 2026-07-11T15-04-22Z (dosya sistemi güvenli, sıralanabilir). */
export function runIdFromDate(date) {
  return date.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

/**
 * Lab'i koşar. Tüm bağımlılıklar enjekte edilebilir → testte diske yazmadan çalışır.
 *
 * @param {{profileId?:string, repoRoot?:string, outRoot?:string|null, now?:Date, registry?:object, logger?:function, env?:object}} opts
 * @returns {Promise<{report:object, reportDir:string|null, verdict:string}>}
 */
export async function runLab(opts = {}) {
  const repoRoot   = opts.repoRoot ?? REPO_ROOT;
  const profileId  = opts.profileId ?? 'host-only';
  const now        = opts.now ?? new Date();
  const runId      = runIdFromDate(now);
  const registry   = opts.registry ?? createLabRegistry();
  const logger     = opts.logger ?? ((line) => console.log(line));
  const env        = opts.env ?? process.env;

  const profile    = opts.profile ?? loadProfile(profileId, repoRoot);
  const thresholds = opts.thresholds ?? loadThresholds('global', repoRoot);

  // outRoot === null → dry-run (diske yazma yok; testler böyle koşar)
  const outRoot   = opts.outRoot === null ? null : (opts.outRoot ?? join(repoRoot, 'docs-local', 'qa-runs'));
  const reportDir = outRoot ? join(outRoot, runId) : null;
  if (reportDir) mkdirSync(join(reportDir, 'artifacts'), { recursive: true });
  if (reportDir) mkdirSync(join(reportDir, 'raw'), { recursive: true });

  const artifacts = createArtifactStore({
    baseDir:         reportDir,
    repoRoot,
    maxFiles:        thresholds?.artifacts?.maxFiles,
    maxBytesPerFile: thresholds?.artifacts?.maxBytesPerFile,
  });

  // Yalnız HOST yetenekleri — device.* tespit edilmez (yapısal).
  const detected = opts.capabilities
    ? { capabilities: opts.capabilities, paths: opts.paths ?? {} }
    : detectHostCapabilities(repoRoot, { variant: profile?.build?.variant ?? 'debug', env });
  const { capabilities, paths } = detected;

  const startedAt = now.toISOString();
  const context = createContext({
    repoRoot, runId, startedAt, profile, thresholds, capabilities, paths, artifacts, logger,
  });

  context.log(`🔬 OEM Validation Lab — profil: ${profile.name} · lane: ${profile.lane} · runId: ${runId}`);
  context.log(`   Yetenekler: ${capabilities.join(', ')}`);

  const results = await runPhases(registry, context);
  const scoring = computeScore(results, thresholds);
  const verdict = decideVerdict({ results, score: scoring.score, coverage: scoring.coverage, thresholds, profile });

  const report = buildReport({
    runId,
    startedAt,
    finishedAt: new Date(now.getTime() + (results.reduce((s, r) => s + r.durationMs, 0))).toISOString(),
    repoRoot,
    profile,
    thresholds,
    capabilities,
    results,
    scoring,
    verdict,
    environment: { platform: process.platform, nodeVersion: process.version, ci: Boolean(env.CI) },
    logs: context.logs(),
  });

  if (reportDir) {
    await writeReportJson(reportDir, report);
    writeMarkdownReports(reportDir, report);
  }

  return { report, reportDir, verdict: report.verdict.value };
}

/* ────────────────────────────────────────────────────────────────────────────
 * CLI
 * ──────────────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { profile: 'host-only', mode: 'run', runDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile')               args.profile = argv[++i] ?? 'host-only';
    else if (a === '--validate-profile') { args.mode = 'validate'; if (argv[i + 1] && !argv[i + 1].startsWith('--')) args.profile = argv[++i]; }
    else if (a === '--render-only')      { args.mode = 'render';   if (argv[i + 1] && !argv[i + 1].startsWith('--')) args.runDir = argv[++i]; }
  }
  return args;
}

/** En son koşu klasörü (isim sıralanabilir → sonuncusu en yenisi). */
function latestRunDir(repoRoot) {
  const root = join(repoRoot, 'docs-local', 'qa-runs');
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return dirs.length > 0 ? join(root, dirs[dirs.length - 1]) : null;
}

async function main(argv) {
  const args = parseArgs(argv);

  if (args.mode === 'validate') {
    const dir = join(REPO_ROOT, 'qa', 'profiles');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let bad = 0;
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      const profile = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const { valid, errors } = validateProfile(profile);
      if (valid) {
        console.log(`✅ ${id} — geçerli (lane: ${profile.lane}, tavan: ${profile.maxVerdict})`);
      } else {
        bad++;
        console.error(`❌ ${id} — GEÇERSİZ:\n   - ${errors.join('\n   - ')}`);
      }
    }
    // Fazlar da doğrulanır: profil bilinmeyen faz isteyemez.
    const registry = createLabRegistry();
    for (const f of files) {
      const profile = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      for (const id of profile.phases ?? []) {
        if (!registry.has(id)) { bad++; console.error(`❌ ${profile.id} — bilinmeyen faz: ${id}`); }
      }
    }
    return bad === 0 ? 0 : 1;
  }

  if (args.mode === 'render') {
    const runDir = args.runDir ? resolve(args.runDir) : latestRunDir(REPO_ROOT);
    if (!runDir || !existsSync(join(runDir, 'report.json'))) {
      console.error('❌ report.json bulunamadı — önce `npm run qa:oem:host` koş.');
      return 2;
    }
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    const written = writeMarkdownReports(runDir, report);
    console.log(`📄 Markdown raporlar report.json'dan yeniden üretildi:\n   ${written.map((w) => w.replace(REPO_ROOT, 'repo:')).join('\n   ')}`);
    return 0;
  }

  const { report, reportDir } = await runLab({ profileId: args.profile });
  const icon = report.verdict.value === VERDICT.REJECTED ? '⛔' : '🟡';
  console.log('');
  console.log(`${icon} VERDICT: ${report.verdict.value} · Skor: ${report.score.value}/100`);
  for (const r of report.verdict.reasons) console.log(`   • ${r}`);
  if (reportDir) console.log(`\n📁 Rapor: ${reportDir.replace(REPO_ROOT, 'repo:')}`);
  console.log('   (report.json tek gerçek kaynak — markdown\'lar ondan render edildi)');

  return report.verdict.value === VERDICT.REJECTED ? 1 : 0;
}

// Yalnız doğrudan çalıştırıldığında koş (import yan etkisiz).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`💥 Lab çöktü: ${err?.message ?? err}`);
      process.exitCode = 2;
    });
}
