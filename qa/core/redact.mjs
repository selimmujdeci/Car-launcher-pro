/**
 * redact.mjs — Rapora yazılan HER metin buradan geçer (gizli veri + kişisel yol sızıntısı yok).
 *
 * NEDEN: Lab, ham komut çıktısı (gradle, aapt2, apksigner, ileride adb) topluyor.
 * Bu çıktılar keystore parolası, imza yolu, kullanıcı adı içeren mutlak yollar
 * (C:\Users\<isim>\...), cihaz seri numarası, MAC ve token taşıyabilir. report.json
 * ve markdown raporlar paylaşılabilir artefaktlardır → redaksiyon SON KAPIDIR.
 *
 * Yaklaşım: allowlist değil denylist + yol normalizasyonu. Bu yüzden "kesin" değil,
 * "makul savunma"dır; ham cihaz çıktıları AYRICA git'e girmez (docs-local/qa-runs
 * .gitignore'da).
 *
 * Yan etkisiz.
 */

/** Gizli veri desenleri. Sıra önemli: uzun/spesifik olan önce. */
const SECRET_PATTERNS = Object.freeze([
  // key=value / key: value biçiminde sır taşıyan anahtar adları
  [/((?:api[_-]?key|apikey|secret|token|password|passwd|pwd|storepass|keypass|authorization|bearer)\s*[:=]\s*)(["']?)([^\s"',;]{4,})\2/gi,
    (_m, k, q) => `${k}${q}<REDACTED>${q}`],
  // Supabase / JWT benzeri uzun tokenlar
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<REDACTED_JWT>'],
  // Google/Gemini tarzı anahtarlar
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '<REDACTED_KEY>'],
  // sk-/gsk_ tarzı sağlayıcı anahtarları
  [/\b(?:sk|gsk|xoxb|ghp)[-_][A-Za-z0-9_-]{16,}\b/g, '<REDACTED_KEY>'],
  // MAC adresi
  [/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g, '<REDACTED_MAC>'],
  // VIN (17 hane, I/O/Q yok) — araç kimliği kişisel veridir
  [/\b[A-HJ-NPR-Z0-9]{17}\b/g, '<REDACTED_VIN>'],
  // Koordinat çifti (lat,lon)
  [/\b-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/g, '<REDACTED_COORD>'],
]);

/** Windows/POSIX kullanıcı dizinleri — kişisel yol. */
const HOME_PATTERNS = Object.freeze([
  /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi,
  /[A-Za-z]:[\\/]Documents and Settings[\\/][^\\/\s"']+/gi,
  /\/home\/[^/\s"']+/g,
  /\/Users\/[^/\s"']+/g,
]);

/**
 * Mutlak yolu repo-göreli veya redakte edilmiş biçime çevirir.
 * - repoRoot altındaysa → "repo:/src/foo.ts"
 * - kullanıcı dizini altındaysa → "<HOME>/..."
 * - aksi halde → sadece son iki segment ("…/build-tools/aapt2.exe")
 */
export function redactPath(value, repoRoot) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const norm = value.replace(/\\/g, '/');
  if (repoRoot) {
    const root = String(repoRoot).replace(/\\/g, '/').replace(/\/+$/, '');
    if (root && norm.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      return `repo:/${norm.slice(root.length + 1)}`;
    }
    if (root && norm.toLowerCase() === root.toLowerCase()) return 'repo:/';
  }
  for (const re of HOME_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(norm)) {
      re.lastIndex = 0;
      return norm.replace(re, '<HOME>');
    }
  }
  // Repo da ev dizini de değil ama MUTLAK (ör. C:/Temp/carlauncher/... build dizini
  // override'ı, /opt/sdk/...): makineye özgü yol rapora tam hâliyle GİRMEZ — yalnız
  // son iki segment bırakılır (dosya kimliği korunur, makine topolojisi sızmaz).
  if (/^[A-Za-z]:\//.test(norm) || norm.startsWith('/')) {
    const parts = norm.split('/').filter(Boolean);
    if (parts.length > 2) return `<ABS>/${parts.slice(-2).join('/')}`;
  }
  return norm;
}

/**
 * Serbest metinde (ham komut çıktısı) gizli veri + kişisel yol redaksiyonu.
 * `repoRoot` verilirse repo yolları repo-göreli hale getirilir.
 */
export function redactText(value, repoRoot) {
  if (typeof value !== 'string' || value.length === 0) return value;
  let out = value;

  if (repoRoot) {
    const root = String(repoRoot).replace(/\\/g, '/').replace(/\/+$/, '');
    if (root) {
      // Hem "/" hem "\" ayraçlı yazımı yakala.
      const esc = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rootRe = new RegExp(esc.replace(/\//g, '[\\\\/]'), 'gi');
      out = out.replace(rootRe, 'repo:');
    }
  }
  for (const re of HOME_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, '<HOME>');
  }
  // Repo/ev dışındaki sürücü-mutlak yollar (ör. C:/Temp/... gradle buildDir override):
  // makine topolojisi rapora girmesin — son iki segment yeter.
  out = out.replace(/\b[A-Za-z]:[\\/][^\s"',;)]{4,}/g, (match) => {
    const norm = match.replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    return parts.length > 2 ? `<ABS>/${parts.slice(-2).join('/')}` : norm;
  });

  for (const [re, replacement] of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * Cihaz seri numarası → kısmi maske. Tam seri no bir cihaz kimliğidir (kişisel veri
 * sayılır) ve rapora GİRMEZ; ama koşuları eşleştirebilmek için ayırt edici bir ön ek
 * bırakılır. Ağ seri numarasında (10.0.0.5:5555) IP GİZLENİR, port kalır.
 */
export function redactSerial(serial) {
  const s = String(serial ?? '').trim();
  if (!s) return null;
  const net = s.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
  if (net) return `<REDACTED_IP>:${net[2]}`;
  if (s.length <= 4) return '****';
  return `${s.slice(0, 4)}****`;
}

/**
 * Nesne ağacını derinlemesine redakte eder (report.json son kapısı).
 * Sadece string yaprakları dokunur; sayı/boolean/null olduğu gibi kalır.
 * Döngüsel referans güvenli, derinlik sınırlı (bounded — sonsuz özyineleme yok).
 */
export function redactDeep(value, repoRoot, depth = 0, seen = new WeakSet()) {
  if (depth > 12) return '<REDACTED_DEPTH>';
  if (typeof value === 'string') return redactText(value, repoRoot);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '<CIRCULAR>';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, repoRoot, depth + 1, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, repoRoot, depth + 1, seen);
  return out;
}
