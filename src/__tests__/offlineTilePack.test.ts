/**
 * offlineTilePack.test.ts — V-07 çevrimdışı karo paketi KİLİTLERİ.
 *
 * ANA KUSUR (kapatıldı): "Çevrimdışı harita indir" düğmesi ÜRÜNÜN ÇİZDİĞİ
 * karoyu indirmiyordu — RASTER `.png` çekip Service Worker'a güveniyordu; ürün
 * ise VEKTÖR `.pbf` çiziyor ve onları YALNIZ `CacheLRUManager` tutuyor. İndirilen
 * baytlar hiç okunmayan bir depoya gidiyordu.
 *
 * Kilitler dört şeyi korur:
 *  (A) Şablon CANLI kaynaktan çözülür — sabit yazılmaz (sürüm damgası).
 *  (B) İndirme, ürünün OKUDUĞU depoya yazar — ikinci önbellek YOK.
 *  (C) Sayaç/temizleme GERÇEK depoya bakar (eski SW deposu sonsuza dek 0'dı).
 *  (D) Sahte başarı yok: adres çözülemezse indirme BAŞLAMAZ, hepsi düşerse
 *      "tamamlandı" DENMEZ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import {
  extractVersionHint, tileUrlFrom, resolveVectorTileTemplate,
} from '../platform/map/vectorTileTemplate';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * A) ŞABLON ÇÖZÜMÜ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('offlineTilePack › şablon çözümü', () => {
  it('doğrudan şablon verilmişse AĞA ÇIKMAZ', async () => {
    const r = await resolveVectorTileTemplate('https://x.test/{z}/{x}/{y}.pbf');
    expect(r?.source).toBe('template');
    expect(r?.template).toContain('{z}');
  });

  it('boş/geçersiz girdi null döner — SAHTE ŞABLON ÜRETİLMEZ', async () => {
    expect(await resolveVectorTileTemplate('')).toBeNull();
    expect(await resolveVectorTileTemplate('   ')).toBeNull();
  });

  it('TileJSON ucundan `tiles[0]` ve zoom sınırları okunur', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      tiles: ['https://tiles.test/planet/20260802_080001_pt/{z}/{x}/{y}.pbf'],
      minzoom: 3, maxzoom: 14,
    }), { status: 200 })) as typeof fetch;
    try {
      const r = await resolveVectorTileTemplate('https://tiles.test/planet');
      expect(r?.source).toBe('tilejson');
      expect(r?.minzoom).toBe(3);
      expect(r?.maxzoom).toBe(14);
      expect(r?.versionHint).toBe('20260802_080001_pt');
    } finally { globalThis.fetch = orig; }
  });

  it('TileJSON şablonsuzsa null — yanlış adrese indirmektense HİÇ indirme', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ tiles: [] }), { status: 200 })) as typeof fetch;
    try {
      expect(await resolveVectorTileTemplate('https://tiles.test/planet')).toBeNull();
    } finally { globalThis.fetch = orig; }
  });

  it('ağ hatası null döner (throw ETMEZ)', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    try {
      expect(await resolveVectorTileTemplate('https://tiles.test/planet')).toBeNull();
    } finally { globalThis.fetch = orig; }
  });

  it('sürüm damgası çıkarılır; yoksa UYDURULMAZ', () => {
    expect(extractVersionHint('https://t/planet/20260802_080001_pt/1/2/3.pbf')).toBe('20260802_080001_pt');
    expect(extractVersionHint('https://t/planet/{z}/{x}/{y}.pbf')).toBeNull();
  });

  it('şablon somut adrese doğru çevrilir', () => {
    expect(tileUrlFrom('https://t/{z}/{x}/{y}.pbf', 12, 34, 56))
      .toBe('https://t/12/34/56.pbf');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) DOĞRU DEPOYA YAZMA
 * ═════════════════════════════════════════════════════════════════════════ */
