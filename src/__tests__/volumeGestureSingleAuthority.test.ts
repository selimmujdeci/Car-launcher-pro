/**
 * volumeGestureSingleAuthority.test.ts — #556 · SES JESTİ TEK OTORİTE.
 *
 * ── SAHA ŞİKÂYETİ (2026-08-12) ─────────────────────────────────────────────
 * "Uygulama devamlı telefonun sesini tam kısıyor, açmaktan yoruldum."
 *
 * KÖK: İKİ bağımsız ses jesti katmanı aynı anda mount ediliyordu —
 *   • `VolumeGestureLayer`  (App.tsx)      → window, `capture: true`
 *   • `GestureVolumeZone`   (MainLayout)   → kendi div'i, `stopPropagation()`
 * ve İKİSİ DE varsayılan olarak SOL kenarı dinliyordu (`gestureVolumeSide: 'left'`).
 *
 * `capture: true` olduğu için `GestureVolumeZone`'un `stopPropagation()` çağrısı
 * window dinleyicisini DURDURAMIYORDU (capture fazı hedefe inmeden çalışır).
 * Sonuç: sol 60 px'te her dikey kaydırma İKİ KEZ işleniyordu —
 *   VolumeGestureLayer: innerHeight×0,6 px = %100  → ~0,28 %/px
 *   GestureVolumeZone : 2,8 px = %1              → ~0,36 %/px
 *   toplam                                        → ~0,64 %/px (≈2,3 kat)
 * 150 px'lik sıradan bir kaydırma (liste scroll / harita pan) sesi ~%95 kısıyordu.
 *
 * EK KUSUR: `gestureVolumeSide` ayarı YALNIZ kaldırılan katmanı etkiliyordu →
 * kullanıcı jesti "kapalı" yapsa bile sol kenarda jest çalışmaya devam ediyordu.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

const mainLayout  = read('src/components/layout/MainLayout.tsx');
const volumeLayer = read('src/components/common/VolumeGestureLayer.tsx');

describe('#556 · ses jestinin TEK otoritesi vardır', () => {
  it('🔒 MainLayout ikinci bir ses jesti katmanı MOUNT ETMEZ', () => {
    /* İki katman aynı kenarı dinlediği anda hassasiyet toplanır ve ses
       kullanıcının beklediğinin ~2,3 katı hızla düşer. */
    expect(mainLayout, 'GestureVolumeZone yeniden mount edilmiş — çift işleme geri geldi')
      .not.toMatch(/<GestureVolumeZone/);
    expect(mainLayout, 'GestureVolumeZone import edilmiş (ölü import veya yeniden bağlanma)')
      .not.toMatch(/import \{ GestureVolumeZone \}/);
  });

  it('🔒 tek katman kullanıcının kenar TERCİHİNİ uygular', () => {
    expect(volumeLayer, 'gestureVolumeSide okunmuyor — ayar yine yok sayılıyor')
      .toMatch(/gestureVolumeSide/);
    expect(volumeLayer, 'sağ kenar desteği yok — ayar seçilse de sol dinlenir')
      .toMatch(/gestureSide === 'right'/);
  });

  it('🔒 "kapalı" seçildiğinde HİÇBİR dinleyici kurulmaz', () => {
    /* Eskiden ayar bu katmanı hiç etkilemiyordu: kullanıcı jesti kapatsa bile
       sol kenarda ses değişmeye devam ediyordu. */
    expect(volumeLayer, 'off dalı yok — "kapalı" gerçekten kapalı değil')
      .toMatch(/if \(gestureSide === 'off'\) return;/);
  });

  it('🔒 kenar tercihi değişince dinleyiciler YENİDEN kurulur', () => {
    /* `gestureSide` bağımlılıkta yoksa ayar değişimi effect'e ulaşmaz ve
       kullanıcı "sağ" seçse bile sol kenar dinlenmeye devam eder. */
    expect(volumeLayer, 'effect bağımlılığında gestureSide yok — ayar geç uygulanır')
      .toMatch(/\}, \[updateSettings, gestureSide\]\);/);
  });

  it('🔒 açılışta CİHAZ sesine dokunulmaz (2026-07-31 dersi korunur)', () => {
    /* Uygulamanın açılması bir ses komutu değildir; mount effect'i yalnız
       uygulama-içi oynatıcı seviyesini ayarlar. */
    expect(volumeLayer).toMatch(/useEffect\(\(\) => \{\s*\n\s*setInAppVolume\(volRef\.current\);\s*\n\s*\}, \[\]\);/);
  });
});
