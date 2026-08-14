#!/usr/bin/env node
/**
 * EGM EDS (denetim noktası) veri paketi üreticisi.
 *
 * KAYNAK: Emniyet Genel Müdürlüğü'nün kamuya açık EDS haritası. Noktalar
 * sayfanın kendi HTML'ine gömülü `var markers = [...]` dizisinde yayınlanır.
 *
 * NEDEN BURADA (cihazda değil):
 *  - Ürün çevrimdışı çalışmak zorunda → veri cihaza PAKET olarak gömülür.
 *  - Her cihazın ayrı ayrı EGM'ye istek atması hem gereksiz yük hem kırılganlık.
 *  - Paket üretimi tek noktadan, sürüm damgalı ve denetlenebilir olur.
 *
 * DÜRÜSTLÜK SÖZLEŞMESİ (CLAUDE.md — sahte veri yasağı):
 *  - Kaynakta hız limiti YOK → `speedLimitKph` HER ZAMAN null. Sahte 0 yazılmaz.
 *  - Kaynakta tip alanı YOK → `type` yalnız metinden ÇIKARILIR (DERIVED) ve
 *    çıkarılamıyorsa `UNKNOWN` kalır. Tahmin "gözlem" gibi sunulmaz.
 *  - Yön serbest metindedir → ham metin `directionHint` olarak taşınır,
 *    dereceye ÇEVRİLMEZ (çevirmek uydurmak olurdu).
 *
 * Kullanım:  node scripts/fetch-enforcement-points.mjs [--out <yol>]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SOURCE_URL =
  'https://onlineislemler.egm.gov.tr/trafik/Sayfalar/EDSHarita.aspx';
const SOURCE_ID = 'EGM_EDS_MAP';
const SCHEMA_VERSION = 1;

const DEFAULT_OUT = 'public/data/enforcement-points.tr.json';

/** Türkçe'ye duyarlı küçültme — `İ`/`I` JS `toLowerCase()` ile bozulur. */
function trLower(value) {
  return value.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
}

/**
 * Tip çıkarımı. Kaynakta tip alanı yoktur; bu bir METİN TAHMİNİDİR.
 * Emin olunamayan her kayıt `UNKNOWN` kalır — yanlış sınıflandırma,
 * sınıflandırmamaktan daha zararlıdır (sürücüye yanlış uyarı metni).
 */
function inferType(text) {
  const t = trLower(text);
  if (t.includes('park ihlal')) return 'PARKING';
  if (t.includes('ohts')) return 'AVERAGE_SPEED';
  if (t.includes('kırmızı') || t.includes('ışık')) return 'RED_LIGHT';
  return 'UNKNOWN';
}

/** Ortalama hız koridorlarında uç rolü (başlangıç/bitiş). */
function inferRole(text) {
  const t = trLower(text);
  if (/(başlangıc|başlangıç|başlama|giriş)/.test(t)) return 'START';
  if (/(bitiş|sonu|çıkış)/.test(t)) return 'END';
  return null;
}

/** Yön ipucu — HAM METİN. Dereceye çevrilmez, çünkü kaynakta açı yok. */
function extractDirectionHint(text) {
  const m = text.match(/([^./]{0,60}istikamet[^./]{0,20})/i);
  if (!m) return null;
  const hint = m[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return hint.length >= 4 ? hint : null;
}

function cleanLabel(raw) {
  return raw
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMarkers(html) {
  const re =
    /"Aciklama":\s*'([^']*)',\s*"lat":\s*'([^']*)',\s*"lng":\s*'([^']*)'/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const label = cleanLabel(m[1]);
    const lat = Number(m[2]);
    const lng = Number(m[3]);
    // Aralık dışı / bozuk koordinat REDDEDİLİR (sessizce 0'a düşürülmez).
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 35.5 || lat > 42.5 || lng < 25.5 || lng > 45.0) continue;
    out.push({
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      type: inferType(label),
      role: inferRole(label),
      speedLimitKph: null, // kaynakta YOK — sahte değer yazılmaz
      directionHint: extractDirectionHint(label),
      label,
    });
  }
  return out;
}

async function main() {
  const outArgIndex = process.argv.indexOf('--out');
  const outPath = resolve(
    outArgIndex >= 0 ? process.argv[outArgIndex + 1] : DEFAULT_OUT,
  );

  process.stdout.write(`EGM EDS verisi çekiliyor: ${SOURCE_URL}\n`);
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'CarOSPro-DataBuilder/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Kaynak yanıtı başarısız: HTTP ${res.status}`);
  }
  const html = await res.text();

  const points = parseMarkers(html);
  if (points.length === 0) {
    // Sayfa yapısı değişmiş olabilir → BOŞ PAKET ÜRETME.
    throw new Error(
      'Hiç nokta ayrıştırılamadı — kaynak sayfa yapısı değişmiş olabilir. ' +
        'Paket ÜRETİLMEDİ (boş paket, sessiz "denetim yok" anlamına gelirdi).',
    );
  }

  const typeCounts = points.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1;
    return acc;
  }, {});

  const pkg = {
    schemaVersion: SCHEMA_VERSION,
    sourceId: SOURCE_ID,
    sourceUrl: SOURCE_URL,
    sourceNote:
      'Emniyet Genel Müdürlüğü kamuya açık EDS haritası. Tip ve yön bilgisi ' +
      'kaynakta yapılandırılmış alan olarak YOKTUR; bu paketteki type/role/' +
      'directionHint alanları serbest metinden ÇIKARIMDIR (DERIVED). ' +
      'Hız limiti kaynakta hiç yoktur (speedLimitKph her kayıtta null).',
    fetchedAt: new Date().toISOString(),
    count: points.length,
    typeCounts,
    points,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(pkg)}\n`, 'utf8');

  process.stdout.write(`Paket yazıldı: ${outPath}\n`);
  process.stdout.write(`  nokta: ${points.length}\n`);
  for (const [type, n] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${type}: ${n}\n`);
  }
  const withDir = points.filter((p) => p.directionHint !== null).length;
  process.stdout.write(
    `  yön ipucu taşıyan: ${withDir} (%${((100 * withDir) / points.length).toFixed(0)})\n`,
  );
  process.stdout.write('  hız limiti taşıyan: 0 (kaynakta yok)\n');
}

main().catch((err) => {
  process.stderr.write(`HATA: ${err.message}\n`);
  process.exitCode = 1;
});
