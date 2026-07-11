/**
 * context.mjs — Fazlara verilen DEĞİŞMEZ (immutable) koşu bağlamı.
 *
 * Bir faz context'i mutasyona uğratamaz (Object.freeze) — fazlar arası gizli
 * kanal yok, koşu tekrarlanabilir. Faz yalnız `run(context)` alır ve sonuç DÖNER.
 *
 * Bağlam içeriği:
 *  - repoRoot, runId, startedAt, profile, thresholds
 *  - capabilities: TESPİT EDİLMİŞ yetenekler (host.* — PR-1'de device.* ASLA yok)
 *  - exec(): sınırlı, shell'siz komut çalıştırıcı (lane yasaklarına tabi)
 *  - artifacts: bounded + redakte artefakt deposu
 *  - log(): ilerleme satırı
 *
 * LANE GÜVENLİĞİ (PR-1 sözleşmesi): `lane: 'host'` profilinde `adb` çalıştırmak
 * YAPISAL olarak yasaktır — exec() reddeder. Cihaz katmanı ayrı bir PR'da,
 * `lane: 'device'` profili + transport modülüyle gelir.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runCommand, DEFAULT_TIMEOUT_MS } from './exec.mjs';
import { createArtifactStore } from './artifact-store.mjs';
import { CAPABILITY, capabilityDomain } from './result-types.mjs';
import { redactPath } from './redact.mjs';

/** Host lane'de ASLA çalıştırılamayacak komutlar (cihaz katmanı sonraki PR). */
const HOST_LANE_DENY = Object.freeze(['adb', 'fastboot', 'scrcpy']);

/**
 * Değişmez koşu bağlamı üretir. Tüm bağımlılıklar ENJEKTE edilir → testte
 * gerçek dosya sistemi/süreç gerekmez.
 */
export function createContext({
  repoRoot,
  runId,
  startedAt,
  profile,
  thresholds,
  capabilities = [],
  paths = {},
  artifacts = null,
  logger = null,
  exec = runCommand,
}) {
  if (!repoRoot || typeof repoRoot !== 'string') throw new TypeError('context.repoRoot zorunlu');
  if (!profile || typeof profile !== 'object')   throw new TypeError('context.profile zorunlu');
  if (!thresholds || typeof thresholds !== 'object') throw new TypeError('context.thresholds zorunlu');

  const caps  = Object.freeze([...new Set(capabilities)]);
  const capSet = new Set(caps);
  const lane  = profile.lane ?? 'host';
  const store = artifacts ?? createArtifactStore({ baseDir: null, repoRoot });
  const logLines = [];

  const context = {
    repoRoot,
    runId,
    startedAt,
    profile:    Object.freeze({ ...profile }),
    thresholds: Object.freeze(thresholds),
    lane,
    capabilities: caps,
    // Tespit edilmiş host araç/artefakt yolları (apk, aapt2, apksigner, gradlew, dist).
    // Fazlar bunları context'ten alır → testte ENJEKTE edilebilir, gerçek SDK gerekmez.
    paths: Object.freeze({ apk: null, gradlew: null, aapt2: null, apksigner: null, dist: null, javaHome: null, ...paths }),
    artifacts: store,

    /** Yetenek var mı? */
    has(capability) { return capSet.has(capability); },

    /** Faz gereksinimlerinden EKSİK olanlar (boş dizi = hepsi var). */
    missing(required = []) { return required.filter((c) => !capSet.has(c)); },

    /** repoRoot altındaki mutlak yol. */
    path(...parts) { return join(repoRoot, ...parts); },

    /** Rapora yazılabilir (redakte) yol. */
    safePath(p) { return redactPath(p, repoRoot); },

    /**
     * Sınırlı komut çalıştırıcı. Lane yasağı ihlal edilirse THROW eder —
     * orchestrator bunu yakalar, faz INCOMPLETE olur, Lab çökmez.
     */
    async exec(command, args = [], opts = {}) {
      // Ayraçları ÖNCE normalleştir: POSIX'te basename('C:\\sdk\\adb.exe') tüm
      // dizeyi döndürür (ters bölü ayraç değildir) → Windows tarzı bir adb yolu
      // Linux CI'da kapıdan SIZAR. (Bu hatayı CI yakaladı.)
      const normalized = String(command).replace(/\\/g, '/');
      const bin = basename(normalized).replace(/\.(exe|bat|cmd)$/i, '').toLowerCase();
      if (lane === 'host' && HOST_LANE_DENY.includes(bin)) {
        throw new Error(`Host lane'de '${bin}' çalıştırılamaz — cihaz katmanı bu PR'ın kapsamı dışında.`);
      }
      return exec(command, args, {
        cwd:       opts.cwd ?? repoRoot,
        timeoutMs: opts.timeoutMs ?? thresholds?.exec?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        env:       opts.env,   // ör. apksigner için JAVA_HOME
      });
    },

    log(message) {
      const line = redactPath(String(message), repoRoot);
      logLines.push(line);
      if (logger) logger(line);
    },

    logs() { return Object.freeze([...logLines]); },
  };

  return Object.freeze(context);
}

/* ────────────────────────────────────────────────────────────────────────────
 * HOST YETENEK TESPİTİ — yalnız `host.*`. Bu fonksiyon device.* DÖNDÜREMEZ.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Android SDK build-tools'ta bir aracın (aapt2/apksigner) yolunu bulur; yoksa null. */
