/**
 * Eski WebView çalışma zamanı API'leri — Chrome 52+ hedefinde açılışı ve
 * Phone Link müzik komutlarını öldüren iki eksik API.
 *
 * (1) AbortController (Chrome 66): yokken `SystemBoot.start()` ve maplibre
 *     ReferenceError ile düşüyordu (build + Chromium ölçümü, 2026-09-30).
 * (2) crypto.randomUUID (Chrome 92): Phone Link müzik komutunun varsayılan
 *     operationId'si ham çağrıyla üretiliyordu → TypeError.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAbortControllerPolyfill } from '../utils/abortControllerPolyfill';

type Ctor = new () => {
  signal: {
    aborted: boolean; reason: unknown; onabort: ((e: unknown) => void) | null;
    addEventListener(t: string, f: (e: unknown) => void): void;
    removeEventListener(t: string, f: (e: unknown) => void): void;
    throwIfAborted(): void;
  };
  abort(reason?: unknown): void;
};

function shim(): Ctor {
  const g: Record<string, unknown> = {};
  expect(installAbortControllerPolyfill(g)).toBe(true);
  expect(typeof g.AbortSignal).toBe('function');
  return g.AbortController as Ctor;
}

describe('AbortController yaması', () => {
  it('yerleşik varsa DOKUNMAZ (Chrome 66+ davranışı değişmez)', () => {
    const native = function NativeAC() {};
    const g: Record<string, unknown> = { AbortController: native };
    expect(installAbortControllerPolyfill(g)).toBe(false);
    expect(g.AbortController).toBe(native);
  });

  it('abort: aborted/reason kurulur, onabort + dinleyiciler BİR kez çağrılır', () => {
    const c = new (shim())();
    const onabort = vi.fn();
    const l = vi.fn();
    const removed = vi.fn();
    c.signal.onabort = onabort;
    c.signal.addEventListener('abort', l);
    c.signal.addEventListener('abort', removed);
    c.signal.removeEventListener('abort', removed);
    expect(c.signal.aborted).toBe(false);
    expect(() => c.signal.throwIfAborted()).not.toThrow();

    c.abort();
    c.abort(); // ikinci çağrı no-op
    expect(c.signal.aborted).toBe(true);
    expect((c.signal.reason as Error).name).toBe('AbortError');
    expect(onabort).toHaveBeenCalledTimes(1);
    expect(l).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    expect(() => c.signal.throwIfAborted()).toThrow();
  });

  it('verilen sebep korunur; dinleyici hatası diğerlerini engellemez', () => {
    const c = new (shim())();
    const after = vi.fn();
    c.signal.addEventListener('abort', () => { throw new Error('dinleyici'); });
    c.signal.addEventListener('abort', after);
    c.abort('iptal');
    expect(c.signal.reason).toBe('iptal');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('main.tsx\'in İLK import\'u yamadır (sonraki modüllerden önce kurulmalı)', () => {
    const src = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');
    const firstImport = src.split('\n').find((line) => line.startsWith('import '));
    expect(firstImport).toBe("import './utils/abortControllerPolyfill.ts'");
  });
});

describe('Phone Link müzik komutu — crypto.randomUUID olmayan WebView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('varsayılan operationId ile çağrı TypeError atmaz, tipli sonuç döner', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a });
    const { dispatchGuestMusicCommand } = await import('../platform/phoneLink/phoneLinkMusicRemoteAdapter');
    const r = await dispatchGuestMusicCommand('GET_NOW_PLAYING');
    expect(r.command).toBe('GET_NOW_PLAYING');
    expect(r.ok).toBe(false); // bağlı misafir yok → tipli ret, çökme değil
  });
});
