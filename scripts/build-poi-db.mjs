/**
 * build-poi-db.mjs — OSM `.osm.pbf` → `public/maps/poi.db` (SQLite).
 *
 * ── NEDEN VAR (V-06) ───────────────────────────────────────────────────────
 * Worker'ın POI arama katmanı yazılıydı ama veri HİÇ VAR OLMAMIŞTI. Ölçüm
 * planın saydığından FAZLA kopuk buldu — ÜÇ tanesi:
 *   (a) `public/maps/poi.db`  → yok            (plan bunu sayıyordu)
 *   (b) `public/wasm/`        → dizin HİÇ YOK  (worker sql.js WASM'ini oradan ister)
 *   (c) sql.js yapısında **FTS5 YOK**          (dört varyantın dördünde de)
 * (b) `scripts/copy-sqljs-wasm.mjs` ile kapandı. (c) yüzünden şema FTS5 DEĞİL.
 *
 * ── NEDEN FTS5 DEĞİL (bilinçli mimari karar) ───────────────────────────────
 * Worker `poi_fts` sanal tablosunu + `bm25()` sıralamasını varsayıyordu; ama
 * sevk edilen WASM `fts5` modülünü İÇERMİYOR → `no such module: fts5`. Yani o
 * tasarım bu çalışma zamanında ÇALIŞAMAZDI. Üç seçenek vardı:
 *   1. `sql.js-fts5` (MIT) — API aynı, ama 1.4.0'da donmuş bir çatal (eski SQLite)
 *   2. `@sqlite.org/sqlite-wasm` (Apache-2.0) — resmî ve güncel, ama farklı API
 *      → worker'ın POI katmanı baştan yazılırdı
 *   3. FTS5'siz düz tablo — ZATEN sevk edilen, güncel, MIT sql.js ile çalışır
 * **3 seçildi:** yeni bağımlılık YOK (tedarik zinciri büyümüyor), çalışan ve
 * bakımlı bir sürüm kullanılıyor.
 *
 * ── EK KAZANÇ: SIRALAMA ARTIK MESAFEYE GÖRE ────────────────────────────────
 * Eski sorgu `ORDER BY bm25(poi_fts)` idi — yani METİN BENZERLİĞİNE göre.
 * "En yakın benzinlik" araması için bu YANLIŞTIR: en alakalı ad, en yakın nokta
 * demek değildir. Düz tabloya geçince sıralama gerçek mesafeye bağlandı.
 *
 * ── ŞEMA ───────────────────────────────────────────────────────────────────
 *   poi(id TEXT PK, name TEXT, search TEXT, address TEXT, lat REAL, lon REAL, category TEXT)
 * `lat`/`lon` **REAL** yazılır. SQLite'ta metin her sayıdan BÜYÜKTÜR; bu alanlar
 * metin olsaydı worker'ın `lat BETWEEN ? AND ?` filtresi sessizce HİÇBİR ŞEY
 * döndürmezdi (sessiz sıfır sonuç — en kötü hata türü).
 * `search` sütunu Türkçe katlanmış anahtardır (`scripts/lib/turkishFold.mjs`).
 *
 * ── KAPSAM ─────────────────────────────────────────────────────────────────
 * Sürüş için anlamlı kategoriler ve YALNIZ NODE olarak haritalanmış POI'ler.
 * Alan (way/relation) olarak çizilmiş POI'ler bu turda DIŞARIDADIR — kapsam
 * ürün metninde böyle sunulmalıdır ("her yer bulunur" DENMEZ).
 *
 * ── LİSANS ─────────────────────────────────────────────────────────────────
 * Kaynak OpenStreetMap → **ODbL**; atıf zorunludur (bkz. routing-graph ile aynı).
 *
 * Kullanım:
 *   node --max-old-space-size=6144 scripts/build-poi-db.mjs --in <turkey.osm.pbf>
 *        [--out public/maps/poi.db] [--max-per-cat 0]
 */

