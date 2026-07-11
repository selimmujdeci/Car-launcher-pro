/**
 * 01-build-validation.mjs — FAZ 1: Build Validation (host-only, cihaz GEREKTİRMEZ).
 *
 * SORU: "Cihaza gidecek paket gerçekten bizim paketimiz mi, imzalı mı, beklenen
 * izinlerle mi, eski head unit WebView'ında parse edilebilir mi?"
 *
 * MEVCUT ARAÇLARI YENİDEN KULLANIR (yeni bağımlılık YOK):
 *  - scripts/verify-webview-compat.mjs → ES2015 boot-sözdizimi kapısı (apk:safe'in kapısı)
 *  - android/build.gradle buildDir override → APK'nın gerçek yeri
 *  - version.properties → sürüm tek kaynağı
 *  - Android SDK build-tools: aapt2 (badging), apksigner (imza)
 *
 * FAIL-SOFT: aapt2/apksigner/APK/dist yoksa Lab ÇÖKMEZ — ilgili KONTROL
 * SKIPPED_NA olur, coverage düşer, faz en fazla PASS_WITH_WARNINGS alır.
 * "Kontrol koşamadı" ASLA "kontrol geçti" sayılmaz.
 */
import { existsSync, createReadStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  definePhase, phaseOutcome, check, finding, rollupChecks,
  PHASE_RESULT, PHASE_CATEGORY, SEVERITY, CAPABILITY,
} from './_phase.mjs';

/*
 * TESPİT TEK YERDE: APK / aapt2 / apksigner yollarını context TAŞIR
 * (detectHostCapabilities → context.paths). Faz KENDİ BAŞINA arama YAPMAZ —
 * yoksa enjekte edilen "araç yok" senaryosu sessizce gerçek SDK'ya düşer ve
 * fail-soft davranışı test edilemez hale gelir (bu hatayı testler yakaladı).
 */

/** Dosyanın SHA-256'sı — stream (büyük APK belleğe alınmaz). */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = createReadStream(path);
    rs.on('error', reject);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
}

/** aapt2 badging çıktısını ayrıştırır. (Test edilebilir — dışa açık.) */
export function parseBadging(stdout) {
  const out = {
    packageName: null,
    versionCode: null,
    versionName: null,
    permissions: [],
    debuggable:  false,
  };
  const pkg = stdout.match(/package:\s*name='([^']+)'\s*versionCode='([^']*)'\s*versionName='([^']*)'/);
  if (pkg) {
    out.packageName = pkg[1];
    out.versionCode = pkg[2];
    out.versionName = pkg[3];
  }
  const permRe = /uses-permission:\s*name='([^']+)'/g;
  let m;
  while ((m = permRe.exec(stdout)) !== null) out.permissions.push(m[1]);
  out.debuggable = /application-debuggable/.test(stdout);
  return out;
}

/**
 * İzin farkı — sözleşme (manifest-expectations.json) ile APK'nın GERÇEK izin yüzeyi.
 * `unexpectedCritical` = sözleşmede olmayan VE kritik/yasaklı → blocker.
 */
export function diffPermissions(found, expect) {
  // Sözleşme = kaynak manifest izinleri ∪ manifest-merge ile kütüphanelerden GELEN
  // izinler. (Kaynak manifest, sevk edilen APK'nın izin yüzeyine EŞİT DEĞİLDİR —
  // bu farkı ilk host koşusu ortaya çıkardı.)
  const allowedList = [...(expect?.allowedPermissions ?? []), ...(expect?.mergedPermissions ?? [])];
  const allowed   = new Set(allowedList);
  const critical  = new Set(expect?.criticalPermissions ?? []);
  const forbidden = new Set(expect?.forbiddenPermissions ?? []);
  const unexpected = found.filter((p) => !allowed.has(p));
  return {
    unexpected,
    banned:  found.filter((p) => forbidden.has(p)),
    missing: allowedList.filter((p) => !found.includes(p)),
    unexpectedCritical: unexpected.filter((p) => critical.has(p) || forbidden.has(p)),
  };
}

