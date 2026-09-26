/**
 * maplibreXssContainmentW13.test.ts — WAVE 13 · MAPLIBRE XSS YÜZEYİ KAPALI KALIR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ADVISORY
 *   GHSA-jrc7-96c5-q579 — "MapLibre GL JS: XSS Sanitizer Bypass in
 *   DOM.sanitize() via Live NamedNodeMap Removal Skip" · CWE-79 · CVSS 10.0
 *   Savunmasız aralık: <= 6.4.0 · İlk yamalı: 6.4.1
 *   Kurulu sürüm: 4.7.1 → ARALIK İÇİNDE (etkilenen bağımlılık).
 *
 * ── ÖLÇÜLEN GERÇEK (kurulu 4.7.1 dist'inden) ─────────────────────────────
 * 4.x'te `Popup.setHTML(t)` ZATEN sanitize ETMEZ; gövdesi düz
 * `body.innerHTML = t`'dir. Yani advisory'nin tarif ettiği "sanitizer bypass"
 * 4.x'te var OLMAYAN bir sanitizer'a aittir — 4.x'te bu API tasarımı gereği
 * güvensizdir. Her iki okumada da ürün sonucu AYNIDIR: bu API'ye güvenilmez
 * içerik VERİLMEMELİDİR.
 *
 * ── NEDEN YÜKSELTİLMEDİ ───────────────────────────────────────────────────
 * Yamalı sürüm yalnız 6.4.1+; 4.x ve 5.x'e geri-port YOK. Yani düzeltme İKİ
 * MAJOR atlama demek. CarOS düşük katmanlı K24 head-unit'lerinde eski WebView
 * hedefliyor (Chrome 52+ / 64-79 kilitleri). Ürün yüzeyi ERİŞİLEMEZ olduğu
 * için ölçülmüş faydası sıfır, riski yüksek bir yükseltme yapılmadı.
 *
 * ── BU DOSYA NEYİ KORUR ───────────────────────────────────────────────────
 * Güvenliği sağlayan şey MapLibre sürümü DEĞİL, CarOS'un o API'leri HİÇ
 * kullanmamasıdır. Bu dosya o kapalılığı KİLİTLER: biri `setHTML`/`innerHTML`
 * eklerse ya da attribution HTML yüzeyini açarsa test KIRMIZI olur.
 *
 * ── KANIT SEVİYESİ (dürüstlük) ────────────────────────────────────────────
 * · DAVRANIŞSAL: gerçek DOM'da, saldırgan-kontrollü bir dizge işaretçi yolla
 *   (textContent) yazıldığında ELEMENT ÜRETMEDİĞİ; aynı dizge HTML yoluyla
 *   yazıldığında ürettiği ölçülür → iki yolun farkı gösterilir.
 * · YAPISAL KUŞATMA: üretim harita kaynaklarında tehlikeli sink'lerin
 *   bulunmadığı. Bu, doğası gereği kaynak düzeyinde bir değişmezdir
 *   (kanıtlayacak bir sanitizer YOK; savunma "o API'yi kullanmamak").
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();

/** Haritayı kuran/çizen üretim kaynakları. */
const MAP_DIRS = [
  'src/platform/map',
  'src/components/map',
  'src/components/traffic',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  const abs = resolve(ROOT, dir);
  for (const entry of readdirSync(abs)) {
    const p = join(abs, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...walk(join(dir, entry)));
    } else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const MAP_SOURCES = MAP_DIRS.flatMap(walk);
const read = (f: string): string => readFileSync(f, 'utf8');
const rel  = (f: string): string => f.slice(ROOT.length + 1).replace(/\\/g, '/');

// ── Ölçüm gerçekten çalışıyor mu ────────────────────────────────────────────

describe('W13 · harita yüzeyi ölçülebiliyor', () => {
  it('üretim harita kaynakları bulundu', () => {
    /* Yürüyüş bozulup boş küme dönerse aşağıdaki kuşatma HİÇBİR ŞEY
       kanıtlamadan yeşil olurdu. */
    expect(MAP_SOURCES.length, 'harita kaynak dosyası bulunamadı').toBeGreaterThan(10);
    expect(MAP_SOURCES.some((f) => read(f).includes('maplibre')),
      'hiçbir dosyada maplibre kullanımı görülmedi — yanlış dizinler').toBe(true);
  });
});

// ── DAVRANIŞSAL: iki render yolunun farkı ölçülür ───────────────────────────

describe('W13 · güvenilmez dizge METİN olarak render edilir', () => {
  /** Zararsız işaretçi: script çalıştırmaz, yalnız ELEMENT üretir. */
  const PAYLOAD = '<img src=x onerror="window.__W13__=1">';

  it('textContent yolu HİÇ element üretmez (CarOS\'un kullandığı yol)', () => {
    const el = document.createElement('div');
    el.textContent = PAYLOAD;

    expect(el.children.length, 'metin yolu element üretti — kuşatma kırık').toBe(0);
    expect(el.querySelector('img'), 'metin yolundan <img> doğdu').toBeNull();
    /* Dizge kaybolmaz; kullanıcıya AYNEN metin olarak görünür. */
    expect(el.textContent).toBe(PAYLOAD);
  });

  it('HTML yolu AYNI dizgeden element üretir (kaçınılan yol)', () => {
    /* Bu, testin körü olmadığının kanıtıdır: payload gerçekten tehlikelidir,
       fark eden şey CarOS'un hangi API'yi seçtiğidir. */
    const el = document.createElement('div');
    el.innerHTML = PAYLOAD;

    expect(el.querySelector('img'), 'payload HTML yolunda da element üretmedi — işaretçi geçersiz')
      .not.toBeNull();
  });
});

// ── YAPISAL KUŞATMA: tehlikeli sink'ler üretimde YOK ───────────────────────

describe('W13 · MapLibre HTML sink\'leri üretimde kullanılmaz', () => {
  it('`setHTML` / `setDOMContent` harita kodunda YOK', () => {
    const hits = MAP_SOURCES
      .filter((f) => /\.setHTML\s*\(|\.setDOMContent\s*\(/.test(read(f)))
      .map(rel);
    expect(
      hits,
      'MapLibre 4.7.1 setHTML sanitize ETMEZ (düz innerHTML) — güvenilmez içerik '
      + 'verilirse GHSA-jrc7-96c5-q579 sınıfı XSS doğar',
    ).toEqual([]);
  });

  it('harita kodunda `innerHTML` ataması YOK', () => {
    const hits = MAP_SOURCES
      .filter((f) => /\.innerHTML\s*=/.test(read(f)))
      .map(rel);
    expect(hits, 'harita katmanında doğrudan innerHTML ataması — metin yolu kullanılmalı')
      .toEqual([]);
  });

  it('`Popup` üretimde kullanılmaz (tek HTML kabul eden MapLibre yüzeyi)', () => {
    const hits = MAP_SOURCES
      .filter((f) => /new\s+(maplibregl\.)?Popup\s*\(/.test(read(f)))
      .map(rel);
    expect(hits, 'Popup eklenmiş — setHTML yüzeyi ürüne girdi').toEqual([]);
  });

  it('attribution HTML yüzeyi her harita kurulumunda KAPALI', () => {
    /* MapLibre, style JSON\'daki `attribution` alanını HTML olarak basar.
       Uzak style sağlayıcısı ele geçirilirse bu bir sink olur; CarOS bunu
       kapatır. */
    const creators = MAP_SOURCES.filter((f) => /attributionControl\s*:/.test(read(f)));
    expect(creators.length, 'attributionControl ayarı hiç bulunamadı').toBeGreaterThan(0);

    const enabled: string[] = [];
    for (const f of creators) {
      for (const m of read(f).matchAll(/attributionControl\s*:\s*([A-Za-z0-9_.]+)/g)) {
        if (m[1] !== 'false') enabled.push(`${rel(f)} → ${m[1]}`);
      }
    }
    expect(enabled, 'attribution HTML yüzeyi açılmış — style kaynaklı HTML DOM\'a basılır')
      .toEqual([]);
  });
});