describe('offlineTilePack › ürünün okuduğu depoya yazar', () => {
  const dl = stripComments(read('src/platform/offlineTileDownloader.ts'));

  it('indirme `CacheLRUManager.warmUrls` kullanır (ikinci önbellek YOK)', () => {
    expect(dl).toMatch(/cacheLRUManager\.warmUrls\(/);
  });

  it('RASTER `.png` indirme yolu KALDIRILDI', () => {
    expect(dl).not.toMatch(/tile\.openstreetmap\.org/);
    expect(dl).not.toMatch(/\.png`/);
    expect(dl).not.toMatch(/OSM_HOSTS/);
  });

  it('karo adresi CANLI çözülür — sabit şablon gömülmez', () => {
    expect(dl).toMatch(/resolveVectorTileTemplate\(/);
    expect(dl).not.toMatch(/openfreemap\.org\/planet\/\d{8}/);
  });

  it('sağlayıcının bildirdiği zoom sınırlarına saygı gösterilir', () => {
    expect(dl).toMatch(/Math\.max\(preset\.minZoom, tpl\.minzoom\)/);
    expect(dl).toMatch(/Math\.min\(preset\.maxZoom, tpl\.maxzoom\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) SAYAÇ VE TEMİZLEME GERÇEK DEPOYA BAKAR
 * ═════════════════════════════════════════════════════════════════════════ */
describe('offlineTilePack › sayaç ve temizleme', () => {
  const dl = stripComments(read('src/platform/offlineTileDownloader.ts'));
  const panel = stripComments(read('src/components/settings/OfflineDataPanel.tsx'));

  it('sayaç artık SW\'nin `offline-tiles` deposuna BAKMAZ', () => {
    /* Eski hâli oraya bakıyordu ve oraya artık hiçbir şey yazılmıyor →
       panel başarılı bir paketten sonra bile sonsuza dek 0 gösterirdi. */
    expect(dl).not.toMatch(/offline-tiles/);
    expect(dl).not.toMatch(/offline_tiles_cache/);
    expect(dl).toMatch(/cacheLRUManager\.getCacheStats\(\)\.tileCount/);
  });

  it('temizleme GERÇEK önbelleği siler', () => {
    expect(dl).toMatch(/cacheLRUManager\.clearAll\(\)/);
  });

  it('panel boyutu GERÇEK bayttan hesaplar — raster ortalamasından DEĞİL', () => {
    expect(panel).not.toMatch(/tileCount \* 14/);
    expect(panel).toMatch(/getCachedTileBytes/);
  });

  it('panel paket sürümünü kullanıcıya SÖYLER (paket ölebilir)', () => {
    expect(panel).toMatch(/dl\.packVersion/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) SAHTE BAŞARI YASAĞI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('offlineTilePack › sahte başarı yasağı', () => {
  const dl = stripComments(read('src/platform/offlineTileDownloader.ts'));

  it('adres çözülemezse indirme BAŞLAMAZ ve hata bildirilir', () => {
    expect(dl).toMatch(/if \(!tpl\)/);
    expect(dl).toMatch(/İndirme BAŞLATILMADI/);
  });

  it('hepsi düşerse "tamamlandı" DENMEZ', () => {
    expect(dl).toMatch(/r\.failed === r\.done/);
    expect(dl).toMatch(/Hiçbir karo indirilemedi/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E) ISITMA SÖZLEŞMESİ (CacheLRUManager)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('offlineTilePack › ısıtma sözleşmesi', () => {
  const mgr = stripComments(read('src/core/storage/CacheLRUManager.ts'));

  it('ısıtma canlı istekle AYNI `_putToCache` yolunu kullanır', () => {
    const warm = mgr.slice(mgr.indexOf('async warmUrls('), mgr.indexOf('async hasTile('));
    expect(warm).toMatch(/this\._putToCache\(/);
    /* Ayrı bir cache adı açmak ikinci otorite olurdu. */
    expect(warm).not.toMatch(/caches\.open\(/);
  });

  it('zaten önbellekte olan karo AĞA ÇIKMAZ, ama 0 bayt İSABET SAYILMAZ', () => {
    const warm = mgr.slice(mgr.indexOf('async warmUrls('), mgr.indexOf('async hasTile('));
    expect(warm).toMatch(/cached && cached\.byteLength > 0/);
    expect(warm).toMatch(/skipped\+\+/);
  });

  it('0 baytlık gövde önbelleğe YAZILMAZ (#613 koruması korunur)', () => {
    const warm = mgr.slice(mgr.indexOf('async warmUrls('), mgr.indexOf('async hasTile('));
    expect(warm).toMatch(/buf\.byteLength === 0/);
  });

  it('iptal bir HATA olarak sayılmaz', () => {
    const warm = mgr.slice(mgr.indexOf('async warmUrls('), mgr.indexOf('async hasTile('));
    expect(warm).toMatch(/if \(!opts\.signal\?\.aborted\) failed\+\+/);
  });

  it('eşzamanlılık sınırlıdır (head unit + sağlayıcı nezaketi)', () => {
    const warm = mgr.slice(mgr.indexOf('async warmUrls('), mgr.indexOf('async hasTile('));
    expect(warm).toMatch(/Math\.min\(opts\.concurrency \?\? 4, 8\)/);
  });

  it('`clearAll` koridor korumasını da kaldırır ve sayaçları sıfırlar', () => {
    const clear = mgr.slice(mgr.indexOf('async clearAll('), mgr.indexOf('private _touchLastAccess'));
    expect(clear).toMatch(/this\._manifest\.clear\(\)/);
    expect(clear).toMatch(/this\._hits = 0/);
    expect(clear).toMatch(/this\._totalBytes = 0/);
  });
});
