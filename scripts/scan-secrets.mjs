/**
 * scan-secrets.mjs — Release bundle gizli-anahtar sızıntı kapısı (CI + apk:safe).
 *
 * NEDEN: `.env`'deki gizli AI anahtarları (Gemini/Claude/Groq/xAI) geçmişte bracket
 * (dinamik) `import.meta.env[...]` erişimi yüzünden TÜM env objesiyle derlenmiş
 * bundle'a serialize oluyordu → dağıtılan APK'da literal anahtar. Kaynak nokta-erişime
 * çevrildi (aiVoiceService/mediaCredentials) AMA bu script SON SAVUNMA: gerçek build
 * ÇIKTISINI tarar, biri `.env`'e tekrar gizli anahtar koyup bracket erişim eklerse
 * (veya bir bağımlılık sızdırırsa) release'i SESSİZCE geçirmez.
 *
 * TASARIM: yalnız GERÇEK anahtar-ŞEKİLLİ literal'leri yakalar — SettingsPage'deki
 * BYOK doğrulama REGEX kaynakları (`sk-ant-[A-Za-z0-9_-]{20,}`) ve `sk-ant-...`
 * placeholder metinleri YANLIŞ-POZİTİF olmasın diye desenler dar tutuldu (gerçek
 * anahtar önekleri + uzun bitişik alnum). Bilinen public/test değerleri allowlist'te.
 *
 * KULLANIM: `node scripts/scan-secrets.mjs`  (taze `dist/` gerektirir).
 *   0 = temiz · 1 = secret bulundu (CI/apk:safe durur) · 2 = dist yok.
 * Gerçek secret değerini ASLA loglamaz — yalnız REDACTED önek + konum.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const DIST = 'dist';

// Gerçek anahtar-şekilli literal desenleri (regex-kaynağı/placeholder DEĞİL).
// Her desen: bilinen sağlayıcı öneki + yalnız gerçek anahtar karakterleri + uzun
// bitişik uzunluk → `[A-Za-z0-9_-]{20,}` gibi regex kaynakları eşleşmez ('[' kırar).
const PATTERNS = [
  { name: 'anthropic-claude', re: /sk-ant-api03-[A-Za-z0-9_-]{40,}/g },
  { name: 'groq',             re: /\bgsk_[A-Za-z0-9]{45,}\b/g },
  { name: 'google-gemini',    re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'xai-grok',         re: /\bxai-[A-Za-z0-9]{40,}\b/g },
  { name: 'openai',           re: /\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b/g },
];

// Public/tasarımca-görünür veya test-fixture değerleri — sızıntı DEĞİL.
//  · Firebase Android API anahtarı: SHA-1 + paket-adı kısıtlı, her Firebase app'te
//    açıkça gömülü olması TASARIMDIR (google-services.json). Web dist'te yer almaz
//    ama APK taramasında karşımıza çıkabilir.
const ALLOWLIST = new Set([
  'AIzaSyBo_ZhAlSv0jVaOuI4hzeO_GZqmtx172bA', // Firebase Android (public by design)
]);
// Test-fixture öneki (asla gerçek): keyBeam testlerindeki ABCDEF... zinciri.
const FIXTURE_MARK = /ABCDEFGHIJKLMNOPQRSTUVWXYZ|ABCDEFGHIJKLMNOPQRSTUVWX/;

/** Gizli değeri gizleyerek raporlanabilir önek. */
function redact(s) {
  return `${s.slice(0, 8)}…REDACTED…(${s.length} chars)`;
}

/**
 * Bir metin gövdesinde gerçek anahtar-şekilli literal'leri bulur.
 * Allowlist (public/Firebase) ve test-fixture eşleşmeleri elenir.
 * @returns {{provider:string, redacted:string}[]}  (boş = temiz)
 */
export function findSecrets(text) {
  const out = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const hit = m[0];
      if (ALLOWLIST.has(hit)) continue;
      if (FIXTURE_MARK.test(hit)) continue;
      out.push({ provider: name, redacted: redact(hit) });
    }
  }
  return out;
}

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    // Yalnız gemiye giden metin varlıkları: JS/HTML/CSS. Source-map (.map) APK'ya
    // girmez → taranmaz (aksi halde .env referansları yanlış-pozitif üretebilir).
    else if (/\.(js|html|css)$/.test(entry)) acc.push(p);
  }
  return acc;
}

/** CLI: dist/ tarar, sızıntı varsa 1, temizse 0, dist yoksa 2 ile çıkar. */
function runCli() {
  if (!existsSync(DIST)) {
    console.error('❌ dist/ yok — önce `npm run build` çalıştır.');
    process.exit(2);
  }

  const files = walk(DIST, []);
  const findings = [];
  for (const file of files) {
    for (const hit of findSecrets(readFileSync(file, 'utf8'))) {
      findings.push({ ...hit, file });
    }
  }

  if (findings.length > 0) {
    console.error('❌ RELEASE BUNDLE SECRET LEAK — build BLOCKED:');
    for (const f of findings) {
      console.error(`   [${f.provider}] ${f.file} → ${f.redacted}`);
    }
    console.error('\nGizli AI anahtarı bundle\'a gömülmüş. `.env`\'den kaldır ve env');
    console.error('erişiminin NOKTA (bracket değil) olduğunu doğrula. BYOK zorunlu.');
    process.exit(1);
  }

  console.log(`✓ Secret scan temiz — ${files.length} dist varlığı tarandı, sızıntı yok.`);
  process.exit(0);
}

// Yalnız doğrudan `node scripts/scan-secrets.mjs` çağrısında CLI çalışır;
// test/`import` sırasında findSecrets saf fonksiyon olarak kullanılabilir.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli();
}
