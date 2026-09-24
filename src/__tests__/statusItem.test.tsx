/**
 * statusItem.test.tsx — durum çubuğu öğesi (saha 2026-09-24: "bağlandığı /
 * koptuğu belli olmuyor, amatör görünüyor").
 *
 * Kilitler: bağlıyken KOPMA kırmızı yanıp söner, BAĞLANMA kısa yeşil parlar,
 * ara geçişler sessiz · her öğe kısa etiket taşır · kapalı öğede durum noktası
 * YOK (sahte "bağlı" yok) · parlama CSS-only (timer YOK) · güneş modu siyah
 * kutu kuralından muaf.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gauge } from 'lucide-react';
import { StatusItem, flashFor } from '../components/common/StatusItem';

const HERE = dirname(fileURLToPath(import.meta.url));
const palette = { ink: '#1a1a1a', ink2: '#6b6b6b', accent: '#e0a23c', surface: '#fafafa' };

describe('flashFor — geçiş geri bildirimi', () => {
  it('🔒 bağlıyken kopma/hata → drop · bağlanma → up', () => {
    expect(flashFor('ok', 'off')).toBe('drop');
    expect(flashFor('ok', 'error')).toBe('drop');
    expect(flashFor('off', 'ok')).toBe('up');
    expect(flashFor('active', 'ok')).toBe('up');
  });
  it('ara geçişler ve değişmeyen durum sessiz', () => {
    expect(flashFor('ok', 'ok')).toBeNull();
    expect(flashFor('active', 'warn')).toBeNull();
    expect(flashFor('off', 'active')).toBeNull();
    expect(flashFor('ok', 'warn')).toBeNull();   // bayatlama kopma değildir
  });
});

describe('StatusItem çizimi', () => {
  it('etiket + durum; bağlıyken yeşil nokta, kapalıyken nokta YOK', () => {
    const on = renderToStaticMarkup(<StatusItem Icon={Gauge} state="ok" caption="OBD" label="OBD: Bağlı" palette={palette} size={16} />);
    expect(on).toContain('OBD');
    expect(on).toContain('data-state="ok"');
    expect(on).toContain('#22c55e');
    const off = renderToStaticMarkup(<StatusItem Icon={Gauge} state="off" caption="OBD" label="OBD: Bağlı değil" palette={palette} size={16} />);
    expect(off).not.toContain('#22c55e');
    expect(off).not.toContain('#f59e0b');
    expect(off).not.toContain('#ef4444');
  });
});

describe('kaynak kilitleri', () => {
  it('🔒 parlama CSS-only — StatusItem timer/rAF KULLANMAZ', () => {
    const src = readFileSync(resolve(HERE, '../components/common/StatusItem.tsx'), 'utf8');
    expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
  it('🔒 güneş modunun siyah kutu kuralı durum öğelerine uygulanmaz', () => {
    const css = readFileSync(resolve(HERE, '../index.css'), 'utf8');
    const sunRule = css.indexOf('.sunlight-mode button {');
    const exempt = css.indexOf('.sunlight-mode button.caros-status-item');
    expect(sunRule).toBeGreaterThan(-1);
    expect(exempt).toBeGreaterThan(sunRule);   // muafiyet SONRA → eşit özgüllükte kazanır
  });
  it('🔒 başlıktaki zil düğmesi de muaf (Tesla · Horizon · Expedition)', () => {
    /* Saha 2026-09-24: Expedition düzeninde zil muafiyetsiz kalmıştı → güneş
       modunda durum çubuğunun başında BOŞ siyah kutu görünüyordu. */
    for (const f of ['TeslaLayout', 'HorizonLayout', 'ExpeditionLayout']) {
      const src = readFileSync(resolve(HERE, `../components/themes/${f}.tsx`), 'utf8');
      const bell = src.split(/\r?\n/).filter((l) => l.includes('<button') && l.includes("openDrawer('notifications')"));
      expect(bell.length, f).toBeGreaterThan(0);
      for (const l of bell) expect(l, f).toContain('className="caros-status-item');
    }
  });
  it('🔒 sahte şebeke çubukları geri gelmedi', () => {
    const src = readFileSync(resolve(HERE, '../components/common/StatusControls.tsx'), 'utf8');
    expect(src).not.toMatch(/showCellular/);
  });
});
