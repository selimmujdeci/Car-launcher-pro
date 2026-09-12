/**
 * fleetVehicleAccessRolesUi.test.tsx — "ARAÇ ERİŞİM ROLLERİ" KARTI KİLİTLERİ.
 *
 * Bu kart kullanıcının rol seçerken baktığı TEK açıklamadır. Elle yazılmış bir
 * liste olsaydı `roles.ts` matrisi değişince sessizce YALAN söylemeye başlardı.
 * Buradaki kilitler tam olarak bunu engeller: kart matristen TÜRETİLİR.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { VehicleAccessRolesCard } from '@/components/fleet/FleetUi';
import {
  ASSIGNABLE_ROLES, CAPABILITIES, capabilitiesOf, can,
  type FleetRole,
} from '@/lib/fleet/roles';

/** Kartta yalnız araç yetkileri gösterilir. */
const VEHICLE_CAPS = CAPABILITIES.filter((c) => c.startsWith('vehicle.'));

function render(roles: readonly string[] = ASSIGNABLE_ROLES) {
  return renderToStaticMarkup(
    <VehicleAccessRolesCard roles={roles} capabilitiesOf={capabilitiesOf} />,
  );
}

/** Bir rol bloğunun HTML'ini ayıklar (roller sırayla çizilir). */
function blockFor(html: string, role: FleetRole): string {
  const blocks = html.split('<div class="rounded-xl border border-white/10 bg-black/20 p-4">');
  const index  = ASSIGNABLE_ROLES.indexOf(role as never) + 1;
  return blocks[index] ?? '';
}

describe('Araç erişim rolleri kartı', () => {

  it('1. atanabilir rollerin HEPSİ gösterilir', () => {
    const html = render();
    expect(html).toContain('Araç erişim rolleri');
    expect(html).toContain('Gözlemci');
    expect(html).toContain('Filo üyesi');
    expect(html).toContain('Filo yöneticisi');
  });

  it('2. her araç yetkisi kartta bir satır olarak yer alır', () => {
    const html = render(['admin']);
    // Admin tüm araç yetkilerine sahip → hepsi ✓ ile görünmeli.
    expect(VEHICLE_CAPS.length).toBe(7);
    const ticks = (html.match(/✓/g) ?? []).length;
    expect(ticks).toBe(VEHICLE_CAPS.length);
  });

  it('3. 🔒 kart MATRİSTEN türetilir — sahip olunmayan yetki ✓ ile gösterilmez', () => {
    const html = render();
    for (const role of ASSIGNABLE_ROLES) {
      const block   = blockFor(html, role);
      const granted = VEHICLE_CAPS.filter((c) => can(role, c)).length;
      const denied  = VEHICLE_CAPS.length - granted;

      expect((block.match(/✓/g) ?? []).length).toBe(granted);
      expect((block.match(/✕/g) ?? []).length).toBe(denied);
    }
  });

  it('4. 🔒 GÖZLEMCİ hiçbir yazma yetkisiyle gösterilmez', () => {
    const block = blockFor(render(), 'observer');

    // Yazma yetkileri üstü çizili (line-through) olmalı.
    for (const label of [
      'Araca komut gönderebilir',
      'Araç ayarlarını değiştirebilir',
      'Filoya araç ekleyebilir',
      'Filodan araç çıkarabilir',
    ]) {
      const row = block.split('<li').find((s) => s.includes(label)) ?? '';
      expect(row).toContain('line-through');
      expect(row).toContain('✕');
    }
  });

  it('5. ÜYE komut gönderebilir ama filo yapısına dokunamaz', () => {
    const block = blockFor(render(), 'member');
    const rowOf = (label: string) => block.split('<li').find((s) => s.includes(label)) ?? '';

    expect(rowOf('Araca komut gönderebilir')).toContain('✓');
    expect(rowOf('Filoya araç ekleyebilir')).toContain('✕');
    expect(rowOf('Filodan araç çıkarabilir')).toContain('✕');
  });

  it('6. 🔒 kart hiçbir DÜĞME içermez — salt bilgilendirmedir', () => {
    const html = render();
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<form');
  });

  it('7. 🔒 makine yetki adları kullanıcıya SIZMAZ', () => {
    const html = render();
    for (const capability of VEHICLE_CAPS) {
      expect(html).not.toContain(capability);
    }
  });
});