import { createReadStream, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import Pbf from 'pbf';
import { foldTr } from './lib/turkishFold.mjs';

const require = createRequire(import.meta.url);

/* ── Kategori haritası: OSM etiketi → ürün kategorisi ─────────────────────── */

const CATEGORY_RULES = [
  { key: 'amenity', val: 'fuel',            cat: 'benzinlik' },
  { key: 'amenity', val: 'charging_station',cat: 'sarj' },
  { key: 'amenity', val: 'pharmacy',        cat: 'eczane' },
  { key: 'amenity', val: 'hospital',        cat: 'hastane' },
  { key: 'amenity', val: 'clinic',          cat: 'saglik' },
  { key: 'amenity', val: 'police',          cat: 'polis' },
  { key: 'amenity', val: 'fire_station',    cat: 'itfaiye' },
  { key: 'amenity', val: 'bank',            cat: 'banka' },
  { key: 'amenity', val: 'atm',             cat: 'atm' },
  { key: 'amenity', val: 'restaurant',      cat: 'restoran' },
  { key: 'amenity', val: 'cafe',            cat: 'kafe' },
  { key: 'amenity', val: 'parking',         cat: 'otopark' },
  { key: 'amenity', val: 'car_wash',        cat: 'oto-yikama' },
  { key: 'amenity', val: 'toilets',         cat: 'tuvalet' },
  { key: 'shop',    val: 'supermarket',     cat: 'market' },
  { key: 'shop',    val: 'car_repair',      cat: 'oto-servis' },
  { key: 'shop',    val: 'tyres',           cat: 'lastik' },
  { key: 'tourism', val: 'hotel',           cat: 'otel' },
  { key: 'highway', val: 'rest_area',       cat: 'dinlenme' },
  { key: 'highway', val: 'services',        cat: 'dinlenme' },
];

const RULE_INDEX = new Map();
for (const r of CATEGORY_RULES) RULE_INDEX.set(`${r.key}=${r.val}`, r.cat);

/* ── Argümanlar ──────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { in: null, out: 'public/maps/poi.db', maxPerCat: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') out.in = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--max-per-cat') out.maxPerCat = Number(argv[++i]) || 0;
  }
  if (!out.in) { console.error('HATA: --in <dosya.osm.pbf> zorunlu.'); process.exit(2); }
  return out;
}

/* ── PBF okuyucu (routing üreticisiyle aynı çerçeveleme) ──────────────────── */

async function forEachBlock(path, onBlock) {
  const stream = createReadStream(path, { highWaterMark: 1 << 22 });
  let buf = Buffer.alloc(0);
  let pending = null;

  const readBlobHeader = (b) => {
    const p = new Pbf(b); const h = { type: '', datasize: 0 };
    p.readFields((tag, o, pb) => {
      if (tag === 1) o.type = pb.readString();
      else if (tag === 3) o.datasize = pb.readVarint();
    }, h);
    return h;
  };
  const readBlob = (b) => {
    const p = new Pbf(b); const o = { raw: null, zlib: null };
    p.readFields((tag, x, pb) => {
      if (tag === 1) x.raw = Buffer.from(pb.readBytes());
      else if (tag === 3) x.zlib = Buffer.from(pb.readBytes());
    }, o);
    return o.raw || (o.zlib ? inflateSync(o.zlib) : null);
  };

  for await (const chunk of stream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (!pending) {
        if (buf.length < 4) break;
        const hl = buf.readInt32BE(0);
        if (buf.length < 4 + hl) break;
        pending = readBlobHeader(buf.subarray(4, 4 + hl));
        buf = buf.subarray(4 + hl);
        continue;
      }
      if (buf.length < pending.datasize) break;
      const blob = buf.subarray(0, pending.datasize);
      buf = buf.subarray(pending.datasize);
      const t = pending.type; pending = null;
      if (t === 'OSMData') {
        const inflated = readBlob(blob);
        if (inflated) await onBlock(inflated);
      }
    }
  }
}

