/**
 * poiDatabase.test.ts — V-06 çevrimdışı POI veritabanı KİLİTLERİ.
 *
 * ÜÇ ŞEYİ KİLİTLER:
 *  (A) TÜRKÇE KATLAMA İKİZİ — `poi.db`yi YAZAN kural (build) ile sorguyu
 *      KATLAYAN kural (çalışma zamanı) aynı davranmak ZORUNDA. Ayrışırlarsa
 *      arama sessizce hiçbir şey bulmaz (en kötü hata türü: sessiz sıfır).
 *  (B) ÜRETİLEN VERİ — dosya var, şema doğru, `lat`/`lon` GERÇEKTEN sayı,
 *      dolu ve boyut bütçesinde.
 *  (C) WORKER SÖZLEŞMESİ — FTS5'e dönmemiş, sıralama mesafeye göre, LIKE
 *      jokerleri nötrleniyor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import { foldTr as foldTs, TURKISH_FOLD_MAP as MAP_TS } from '../platform/navigation/core/turkishFold';
import { foldTr as foldJs, TURKISH_FOLD_MAP as MAP_JS } from '../../scripts/lib/turkishFold.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const DB_PATH = 'public/maps/poi.db';
const MAX_DB_MB = 40;
const dbExists = existsSync(resolve(process.cwd(), DB_PATH));

/* ══════════════════════════════════════════════════════════════════════════
 * A) KATLAMA İKİZİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('poiDatabase › Türkçe katlama ikizi', () => {
  /** Türkçe'nin i/I tuzağını ve tüm özel harfleri kapsayan fikstür. */
  const FIXTURES = [
    'İstanbul', 'istanbul', 'ISTANBUL', 'ıstanbul', 'Istanbul',
    'IĞDIR', 'Iğdır', 'ığdır',
    'Şişli', 'ŞİŞLİ', 'sisli',
    'Çankaya', 'ÇANKAYA', 'cankaya',
    'Göztepe', 'GÖZTEPE', 'goztepe',
    'Üsküdar', 'ÜSKÜDAR', 'uskudar',
    'Şifa Eczanesi', 'ŞİFA ECZANESİ',
    'Petrol Ofisi  ', '  BP   Akaryakıt ',
    'Kâzım Karabekir', 'KÂZIM',
    '', '   ', 'abc123', 'Ödemiş / İzmir',
  ];

  it('build ve çalışma zamanı ikizleri AYNI çıktıyı verir', () => {
    for (const f of FIXTURES) {
      expect(foldJs(f), `ayrışma: "${f}"`).toBe(foldTs(f));
    }
  });

  it('katlama tabloları BİREBİR aynıdır', () => {
    expect(Object.keys(MAP_JS).sort()).toEqual(Object.keys(MAP_TS).sort());
    for (const k of Object.keys(MAP_TS)) {
      expect((MAP_JS as Record<string, string>)[k]).toBe(MAP_TS[k]);
    }
  });

  it('i/I ailesinin TAMAMI tek hedefe katlanır — toLowerCase YETMEZ', () => {
    const forms = ['İstanbul', 'istanbul', 'ISTANBUL', 'Istanbul', 'ıstanbul'];
    const folded = forms.map(foldTs);
    expect(new Set(folded).size, `katlanmış biçimler ayrıştı: ${JSON.stringify(folded)}`).toBe(1);
    expect(folded[0]).toBe('istanbul');
  });

  it('`İ`.toLowerCase() artığı (U+0307) TEMİZLENİR', () => {
    /* Bu, sessiz eşleşmezliğin klasik kaynağıdır: görünmez bir birleşen kalır. */
    expect('İ'.toLowerCase()).not.toBe('i');       // problemin kanıtı
    expect(foldTs('İ')).toBe('i');                  // çözümün kanıtı
    expect(foldTs('İ')).toHaveLength(1);
  });

  it('geçersiz girdi ASLA throw etmez', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(() => foldTs(v)).not.toThrow();
      expect(foldTs(v)).toBe('');
    }
  });

  it('katlama bir GÖSTERİM dönüşümü olarak KULLANILMAZ', () => {
    /* Ekranda kullanıcının yazdığı ad gösterilmeli; katlama yalnız arama
       anahtarıdır. Worker sonucu `name` sütunundan okur, `search`ten DEĞİL. */
    const w = stripComments(read('src/platform/navigation/NavigationCompute.worker.ts'));
    expect(w).toMatch(/SELECT id, name, address, lat, lon, category/);
    expect(w).not.toMatch(/name:\s*String\(row\[\d\]\).*search/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) ÜRETİLEN VERİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('poiDatabase › üretilen veri', () => {
  it('poi.db VAR — yoksa çevrimdışı POI araması hiç çalışmaz', () => {
    expect(dbExists, `${DB_PATH} yok — "node scripts/build-poi-db.mjs --in <pbf>" koşulmalı`).toBe(true);
  });

  it.runIf(dbExists)('SQLite dosyasıdır ve boyut bütçesindedir', () => {
    const buf = readFileSync(resolve(process.cwd(), DB_PATH));
    expect(buf.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
    expect(statSync(resolve(process.cwd(), DB_PATH)).size / 1048576).toBeLessThan(MAX_DB_MB);
  });

  it.runIf(dbExists)('şema `poi` tablosunu ve arama/konum indekslerini içerir', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(readFileSync(resolve(process.cwd(), DB_PATH))));
    try {
      const t = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='poi'");
      expect(t[0]?.values?.length).toBe(1);

      const idx = db.exec("SELECT name FROM sqlite_master WHERE type='index'");
      const names = (idx[0]?.values ?? []).map((r) => String(r[0]));
      expect(names).toContain('idx_poi_search');
      expect(names).toContain('idx_poi_bbox');
    } finally { db.close(); }
  });

  it.runIf(dbExists)('lat/lon GERÇEKTEN sayıdır — metin olsaydı BETWEEN sessizce boş dönerdi', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(readFileSync(resolve(process.cwd(), DB_PATH))));
    try {
      const r = db.exec("SELECT typeof(lat), typeof(lon) FROM poi LIMIT 1");
      expect(r[0].values[0]).toEqual(['real', 'real']);

      /* Davranışsal kanıt: SQLite'ta metin > her sayı olduğu için metin
         saklansaydı bu sorgu 0 satır dönerdi. */
      const inTurkey = db.exec(
        'SELECT count(*) FROM poi WHERE lat BETWEEN 35.5 AND 42.5 AND lon BETWEEN 25.5 AND 45.0',
      );
      const total = db.exec('SELECT count(*) FROM poi');
      expect(Number(inTurkey[0].values[0][0])).toBeGreaterThan(0);
      expect(Number(inTurkey[0].values[0][0])).toBe(Number(total[0].values[0][0]));
    } finally { db.close(); }
  });

  it.runIf(dbExists)('gerçek arama sonuç döndürür (benzinlik · eczane)', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(readFileSync(resolve(process.cwd(), DB_PATH))));
    try {
      for (const term of ['benzinlik', 'eczane']) {
        const q = db.exec('SELECT count(*) FROM poi WHERE search LIKE ?', [`%${foldTs(term)}%`]);
        expect(Number(q[0].values[0][0]), `"${term}" için sonuç yok`).toBeGreaterThan(0);
      }
      /* Türkçe büyük harf girdisi de bulmalı (katlama kanıtı). */
      const upper = db.exec('SELECT count(*) FROM poi WHERE search LIKE ?', [`%${foldTs('ECZANE')}%`]);
      expect(Number(upper[0].values[0][0])).toBeGreaterThan(0);
    } finally { db.close(); }
  });

  it.runIf(dbExists)('adsız POI YOKTUR — uydurma ad üretilmemiş', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(readFileSync(resolve(process.cwd(), DB_PATH))));
    try {
      const r = db.exec("SELECT count(*) FROM poi WHERE name IS NULL OR trim(name) = ''");
      expect(Number(r[0].values[0][0])).toBe(0);
    } finally { db.close(); }
  });

  it.runIf(dbExists)('ODbL lisans dosyası veritabanının YANINDA durur', () => {
    const p = resolve(process.cwd(), 'public/maps/poi.license.txt');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toMatch(/ODbL/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) WORKER SÖZLEŞMESİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('poiDatabase › worker sözleşmesi', () => {
  const w = stripComments(read('src/platform/navigation/NavigationCompute.worker.ts'));

  it('FTS5\'e DÖNMEZ — sevk edilen sql.js yapısında fts5 modülü YOK', () => {
    expect(w).not.toMatch(/poi_fts/);
    expect(w).not.toMatch(/bm25\(/);
  });

  it('şema kontrolü `poi` tablosuna bakar', () => {
    expect(w).toMatch(/name='poi'/);
  });

  it('konum varken sıralama MESAFEYE göredir (metin benzerliğine DEĞİL)', () => {
    expect(w).toMatch(/\(\(lat - \?\) \* \(lat - \?\)\) \+ \(\(lon - \?\) \* \(lon - \?\) \* \?\) AS score/);
    /* Boylam farkı enleme göre ölçeklenmeli; yoksa kuzeyde doğu-batı mesafesi
       olduğundan büyük görünür ve sıralama bozulur. */
    expect(w).toMatch(/lonScale = cos \* cos/);
  });

  it('sorgu terimi ÜRETİMLE aynı kuralla katlanır', () => {
    expect(w).toMatch(/foldTr\(query\)/);
    expect(w).toMatch(/from '\.\/core\/turkishFold'/);
  });

  it('LIKE jokerleri NÖTRLENİR (kullanıcı `%` yazınca tüm tablo taranmasın)', () => {
    expect(w).toMatch(/replace\(\/\[%_\\\\\]\/g, ' '\)/);
  });

  it('WASM build zincirinde kopyalanır (public/wasm elle taşınmaz)', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.build).toMatch(/copy-sqljs-wasm\.mjs/);
    /* Üretilen ikili commit EDİLMEMELİ: JS ile WASM sürümü ayrışmasın. */
    expect(read('.gitignore')).toMatch(/public\/wasm\//);
  });
});