/** version.properties tek-kaynak sürümü. */
export function readVersionProperties(repoRoot) {
  const file = join(repoRoot, 'android', 'version.properties');
  const alt  = join(repoRoot, 'version.properties');
  const path = existsSync(file) ? file : (existsSync(alt) ? alt : null);
  if (!path) return null;
  try {
    const text = readFileSync(path, 'utf8');
    const code = text.match(/VERSION_CODE\s*=\s*(\S+)/);
    const name = text.match(/VERSION_NAME\s*=\s*(\S+)/);
    return { versionCode: code?.[1] ?? null, versionName: name?.[1] ?? null, path };
  } catch {
    return null;
  }
}

export default definePhase({
  id:             'build-validation',
  name:           'Build Validation — paket bütünlüğü, imza, izin yüzeyi, WebView uyumu',
  order:          10,
  weight:         3,
  category:       PHASE_CATEGORY.BUILD,
  requires:       [CAPABILITY.HOST_REPO],   // APK/dist/aapt YOKSA faz yine koşar; kontroller tek tek atlanır
  safetyCritical: false,

  async run(context) {
    const { repoRoot, profile } = context;
    const variant   = profile?.build?.variant ?? 'debug';
    const expect    = loadExpectations(repoRoot);
    const checks    = [];
    const findings  = [];
    const artifacts = [];
    const metrics   = { variant, apkBytes: null, sha256: null, packageName: null, versionName: null, versionCode: null, permissionCount: null };

    /* ── 1) Web build çıktısı (dist/) ─────────────────────────────────── */
    const distIndex = join(repoRoot, 'dist', 'index.html');
    const hasDist   = existsSync(distIndex);
    checks.push(check({
      id:     'web-dist',
      title:  'Web build çıktısı (dist/index.html)',
      status: hasDist ? PHASE_RESULT.PASS : PHASE_RESULT.SKIPPED_NA,
      detail: hasDist ? 'dist/index.html mevcut' : 'dist/ yok — `npm run build` çalıştırılmamış (kontrol atlandı, GEÇTİ SAYILMAZ)',
    }));

    /* ── 2) Eski WebView boot-sözdizimi kapısı (mevcut script) ────────── */
    const compatScript = join(repoRoot, 'scripts', 'verify-webview-compat.mjs');
    if (hasDist && existsSync(compatScript)) {
      const res = await context.exec(process.execPath, [compatScript], { timeoutMs: 60_000 });
      const ref = context.artifacts.writeRaw('compat-verify.txt', `${res.stdout}\n${res.stderr}`);
      artifacts.push(ref);
      checks.push(check({
        id:     'webview-compat',
        title:  'Eski head unit WebView ES2015 boot kapısı (scripts/verify-webview-compat.mjs)',
        status: res.ok ? PHASE_RESULT.PASS : PHASE_RESULT.FAIL,
        detail: res.ok ? 'Modern sözdizimi sızıntısı yok' : `compat:verify düştü (exit ${res.code})`,
      }));
      if (!res.ok) {
        findings.push(finding({
          id: 'build.webview-compat-fail',
          severity: SEVERITY.BLOCKER,
          title: 'Build çıktısı eski WebView\'da parse edilemiyor',
          detail: 'verify-webview-compat.mjs düştü → Chrome 52-79 head unit\'lerde boot ölümü riski.',
          evidence: ref.path,
          remediation: 'Sızan modern sözdizimini bul (worker/bağımlılık), plugin-legacy hedefini koru.',
        }));
      }
    } else {
      checks.push(check({
        id:     'webview-compat',
        title:  'Eski head unit WebView ES2015 boot kapısı',
        status: PHASE_RESULT.SKIPPED_NA,
        detail: hasDist ? 'scripts/verify-webview-compat.mjs bulunamadı' : 'dist/ yok — önce `npm run build`',
      }));
    }

    /* ── 3) APK varlığı ───────────────────────────────────────────────── */
    const apk = context.paths?.apk ?? null;
    checks.push(check({
      id:     'apk-present',
      title:  `APK üretilmiş mi (${variant})`,
      status: apk ? PHASE_RESULT.PASS : PHASE_RESULT.SKIPPED_NA,
      detail: apk ? `APK bulundu: ${context.safePath(apk)}` : 'APK yok — `npm run apk:safe` çalıştırılmamış (kontrol atlandı, GEÇTİ SAYILMAZ)',
    }));

    if (!apk) {
      findings.push(finding({
        id: 'build.apk-missing',
        severity: SEVERITY.MAJOR,
        title: 'APK kanıtı yok',
        detail: 'Paket bütünlüğü/imza/izin kontrolleri koşulamadı — build coverage eksik.',
        remediation: '`npm run apk:safe` ile taze APK üret, sonra `npm run qa:oem:host` tekrar koş.',
      }));
      return finalize(checks, findings, artifacts, metrics);
    }

    /* ── 4) SHA-256 (paket kimliği) ───────────────────────────────────── */
    try {
      const { size } = await import('node:fs/promises').then((fs) => fs.stat(apk));
      const digest = await sha256File(apk);
      metrics.apkBytes = size;
      metrics.sha256   = digest;
      checks.push(check({
        id: 'apk-sha256', title: 'APK SHA-256 (yayın izlenebilirliği)',
        status: PHASE_RESULT.PASS,
        detail: `${digest.slice(0, 16)}… (${(size / 1_048_576).toFixed(1)} MB)`,
        metrics: { sha256: digest, bytes: size },
      }));
    } catch (e) {
      checks.push(check({
        id: 'apk-sha256', title: 'APK SHA-256',
        status: PHASE_RESULT.INCOMPLETE,
        detail: `Hash üretilemedi: ${String(e?.message ?? e).slice(0, 120)}`,
      }));
    }

    /* ── 5) aapt2 badging: paket / sürüm / izinler / debuggable ───────── */
    const aapt2 = context.paths?.aapt2 ?? null;
    if (!aapt2) {
      const na = 'aapt2 bulunamadı (Android SDK build-tools yok) — kontrol atlandı, GEÇTİ SAYILMAZ';
      checks.push(check({ id: 'apk-package',     title: 'Paket adı doğru mu',        status: PHASE_RESULT.SKIPPED_NA, detail: na }));
      checks.push(check({ id: 'apk-version',     title: 'Sürüm bilgisi okunuyor mu', status: PHASE_RESULT.SKIPPED_NA, detail: na }));
      checks.push(check({ id: 'apk-permissions', title: 'İzin yüzeyi beklendiği gibi mi', status: PHASE_RESULT.SKIPPED_NA, detail: na }));
      checks.push(check({ id: 'apk-debuggable',  title: 'Release APK debug-only ayar taşıyor mu', status: PHASE_RESULT.SKIPPED_NA, detail: na }));
      findings.push(finding({
        id: 'build.aapt2-missing', severity: SEVERITY.MINOR,
        title: 'aapt2 yok — manifest kanıtı toplanamadı',
        remediation: 'Android SDK build-tools kur veya ANDROID_HOME ayarla.',
      }));
    } else {
      const res = await context.exec(aapt2, ['dump', 'badging', apk], { timeoutMs: 60_000 });
      const ref = context.artifacts.writeRaw('aapt2-badging.txt', `${res.stdout}\n${res.stderr}`);
      artifacts.push(ref);

      if (!res.ok) {
        checks.push(check({
          id: 'apk-package', title: 'Paket adı doğru mu',
          status: PHASE_RESULT.INCOMPLETE,
          detail: `aapt2 badging başarısız (exit ${res.code}${res.timedOut ? ', zaman aşımı' : ''})`,
        }));
      } else {
        const badging = parseBadging(res.stdout);
        metrics.packageName     = badging.packageName;
        metrics.versionName     = badging.versionName;
        metrics.versionCode     = badging.versionCode;
        metrics.permissionCount = badging.permissions.length;

        // 5a) paket adı
        const pkgOk = badging.packageName === expect.expectedPackage;
        checks.push(check({
          id: 'apk-package', title: 'Paket adı doğru mu',
          status: pkgOk ? PHASE_RESULT.PASS : PHASE_RESULT.FAIL,
          detail: `beklenen ${expect.expectedPackage}, bulunan ${badging.packageName ?? '—'}`,
        }));
        if (!pkgOk) {
          findings.push(finding({
            id: 'build.package-mismatch', severity: SEVERITY.BLOCKER,
            title: 'APK paket adı beklenenden farklı',
            detail: `beklenen ${expect.expectedPackage}, bulunan ${badging.packageName ?? '—'}`,
            evidence: ref.path,
            remediation: 'android/app/build.gradle applicationId değerini kontrol et.',
          }));
        }

        // 5b) sürüm — version.properties ile hizalı mı
        const vp = readVersionProperties(repoRoot);
        const versionReadable = Boolean(badging.versionName && badging.versionCode);
        const versionAligned  = !vp || !vp.versionName || vp.versionName === badging.versionName;
        checks.push(check({
          id: 'apk-version', title: 'Sürüm bilgisi okunuyor / tek kaynakla hizalı',
          status: !versionReadable ? PHASE_RESULT.FAIL : (versionAligned ? PHASE_RESULT.PASS : PHASE_RESULT.PASS_WITH_WARNINGS),
          detail: `APK ${badging.versionName ?? '—'} (code ${badging.versionCode ?? '—'})` +
                  (vp ? ` · version.properties ${vp.versionName ?? '—'}` : ' · version.properties yok'),
        }));
        if (versionReadable && !versionAligned) {
          findings.push(finding({
            id: 'build.version-drift', severity: SEVERITY.MINOR,
            title: 'APK sürümü version.properties ile hizalı değil (bayat APK?)',
            detail: `APK ${badging.versionName} ≠ version.properties ${vp.versionName}`,
            remediation: 'Taze APK üret (`npm run apk:safe`) — stale-APK tuzağı.',
          }));
        }

        // 5c) izin yüzeyi
        const { unexpected, banned, missing, unexpectedCritical } = diffPermissions(badging.permissions, expect);

        const permStatus = (banned.length > 0 || unexpected.length > 0)
          ? PHASE_RESULT.FAIL
          : (missing.length > 0 ? PHASE_RESULT.PASS_WITH_WARNINGS : PHASE_RESULT.PASS);
        checks.push(check({
          id: 'apk-permissions', title: 'İzin yüzeyi beklendiği gibi mi',
          status: permStatus,
          detail: `${badging.permissions.length} izin · beklenmeyen ${unexpected.length} · yasaklı ${banned.length} · manifest'te olup APK'da olmayan ${missing.length}`,
          metrics: { unexpected, banned, missing },
        }));
        if (banned.length > 0 || unexpectedCritical.length > 0) {
          findings.push(finding({
            id: 'build.permission-critical', severity: SEVERITY.BLOCKER,
            title: 'APK beklenmeyen KRİTİK/yasaklı izin taşıyor',
            detail: [...banned, ...unexpectedCritical].join(', '),
            evidence: ref.path,
            remediation: 'İzni kaldır veya bilinçliyse qa/config/manifest-expectations.json sözleşmesini güncelle.',
          }));
        } else if (unexpected.length > 0) {
          findings.push(finding({
            id: 'build.permission-drift', severity: SEVERITY.MAJOR,
            title: 'APK sözleşmede olmayan izin taşıyor',
            detail: unexpected.join(', '),
            evidence: ref.path,
            remediation: 'Bilinçliyse manifest-expectations.json güncelle; değilse (kütüphane sızıntısı) izni kaldır.',
          }));
        }

        // 5d) debug-only ayar release APK'da mı
        const isRelease = variant === 'release';
        const debugLeak = isRelease && badging.debuggable && expect.release?.debuggableForbidden !== false;
        checks.push(check({
          id: 'apk-debuggable', title: 'Release APK debug-only ayar taşıyor mu',
          status: debugLeak ? PHASE_RESULT.FAIL : PHASE_RESULT.PASS,
          detail: isRelease
            ? (badging.debuggable ? 'android:debuggable=true — SIZINTI' : 'debuggable bayrağı yok')
            : 'debug variant — kontrol uygulanmaz (release\'de zorunlu)',
        }));
        if (debugLeak) {
          findings.push(finding({
            id: 'build.release-debuggable', severity: SEVERITY.BLOCKER,
            title: 'Release APK debuggable',
            detail: 'Üretim paketinde android:debuggable=true → uzaktan hata ayıklama yüzeyi açık.',
            evidence: ref.path,
            remediation: 'buildTypes.release içinde debuggable false olmalı.',
          }));
        }
      }
    }

    /* ── 6) İmza doğrulaması ──────────────────────────────────────────────
     * ÜÇ AYRI DURUM (karıştırmak yanlış alarm üretir):
     *   (a) araç yok (apksigner/Java)  → SKIPPED_NA  — "koşamadık", APK suçlu değil
     *   (b) araç koştu, çuvalladı      → INCOMPLETE  — ortam sorunu, kanıt yok
     *   (c) araç koştu, imza geçersiz  → FAIL        — GERÇEK kusur
     */
    const apksigner = context.paths?.apksigner ?? null;
    const javaHome  = context.paths?.javaHome  ?? null;

    if (!apksigner || !javaHome) {
      const eksik = !apksigner ? 'apksigner' : 'Java (JAVA_HOME)';
      checks.push(check({
        id: 'apk-signature', title: 'APK imzası doğrulanabiliyor mu',
        status: PHASE_RESULT.SKIPPED_NA,
        detail: `${eksik} bulunamadı — kontrol atlandı, GEÇTİ SAYILMAZ (APK kusurlu demek DEĞİL)`,
      }));
      findings.push(finding({
        id: 'build.apksigner-missing', severity: SEVERITY.MINOR,
        title: `İmza kanıtı toplanamadı — ${eksik} yok`,
        remediation: 'Android SDK build-tools kur; JAVA_HOME ayarla (Android Studio jbr yeterli).',
      }));
    } else {
      const res = await context.exec(apksigner, ['verify', '--print-certs', apk], {
        timeoutMs: 90_000,
        env: { ...process.env, JAVA_HOME: javaHome },
      });
      const ref = context.artifacts.writeRaw('apksigner-verify.txt', `${res.stdout}\n${res.stderr}`);
      artifacts.push(ref);

      const toolBroke = res.timedOut || res.code === null || Boolean(res.error) ||
                        /JAVA_HOME is not set/i.test(res.stderr);
      if (res.ok) {
        checks.push(check({
          id: 'apk-signature', title: 'APK imzası doğrulanabiliyor mu',
          status: PHASE_RESULT.PASS,
          detail: 'apksigner verify: imza geçerli',
        }));
      } else if (toolBroke) {
        checks.push(check({
          id: 'apk-signature', title: 'APK imzası doğrulanabiliyor mu',
          status: PHASE_RESULT.INCOMPLETE,
          detail: `apksigner çalıştırılamadı (${res.error ?? 'ortam hatası'}) — imza HAKKINDA hüküm YOK`,
        }));
        findings.push(finding({
          id: 'build.apksigner-broken', severity: SEVERITY.MINOR,
          title: 'apksigner koşamadı — imza kanıtı yok',
          detail: res.error ?? 'ortam hatası',
          evidence: ref.path,
          remediation: 'JAVA_HOME / build-tools kurulumunu kontrol et.',
        }));
      } else {
        checks.push(check({
          id: 'apk-signature', title: 'APK imzası doğrulanabiliyor mu',
          status: PHASE_RESULT.FAIL,
          detail: `apksigner verify: imza GEÇERSİZ (exit ${res.code})`,
        }));
        findings.push(finding({
          id: 'build.signature-invalid',
          severity: variant === 'release' ? SEVERITY.BLOCKER : SEVERITY.MAJOR,
          title: 'APK imzası doğrulanamadı',
          detail: `variant=${variant} · exit ${res.code}`,
          evidence: ref.path,
          remediation: 'İmza yapılandırmasını kontrol et (release için keystore zorunlu).',
        }));
      }
    }

    return finalize(checks, findings, artifacts, metrics);
  },
});

function finalize(checks, findings, artifacts, metrics) {
  const executed = checks.filter((c) => [PHASE_RESULT.PASS, PHASE_RESULT.PASS_WITH_WARNINGS, PHASE_RESULT.FAIL].includes(c.status));
  return phaseOutcome({
    result: rollupChecks(checks),
    findings,
    artifacts,
    metrics: {
      ...metrics,
      checksPlanned:  checks.length,
      checksExecuted: executed.length,
      checkCoverage:  checks.length > 0 ? Math.round((executed.length / checks.length) * 100) / 100 : 0,
      checks: checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })),
    },
  });
}

/** Beklenti sözleşmesi (yoksa boş sözleşme → kontroller INCOMPLETE olur, sessizce geçmez). */
function loadExpectations(repoRoot) {
  const file = join(repoRoot, 'qa', 'config', 'manifest-expectations.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { expectedPackage: null, allowedPermissions: [], criticalPermissions: [], forbiddenPermissions: [], release: {} };
  }
}