function readPrimitiveBlock(buf) {
  const p = new Pbf(buf);
  const blk = { st: [], groups: [], granularity: 100, latOff: 0, lonOff: 0 };
  p.readFields((tag, o, pb) => {
    if (tag === 1) {
      const end = pb.readVarint() + pb.pos;
      pb.readFields((t2, oo, p2) => { if (t2 === 1) oo.st.push(p2.readBytes()); }, o, end);
    } else if (tag === 2) {
      const len = pb.readVarint();
      const start = pb.pos;
      o.groups.push({ start, end: start + len });
      pb.pos = start + len;
    } else if (tag === 17) o.granularity = pb.readVarint();
    else if (tag === 19) o.latOff = pb.readVarint();
    else if (tag === 20) o.lonOff = pb.readVarint();
  }, blk);
  blk.buf = buf;
  return blk;
}

const dec = new TextDecoder();
const stStr = (blk, i) => (i >= 0 && i < blk.st.length ? dec.decode(blk.st[i]) : '');

/**
 * DENSE node'ları ETİKETLERİYLE gezer.
 *
 * `keys_vals` DÜZ bir akıştır: her düğüm için `k1 v1 k2 v2 ... 0`. Sıfır
 * ayırıcıdır ve düğüm sınırını belirler — indeksi düğüm sırasıyla birlikte
 * ilerletmek ZORUNLUDUR, yoksa etiketler yanlış düğüme yapışır.
 */
function forEachDenseNodeWithTags(blk, g, cb) {
  const p = new Pbf(blk.buf);
  p.pos = g.start;
  p.readFields((tag, _o, pb) => {
    if (tag !== 2) return;
    const end = pb.readVarint() + pb.pos;
    const d = { id: [], lat: [], lon: [], kv: [] };
    pb.readFields((t2, o2, p2) => {
      if (t2 === 1) o2.id = p2.readPackedSVarint();
      else if (t2 === 8) o2.lat = p2.readPackedSVarint();
      else if (t2 === 9) o2.lon = p2.readPackedSVarint();
      else if (t2 === 10) o2.kv = p2.readPackedVarint();
    }, d, end);

    let id = 0, lat = 0, lon = 0, kvi = 0;
    const gr = blk.granularity, la0 = blk.latOff, lo0 = blk.lonOff;
    for (let i = 0; i < d.id.length; i++) {
      id += d.id[i]; lat += d.lat[i]; lon += d.lon[i];

      let tags = null;
      if (d.kv.length) {
        while (kvi < d.kv.length && d.kv[kvi] !== 0) {
          const k = stStr(blk, d.kv[kvi++]);
          const v = stStr(blk, d.kv[kvi++]);
          (tags ??= new Map()).set(k, v);
        }
        kvi++; // 0 ayırıcıyı atla
      }
      if (tags) cb(id, (la0 + gr * lat) / 1e9, (lo0 + gr * lon) / 1e9, tags);
    }
  }, null, g.end);
}

/* ── Adres kurulumu (yalnız kısa, gösterilebilir bilgi) ───────────────────── */

function addressOf(tags) {
  const street = tags.get('addr:street');
  const num = tags.get('addr:housenumber');
  const city = tags.get('addr:city') || tags.get('addr:district') || tags.get('addr:province');
  const parts = [];
  if (street) parts.push(num ? `${street} ${num}` : street);
  if (city) parts.push(city);
  return parts.join(', ');
}

