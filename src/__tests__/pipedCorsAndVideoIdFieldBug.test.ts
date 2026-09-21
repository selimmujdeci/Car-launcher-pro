/**
 * pipedCorsAndVideoIdFieldBug.test.ts — 2026-09-05 GERÇEK CİHAZ SAHA KUSURU.
 *
 * CDP ile canlı ölçüldü (Redmi 23090RA98I, WebView, gerçek TARKAN video seçimi):
 *
 *   [YT] playYouTube videoId= //Vektq96zp00                    ← ① kirli id
 *   Access to fetch at 'https://piped-api.lunar.icu/streams///Vektq96zp00'
 *     ... blocked by CORS policy                                ← ② CORS
 *   [YT] hazırlık başarısız: audio_fallback_no_stream
 *
 * İKİ BAĞIMSIZ KUSUR, aynı anda:
 *
 *   ① `extractVideoId('piped://X')` yalnız İLK `:`ye kadar kesiyordu →
 *      `piped://` şemasının `//`si videoId'in İÇİNE sızıyordu (`//X`).
 *   ② `pipedProvider`nin TÜM istekleri düz `fetch()` kullanıyordu — Android
 *      WebView origin'i `https://localhost`tur ve HİÇBİR public Piped/
 *      Invidious instance'ı CORS izni vermez → her istek ERR_FAILED.
 *
 * ② tek başına bile ses yedeğini (#1293) işlevsiz bırakıyordu: id doğru olsa
 * bile native cihazda hiçbir istek asla CORS'u geçemezdi.
 *
 * ③ ① ve ② düzeltildikten SONRA, gerçek cihazda `CapacitorHttp.get()` ile
 * doğrudan doğrulandı: `api.piped.private.coffee/streams/EBwjmeDoE6A`
 * (TARKAN'ın kendi kanalındaki gerçek video) **200 OK** döndü (CORS engeli
 * gerçekten aşıldı) ama `audioStreams: []` — bu içerik için YouTube ayrı
 * audio-only akış çıkarımına izin vermiyor. Aynı yanıtın `videoStreams`
 * dizisinde `videoOnly:false, itag:18` (klasik muxed video+ses mp4) akışı
 * VARDI — eski kod yalnız `audioStreams`e baktığı için bunu asla kullanmıyor,
 * `audio_fallback_no_stream`e düşüyordu. `<audio>` elementi muxed mp4'ü de
 * çalabildiği için `resolvePipedStream` artık `audioStreams` boşsa
 * `videoStreams` içindeki `videoOnly:false` akışa YEDEK olarak düşüyor
 * (Invidious tarafında simetriği: `adaptiveFormats` boşsa `formatStreams`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const ADAPTERS = read('src/platform/media/authority/backendAdapters.ts');
const PIPED = read('src/platform/media/pipedProvider.ts');

describe('① extractVideoId artık şemanın // kalıntısını bırakmıyor', () => {
  it('🔒 saf davranış: piped://X → X (// sızıntısı YOK)', () => {
    const i = ADAPTERS.indexOf('function extractVideoId(');
    const raw = ADAPTERS.slice(i, ADAPTERS.indexOf('\n}', i) + 2);
    // TS tip imzalarını at — düz JS Function() yalnız çalışma zamanı kodunu anlar.
    const js = raw
      .replace('function extractVideoId(uri: string): string {', 'function extractVideoId(uri) {');
    const fn = new Function(`${js}\nreturn extractVideoId;`)() as (u: string) => string;
    expect(fn('piped://Vektq96zp00'), 'kusurlu id geri geldi — // sızıyor').toBe('Vektq96zp00');
    expect(fn('piped:Vektq96zp00')).toBe('Vektq96zp00');
    expect(fn('piped:/Vektq96zp00')).toBe('Vektq96zp00');
  });

  it('🔒 kaynakta baştaki / temizliği açıkça VAR (kör metin araması değil)', () => {
    const i = ADAPTERS.indexOf('function extractVideoId(');
    const gövde = ADAPTERS.slice(i, ADAPTERS.indexOf('\n}', i));
    expect(gövde, 'baştaki / karakterleri atılmıyor').toMatch(/replace\(\/\^\\\/\+\/, ''\)/);
  });
});

describe('② pipedProvider CORS engelini native köprüden aşar', () => {
  it('🔒 dört istek yolu da (piped ara · piped akış · invidious ara · invidious akış) ortak GET yolundan geçer', () => {
    const calls = PIPED.match(/_getJson\(/g) ?? [];
    expect(calls.length, 'dört istek de _getJson üzerinden geçmiyor').toBeGreaterThanOrEqual(4);
    expect(PIPED, 'düz fetch geri gelmiş — CORS yeniden bloklanır').not.toMatch(/await fetch\(`\$\{base\}/);
  });

  it('🔒 native cihazda CapacitorHttp kullanılır (gerçek native istek, WebView fetch DEĞİL)', () => {
    expect(PIPED).toContain("import { CapacitorHttp } from '@capacitor/core'");
    const i = PIPED.indexOf('async function _getJson(');
    const gövde = PIPED.slice(i, PIPED.indexOf('\nfunction _perInstanceSignal', i));
    expect(gövde, 'isNative dalı yok').toContain('if (isNative)');
    expect(gövde).toContain('CapacitorHttp.get(');
  });

  it('🔒 web/dev modda düz fetch\'e DÜŞÜLÜR — tek yerde, davranış web\'de değişmez', () => {
    const i = PIPED.indexOf('async function _getJson(');
    const gövde = PIPED.slice(i, PIPED.indexOf('\nfunction _perInstanceSignal', i));
    expect(gövde, 'web yolu kaldırılmış').toContain('await fetch(url, { signal });');
  });

  it('🔒 global CapacitorHttp.enabled bayrağına DOKUNULMADI (yalnız BU dosyanın istekleri etkilenir)', () => {
    expect(read('capacitor.config.ts'), 'global fetch/XHR patch açılmış — uygulama geneli etkilenir')
      .not.toContain('CapacitorHttp');
  });

  it('🔒 dış AbortSignal (instance-başı zaman aşımı) native yolda da SAYGI görür', () => {
    const i = PIPED.indexOf('async function _getJson(');
    const gövde = PIPED.slice(i, PIPED.indexOf('\nfunction _perInstanceSignal', i));
    expect(gövde, 'signal iptali okunmuyor — ölü instance native yolda asılı kalır')
      .toContain("signal.addEventListener('abort'");
  });

  it('🔒 hata dürüst null döner — sahte JSON/başarı ÜRETİLMEZ', () => {
    const i = PIPED.indexOf('async function _getJson(');
    const gövde = PIPED.slice(i, PIPED.indexOf('\nfunction _perInstanceSignal', i));
    expect(gövde).toContain('return null;');
    expect(gövde, 'olmayan durum kodu da başarı sayılıyor')
      .toMatch(/res\.status < 200 \|\| res\.status >= 300/);
  });
});

describe('③ resolvePipedStream: audioStreams boşken muxed videoStreams/formatStreams YEDEĞİ', () => {
  const body = (() => {
    const i = PIPED.indexOf('export async function resolvePipedStream(');
    return PIPED.slice(i, PIPED.indexOf('\n}', PIPED.lastIndexOf('return muxed?.url ?? null;')) + 2);
  })();

  it('🔒 Piped: audioStreams boşsa videoOnly:false akışa düşülür (gerçek cihaz: EBwjmeDoE6A)', () => {
    expect(body, 'muxed videoStreams yedeği kaldırılmış').toMatch(/videoStreams/);
    expect(body, 'videoOnly:false filtresi yok — audio-only OLMAYAN bir akış seçilebilir').toMatch(/videoOnly === false/);
  });

  it('🔒 Invidious: adaptiveFormats boşsa formatStreams (muxed) yedeği kullanılır', () => {
    expect(body, 'formatStreams yedeği kaldırılmış').toMatch(/formatStreams/);
  });

  it('🔒 audio-only akış VARSA muxed yedeğe hiç bakılmaz (öncelik sırası korunur)', () => {
    // audio.length kontrolü muxed aramadan ÖNCE erken döner — sıra tersine dönmüş olamaz.
    const audioIdx = body.indexOf('audio.length');
    const muxedIdx = body.indexOf('videoStreams ?? []');
    expect(audioIdx, 'audio.length kontrolü bulunamadı').toBeGreaterThan(-1);
    expect(muxedIdx, 'videoStreams yedeği bulunamadı').toBeGreaterThan(-1);
    expect(audioIdx, 'sıra ters — muxed önce deneniyor').toBeLessThan(muxedIdx);
  });
});
