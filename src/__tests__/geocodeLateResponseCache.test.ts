/**
 * GEÇ GELEN NOMINATIM YANITI ÇÖPE GİTMEZ.
 *
 * SAHA KÖKÜ (2026-08-08, Siverek — ölçüldü):
 * Sürücü "siverek ofis parkı" aradı, ürün bulamadı; yalnız "Siverek" ve 25 km
 * ötedeki "Kışla" mahallesi döndü (= `_offlineFallback` çıktısı). Oysa Nominatim
 * AYNI sorguya doğru cevabı veriyor — dört varyantta da doğrulandı:
 *   `leisure/park → Ofis Parkı, Ofis Mahallesi, Siverek, Şanlıurfa`
 * Kusur ağda değil BİZDEYDİ: `FAST_FAIL_MS` dolunca `ctrl.abort()` isteği
 * öldürüyordu. ("Siverek Otogarı"nın bir kez görünmesi aynı teşhisi doğrular:
 * o denemede yanıt 2 s'nin altında kalmıştı.)
 *
 * SÖZLEŞME: fast-fail YALNIZ beklemeyi bitirir. Yanıt hızı birebir korunur,
 * ama geç gelen doğru cevap önbelleğe yazılır ve sonraki arama onu bulur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/platform/geocodingService.ts'), 'utf8');
/** Yorumları soyar — kilit YORUMU değil KODU denetler. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('🔒 fast-fail isteği ÖLDÜRMEZ', () => {
  it('🔒 fast-fail zamanlayıcısı içinde abort ÇAĞRILMAZ', () => {
    /* Kusurun ta kendisi: `setTimeout(() => { ctrl.abort(); resolve(null) })`.
       Zamanlayıcı yalnız resolve etmeli. */
    const timerBody = code.match(/fastFailTimer\s*=\s*setTimeout\(([\s\S]{0,120}?)FAST_FAIL_MS/);
    expect(timerBody, 'fast-fail zamanlayıcısı bulunamadı').not.toBeNull();
    expect(
      (timerBody as RegExpMatchArray)[1],
      'fast-fail yeniden abort ediyor — 2 saniyeyi aşan DOĞRU cevap yine çöpe gider',
    ).not.toContain('abort');
  });

  it('🔒 tek sert üst sınır korunur: abort(TIMEOUT) = 8 s', () => {
    expect(code).toContain('abort(TIMEOUT)');
    expect(code).toMatch(/TIMEOUT\s*=\s*8_000/);
  });

  it('🔒 `clear()` finally içinde ÇAĞRILMAZ (uçan isteğin sınırı yaşamalı)', () => {
    /* finally'de clear() çağrılırsa 8 s'lik sert sınır iptal olur ve iptal
       edilmeyen istek sonsuza kadar asılı kalabilir. */
    const fin = code.match(/finally\s*\{([\s\S]{0,300}?)\}/);
    expect(fin).not.toBeNull();
    expect((fin as RegExpMatchArray)[1]).not.toMatch(/(^|[^.\w])clear\(\)/);
  });

  it('🔒 sert sınır geç yanıt yolunda temizlenir (zamanlayıcı sızmaz)', () => {
    expect(code).toMatch(/\.then\(\(v\)[\s\S]{0,160}clear\(\)/);
  });
});

describe('🔒 geç yanıt önbelleği — sözleşme', () => {
  it('🔒 yanıt gelince önbelleğe yazılır', () => {
    expect(code).toMatch(/_lateCachePut\(cacheKey, v\)/);
  });

  it('🔒 ağa çıkmadan ÖNCE önbellek okunur', () => {
    /* Karşılaştırma `_nominatimOnce` GÖVDESİNDE yapılır: `_waitNominatim`
       dosyada önce TANIMLANDIĞI için tüm dosyada indeks kıyaslamak yanıltır. */
    const bodyStart = code.indexOf('async function _nominatimOnce(');
    expect(bodyStart, '_nominatimOnce bulunamadı').toBeGreaterThan(-1);
    const body = code.slice(bodyStart);

    const idxGet  = body.indexOf('_lateCacheGet(cacheKey)');
    const idxWait = body.indexOf('await _waitNominatim()');
    expect(idxGet, 'önbellek okuması gövdede yok').toBeGreaterThan(-1);
    expect(idxWait, 'rate-limiter beklemesi gövdede yok').toBeGreaterThan(-1);
    expect(idxGet, 'önbellek rate-limiter beklemesinden SONRA okunuyor').toBeLessThan(idxWait);
  });

  it('🔒 BOŞ yanıt önbelleğe alınmaz (sahte "sonuç yok" mühürlenmesin)', () => {
    expect(code).toMatch(/if\s*\(!results\.length\)\s*return;/);
  });

  it('🔒 önbellek SINIRLI ve süreli — sızıntı ve bayat sonuç yok', () => {
    expect(code).toMatch(/LATE_CACHE_MAX\s*=\s*\d+/);
    expect(code).toMatch(/LATE_CACHE_TTL_MS\s*=\s*[\d\s*_60]+/);
    // TTL aşımında kayıt SİLİNİR, sessizce döndürülmez.
    expect(code).toMatch(/LATE_CACHE_TTL_MS\)\s*\{\s*_lateCache\.delete/);
  });

  it('🔒 önbellek anahtarı viewbox dâhil TÜM parametrelerden türer', () => {
    /* Yalnız sorgu metniyle anahtarlanırsa başka bir şehirdeki aynı arama
       yanlış sonucu döndürür. */
    expect(code).toContain('const cacheKey = params.toString()');
  });

  it('🔒 rate-limiter sözleşmesi BOZULMADI', () => {
    expect(code).toContain('await _waitNominatim()');
  });
});