/* ── Ana akış ────────────────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv);
  const inPath = resolve(args.in);
  const outPath = resolve(args.out);

  console.log(`[1/4] Kaynak: ${inPath} (${(statSync(inPath).size / 1048576).toFixed(0)} MB)`);
  console.log(`      Kategori kuralı: ${CATEGORY_RULES.length} · yalnız NODE POI'leri`);

  const rows = [];
  const perCat = new Map();
  let scanned = 0, unnamed = 0;

  await forEachBlock(inPath, (buf) => {
    const blk = readPrimitiveBlock(buf);
    for (const g of blk.groups) {
      forEachDenseNodeWithTags(blk, g, (id, lat, lon, tags) => {
        scanned++;
        let cat = null;
        for (const [k, v] of tags) {
          const hit = RULE_INDEX.get(`${k}=${v}`);
          if (hit) { cat = hit; break; }
        }
        if (!cat) return;

        const name = (tags.get('name') || '').trim();
        /* ADSIZ POI ARANAMAZ. Kategoriye göre bulunabilmesi için adı kategori
           etiketiyle DOLDURMAK yanıltıcı olurdu (uydurma isim) — bu yüzden
           adsız kayıtlar ALINMAZ ve sayısı RAPORLANIR. */
        if (!name) { unnamed++; return; }

        if (args.maxPerCat > 0 && (perCat.get(cat) ?? 0) >= args.maxPerCat) return;
        perCat.set(cat, (perCat.get(cat) ?? 0) + 1);

        const address = addressOf(tags);
        rows.push({
          id: `n${id}`,
          name,
          /* Arama anahtarı: ad + kategori + adres → "eczane" yazınca adı
             "Şifa Eczanesi" olmayanlar da kategoriden bulunur. */
          search: foldTr(`${name} ${cat} ${address}`),
          address,
          lat, lon, category: cat,
        });
      });
    }
  });

  console.log(`[2/4] Tarama bitti: ${scanned.toLocaleString('tr-TR')} etiketli düğüm · ${rows.length.toLocaleString('tr-TR')} POI seçildi · ${unnamed.toLocaleString('tr-TR')} adsız atlandı`);
  if (rows.length === 0) {
    console.error('HATA: hiç POI bulunamadı.');
    process.exit(3);
  }

  /* ── SQLite yazımı ── */
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run('PRAGMA journal_mode = OFF;');
  db.run(`CREATE TABLE poi (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    search   TEXT NOT NULL,
    address  TEXT NOT NULL DEFAULT '',
    lat      REAL NOT NULL,
    lon      REAL NOT NULL,
    category TEXT NOT NULL
  );`);

  const stmt = db.prepare('INSERT OR IGNORE INTO poi (id,name,search,address,lat,lon,category) VALUES (?,?,?,?,?,?,?)');
  db.run('BEGIN;');
  for (const r of rows) {
    /* lat/lon SAYI olarak bağlanır — metin olsaydı `BETWEEN` sessizce boş dönerdi. */
    stmt.run([r.id, r.name, r.search, r.address, r.lat, r.lon, r.category]);
  }
  db.run('COMMIT;');
  stmt.free();

  db.run('CREATE INDEX idx_poi_search ON poi(search);');
  db.run('CREATE INDEX idx_poi_bbox   ON poi(lat, lon);');
  db.run('CREATE INDEX idx_poi_cat    ON poi(category);');
  db.run('VACUUM;');

  const bytes = db.export();
  db.close();

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(bytes));

  writeFileSync(
    resolve(dirname(outPath), 'poi.license.txt'),
    [
      'poi.db — çevrimdışı POI veritabanı',
      '',
      'Kaynak veri: OpenStreetMap (https://www.openstreetmap.org)',
      'Lisans: Open Database License (ODbL) v1.0',
      '        https://opendatacommons.org/licenses/odbl/1-0/',
      '',
      'ZORUNLU ATIF: uygulama "© OpenStreetMap katkıcıları" ibaresini',
      'kullanıcıya GÖSTERMEK zorundadır. Bu dosyayı silmeyin.',
      '',
      'Üretim: scripts/build-poi-db.mjs · yalnız NODE olarak haritalanmış POI\'ler',
    ].join('\n'),
    'utf8',
  );

  const mb = (bytes.length / 1048576).toFixed(2);
  console.log('[3/4] Kategori dağılımı:');
  for (const [cat, n] of [...perCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${cat.padEnd(14)} ${n.toLocaleString('tr-TR')}`);
  }
  console.log(`[4/4] Yazıldı: ${outPath} (${mb} MB)`);
}

main().catch((e) => {
  console.error('ÜRETİM DÜŞTÜ:', e?.stack || e);
  process.exit(1);
});
