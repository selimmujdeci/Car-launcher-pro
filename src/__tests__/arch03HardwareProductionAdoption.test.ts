import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * ARCH-03 · Donanım/bildirim MediaSession girişi ikinci bir oynatıcı yolu AÇMAZ.
 *
 * MUSIC F7.3 GÜNCELLEMESİ (kilit KALDIRILMADI, yeni tek-kaynağa BAĞLANDI):
 * `next`/`previous` artık kapıya DOĞRUDAN değil, kuyruk-farkında tek girişten
 * (`carosMediaLayer`) gider. Sebep ölçüldü: kapı komutu kaynağın yeteneğine
 * göre değerlendirir ve backend'i kuyruksuz olan kaynaklarda (YouTube IFrame)
 * `unsupported_capability` ile REDDEDER → direksiyon "sonraki" tuşu hiçbir şey
 * yapmıyordu, oysa üst katmanda gerçek bir sıra vardı.
 *
 * Değişmez KURAL aynı: donanım tuşu kendi oynatıcısını çağıramaz; her yol
 * sonunda `mediaCommandGateway`e iner.
 */
describe('ARCH-03 hardware MediaSession ingress', () => {
  const mediaService = readFileSync('src/platform/mediaService.ts', 'utf8');
  const layer = readFileSync('src/platform/media/carosMediaLayer.ts', 'utf8');

  const setupBlock = mediaService.slice(
    mediaService.indexOf('function _setupMediaSession'),
    mediaService.indexOf('function _teardownMediaSession'),
  );

  it('kilit boş kümeye düşmedi — kaynaklar gerçekten okundu', () => {
    expect(mediaService.length).toBeGreaterThan(5000);
    expect(layer.length).toBeGreaterThan(5000);
    expect(setupBlock.length).toBeGreaterThan(200);
  });

  it('çal/duraklat DOĞRUDAN kanonik kapıya gider (provenance korunur)', () => {
    expect(mediaService).toContain("gateway.play(undefined, 'native_mediasession')");
    expect(mediaService).toContain("gateway.pause(undefined, 'native_mediasession')");
    expect(setupBlock).not.toMatch(/setActionHandler\('play',\s*\(\)\s*=>\s*\{\s*play\(\)/);
  });

  it('sonraki/önceki kuyruk-farkında girişten geçer ve provenance taşır', () => {
    expect(setupBlock).toContain('carosMediaLayer');
    expect(setupBlock).toContain("layer.next('native_mediasession')");
    expect(setupBlock).toContain("layer.previous('native_mediasession')");
  });

  it('donanım girişi ikinci bir oynatıcı yolu AÇMAZ', () => {
    /* MediaSession kancası hiçbir backend'i doğrudan süremez. */
    for (const forbidden of [
      'youtubeTogglePlayPause', 'streamTogglePlayPause', 'localTogglePlayPause',
      'CarLauncher.sendMediaAction',
    ]) {
      expect(setupBlock, `donanım girişi doğrudan backend sürüyor: ${forbidden}`)
        .not.toContain(forbidden);
    }
  });

  it('kuyruk-farkında giriş de sonunda KANONİK kapıya iner', () => {
    /* Üst katman sırası: her parça `_playTrack` → kapı yolundan başlar. */
    expect(layer).toContain('mediaCommandGateway');
    expect(layer).toContain('_playTrack');
    /* Backend sırası: `_nativeNext`/`_nativePrev` → mediaService → kapı. */
    expect(layer).toContain('_nativeNext');
    expect(layer).toContain('_nativePrev');
    /* `_routeToAuthority` provenance'ı kapıya AYNEN geçirir — donanım
       kaynaklı komut kapıda `native_mediasession` olarak görünür. */
    const route = mediaService.slice(
      mediaService.indexOf('async function _routeToAuthority'),
      mediaService.indexOf('export function togglePlayPause'),
    );
    expect(route.length, 'yönlendirici okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(200);
    expect(route).toContain('gw.next(undefined, requester)');
    expect(route).toContain('gw.previous(undefined, requester)');
  });
});
