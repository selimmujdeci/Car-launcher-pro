/**
 * musicF61DuckAuthority.test.ts — MUSIC F6.1 · Tek duck otoritesi.
 *
 * Kapsam: `duckRequest` adaptörünün kanonik kapıya (mediaCommandGateway) doğru
 * bağlandığı, token yarışlarında duck SIZDIRMADIĞI ve bayat/çift bırakmanın
 * ETKİSİZ olduğu.
 *
 * Bu dosya duck SEVİYESİ test ETMEZ — seviye `duckPolicy`nindir ve kendi
 * testleri vardır. Burada yalnız ADAPTÖR sözleşmesi kilitlenir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* Kanonik kapı sahte: gerçek native köprü/oynatma grafiği bu teste GİRMEZ. */
const duck = vi.fn<(reason: string) => Promise<number>>();
const unduck = vi.fn<(token: number) => Promise<boolean>>();

vi.mock('../platform/media/authority/mediaCommandGateway', () => ({
  duck: (reason: string) => duck(reason),
  unduck: (token: number) => unduck(token),
}));

import {
  requestDuck, getDuckRequestCounters, __resetDuckRequestForTest,
} from '../platform/media/authority/duckRequest';

/**
 * Görev kuyruğunu boşalt. Adaptör gateway'i DİNAMİK import eder; bu bir makro
 * göreve düşer, salt `Promise.resolve()` turları YETMEZ.
 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((res) => { setTimeout(res, 0); });
  }
};

let nextToken = 0;

beforeEach(() => {
  __resetDuckRequestForTest();
  nextToken = 0;
  duck.mockReset();
  unduck.mockReset();
  duck.mockImplementation(() => Promise.resolve(++nextToken));
  unduck.mockImplementation(() => Promise.resolve(true));
});

afterEach(() => { vi.restoreAllMocks(); });

describe('F6.1 · duckRequest adaptörü', () => {
  it('kanonik kapıya sebebi AYNEN iletir; kendi seviyesini üretmez', async () => {
    requestDuck('NAVIGATION');
    await flush();
    expect(duck).toHaveBeenCalledTimes(1);
    expect(duck).toHaveBeenCalledWith('NAVIGATION');
  });

  it('release token ile bırakır (kendi ürettiği kimlikle DEĞİL)', async () => {
    const h = requestDuck('MAVI');
    await flush();
    h.release();
    await flush();
    expect(unduck).toHaveBeenCalledTimes(1);
    expect(unduck).toHaveBeenCalledWith(1);
  });

  it('token GELMEDEN release edilirse duck SIZMAZ (token gelince bırakılır)', async () => {
    let resolveDuck: (t: number) => void = () => {};
    duck.mockImplementationOnce(() => new Promise<number>((res) => { resolveDuck = res; }));

    const h = requestDuck('SAFETY');
    h.release();                 // token henüz yok
    await flush();
    expect(unduck).not.toHaveBeenCalled();

    resolveDuck(42);             // token geç geldi
    await flush();
    expect(unduck).toHaveBeenCalledTimes(1);
    expect(unduck).toHaveBeenCalledWith(42);
  });

  it('çift release İDEMPOTENT — ikinci çağrı sesi yükseltmez', async () => {
    const h = requestDuck('MAVI');
    await flush();
    h.release();
    h.release();
    h.release();
    await flush();
    expect(unduck).toHaveBeenCalledTimes(1);
  });

  it('kapı duck\'ı REDDEDERSE (token 0) unduck denenmez', async () => {
    duck.mockImplementationOnce(() => Promise.resolve(0));
    const h = requestDuck('MAVI');
    await flush();
    h.release();
    await flush();
    expect(unduck).not.toHaveBeenCalled();
  });

  it('kapı hata fırlatırsa FAIL-SOFT — istisna yayılmaz, sayaç düşüşü kaydeder', async () => {
    duck.mockImplementationOnce(() => Promise.reject(new Error('native yok')));
    const h = requestDuck('MAVI');
    await flush();
    expect(() => { h.release(); }).not.toThrow();
    await flush();
    expect(getDuckRequestCounters().failed).toBeGreaterThan(0);
  });

  it('iç içe duck bağımsız token taşır — biri bitince diğeri AÇIK kalır', async () => {
    const nav = requestDuck('NAVIGATION');
    const mavi = requestDuck('MAVI');
    await flush();
    expect(duck).toHaveBeenCalledTimes(2);

    mavi.release();
    await flush();
    expect(unduck).toHaveBeenCalledTimes(1);
    expect(unduck).toHaveBeenCalledWith(2);   // yalnız kendi kaydı kalktı

    nav.release();
    await flush();
    expect(unduck).toHaveBeenCalledTimes(2);
    expect(unduck).toHaveBeenLastCalledWith(1);
  });

  it('sayaçlar yalnız GÖZLEMdir — istek/bırakma adedini dürüst raporlar', async () => {
    const a = requestDuck('MAVI');
    const b = requestDuck('NAVIGATION');
    await flush();
    a.release();
    await flush();
    const c = getDuckRequestCounters();
    expect(c.requested).toBe(2);
    expect(c.released).toBe(1);
    b.release();
  });
});