export function findBuildTool(toolName, env = process.env) {
  const roots = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    env.HOME ? join(env.HOME, 'Android', 'Sdk') : null,
    env.HOME ? join(env.HOME, 'Library', 'Android', 'sdk') : null,
  ].filter(Boolean);

  for (const root of roots) {
    const bt = join(root, 'build-tools');
    if (!existsSync(bt)) continue;
    let versions;
    try {
      // Sürüm klasörlerini büyükten küçüğe: en yeni build-tools tercih edilir.
      versions = readdirSync(bt).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch { continue; }
    for (const v of versions) {
      for (const ext of ['.exe', '.bat', '']) {
        const candidate = join(bt, v, `${toolName}${ext}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Java kurulumu (JAVA_HOME kökü). apksigner bir Java aracıdır — Java yoksa
 * "imza geçersiz" DEĞİL, "imza kontrolü koşulamadı" denir (yanlış alarm yasak).
 * Bu makinede Java genelde Android Studio'nun gömülü JBR'ı ile gelir.
 */
export function findJavaHome(env = process.env) {
  const candidates = [
    env.JAVA_HOME,
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Android Studio', 'jbr') : null,
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/usr/lib/jvm/default-java',
  ].filter(Boolean);

  for (const home of candidates) {
    for (const exe of ['java.exe', 'java']) {
      if (existsSync(join(home, 'bin', exe))) return home;
    }
  }

  // PATH üzerinde java (spawn etmeden, yalnız dosya sistemi kontrolü).
  const pathDirs = String(env.PATH ?? env.Path ?? '').split(process.platform === 'win32' ? ';' : ':');
  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const exe of ['java.exe', 'java']) {
      if (existsSync(join(dir, exe))) return join(dir, '..');   // .../bin/java → JAVA_HOME
    }
  }
  return null;
}

/** Gradle wrapper yolu (Windows'ta .bat). */
export function findGradlew(repoRoot) {
  const win = join(repoRoot, 'android', 'gradlew.bat');
  const nix = join(repoRoot, 'android', 'gradlew');
  if (process.platform === 'win32' && existsSync(win)) return win;
  if (existsSync(nix)) return nix;
  return existsSync(win) ? win : null;
}

/**
 * `android/build.gradle` içindeki buildDir override'ını okur (bu repoda build
 * çıktısı repo dışına — ör. C:/Temp/... — yönlendirilmiştir). Bulunamazsa null.
 */
export function readGradleBuildDir(repoRoot) {
  const gradleFile = join(repoRoot, 'android', 'build.gradle');
  if (!existsSync(gradleFile)) return null;
  try {
    const text = readFileSync(gradleFile, 'utf8');
    const m = text.match(/buildDir\s*=\s*new\s+File\(\s*["']([^"']+)["']/);
    if (!m) return null;
    // "C:/Temp/carlauncher/${project.name}/build" → app modülü için project.name = "app"
    return m[1].replace(/\$\{project\.name\}/g, 'app');
  } catch {
    return null;
  }
}

/** APK aday yolları (öncelik sırasıyla). Sadece VAR OLAN dosyalar döner. */
export function findApkCandidates(repoRoot, variant = 'debug') {
  const candidates = [];
  const gradleBuildDir = readGradleBuildDir(repoRoot);
  if (gradleBuildDir) {
    candidates.push(join(gradleBuildDir, 'outputs', 'apk', variant, `app-${variant}.apk`));
  }
  candidates.push(join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`));
  return candidates.filter((p) => existsSync(p));
}

/**
 * Host yeteneklerini tespit eder. Dosya sistemi + SDK yoklaması; komut ÇALIŞTIRMAZ.
 * @returns {{capabilities:string[], paths:{apk:string|null, gradlew:string|null, aapt2:string|null, apksigner:string|null, dist:string|null}}}
 */
export function detectHostCapabilities(repoRoot, { variant = 'debug', env = process.env } = {}) {
  const capabilities = [CAPABILITY.HOST_NODE];
  const paths = { apk: null, gradlew: null, aapt2: null, apksigner: null, dist: null, javaHome: null };

  if (existsSync(join(repoRoot, 'package.json'))) capabilities.push(CAPABILITY.HOST_REPO);

  const distIndex = join(repoRoot, 'dist', 'index.html');
  if (existsSync(distIndex)) {
    capabilities.push(CAPABILITY.HOST_DIST);
    paths.dist = join(repoRoot, 'dist');
  }

  const apks = findApkCandidates(repoRoot, variant);
  if (apks.length > 0) {
    capabilities.push(CAPABILITY.HOST_APK);
    paths.apk = apks[0];
  }

  const gradlew = findGradlew(repoRoot);
  if (gradlew) { capabilities.push(CAPABILITY.HOST_GRADLE); paths.gradlew = gradlew; }

  const aapt2 = findBuildTool('aapt2', env);
  if (aapt2) { capabilities.push(CAPABILITY.HOST_AAPT); paths.aapt2 = aapt2; }

  const apksigner = findBuildTool('apksigner', env);
  if (apksigner) { capabilities.push(CAPABILITY.HOST_APKSIGNER); paths.apksigner = apksigner; }

  const javaHome = findJavaHome(env);
  if (javaHome) { capabilities.push(CAPABILITY.HOST_JAVA); paths.javaHome = javaHome; }

  // ZORUNLU İNVARYANT: host tespiti device/vehicle yeteneği ÜRETEMEZ.
  const leaked = capabilities.filter((c) => capabilityDomain(c) !== 'host');
  if (leaked.length > 0) throw new Error(`detectHostCapabilities host-dışı yetenek sızdırdı: ${leaked.join(', ')}`);

  return { capabilities, paths };
}
