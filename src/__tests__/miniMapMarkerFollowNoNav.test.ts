/**
 * Saha 2026-09-30 (kullanıcı: "yolda giderken tam ekranda konum görünüyor,
 * mini navigasyonda konum geride kalıyor, görünmüyor").
 *
 * KÖK: işareti RAF döngüsünde çizen `navMarkerMotionRuntime` YALNIZ canlı
 * navigasyonda (ACTIVE/REROUTING) beslenir. Navigasyon yokken sürüşte mini
 * harita kamerayı GPS fix'iyle ilerletiyor ama `updateUserMarker` çağrılmıyordu
 * (yalnız kamera kullanıcıdayken çağrılıyordu) → araç son park konumunda kalıp
 * ekrandan çıkıyordu.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/components/map/MiniMapWidget.tsx'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const SESSION = readFileSync(join(process.cwd(), 'src/platform/navigation/navigationSessionRuntime.ts'), 'utf8');

describe('mini harita — navigasyon yokken sürüşte araç işareti', () => {
  it('ön koşul: motion runtime navigasyon dışında beslenmez (işareti başka biri çizmeli)', () => {
    expect(SESSION).toMatch(/status !== NavStatus\.ACTIVE && status !== NavStatus\.REROUTING/);
  });

  it('🔒 sürüş dalında işaret, canlı navigasyon yokken fix\'ten güncellenir', () => {
    const start = code.indexOf('} else if (isDriving) {');
    const end = code.indexOf('wasDrivingRef.current = true;', start);
    expect(start).toBeGreaterThan(0);
    const branch = code.slice(start, end);
    expect(branch).toMatch(/if \(!_cameraOwned \|\| !navLiveRef\.current\) \{\s*updateUserMarker\(latitude, longitude, hdg\);/);
  });
});
