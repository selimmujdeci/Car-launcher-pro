/** F0 — LOCAL playback must remain inside the canonical authority boundary. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const local = read('src/platform/localMusicService.ts');
const layer = read('src/platform/media/carosMediaLayer.ts');
const media = read('src/platform/mediaService.ts');
const boot = read('src/platform/system/SystemBoot.ts');
const stream = read('src/platform/streamMusicService.ts');

describe('F0 LOCAL canonical authority guards', () => {
  it('uses an explicit, default-off legacy rollback flag', () => {
    expect(local).toContain("VITE_USE_LEGACY_LOCAL_PLAYER === 'true'");
    expect(local).toContain('if (!isLegacyLocalPlayerEnabled()) {\n    await _playViaAuthority(index);\n    return;');
  });

  it('sends local queue and selected index through gateway/runtime', () => {
    expect(local).toContain("noteQueue('LOCAL', items, index - start)");
    expect(local).toContain("source: 'LOCAL'");
    expect(local).toContain('startIndex: index - start');
    expect(local).toContain("import('./media/authority/mediaCommandGateway')");
  });

  it('does not use legacy events or mediaService as canonical truth', () => {
    expect(local).not.toContain('updateMediaState(');
    expect(local).toContain('if (!isLegacyLocalPlayerEnabled()) return;');
    expect(local).toContain('reflectCanonicalLocalSnapshot');
  });

  it('_playTrack no longer directly calls legacy playAtIndex', () => {
    const playTrack = layer.slice(layer.indexOf('function _playTrack'), layer.indexOf('export function playMedia'));
    expect(playTrack).toContain('playLocalSelection');
    expect(playTrack).not.toContain('playAtIndex');
  });

  it('media transport only reaches local helpers under rollback', () => {
    expect(media).toContain("isLegacyLocalPlayerEnabled() && _current.activePackage === 'com.cockpitos.pro'");
  });

  it('does not open native HTML5 stream fallback beside LOCAL authority', () => {
    expect(stream).toContain('if (isNative) {\n    // Native\'de LOCAL/STREAM devri yalnız aynı coordinator üzerinden yapılır.');
    expect(stream).toContain('return isNative;');
  });

  it('starts authority from the primary boot lifecycle, independently of Mavi/UI', () => {
    /* ARCH-06/F1 KİLİT GÜNCELLEMESİ (zayıflatma DEĞİL — kapsam GENİŞLEDİ).
       Çağrı artık salt-gözlem bir ölçüm sarmalayıcısından geçiyor:
         await measureBootService('startMediaAuthority', 1, true, () => startMediaAuthority())
       Kilidin KORUDUĞU davranış AYNEN duruyor ve artık üç ayrı iddia ile
       sınanıyor: (a) çağrı SystemBoot'ta, (b) BEKLENİYOR (await), (c) blocking
       olarak işaretli. Sarmalayıcı sırayı değiştirmez, hatayı yutmaz ve
       promise zincirini bozmaz (arch06PerformanceMeasurement D1-D4). */
    expect(boot).toContain('startMediaAuthority()');
    expect(boot).toContain("await measureBootService('startMediaAuthority', 1, true, () => startMediaAuthority())");
    expect(boot).toContain("this._regNamed('media-authority', stopMediaAuthority)");
    expect(boot).not.toContain('this._reg(stopMediaAuthority)');
  });
});
