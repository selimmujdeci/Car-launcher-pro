/**
 * entertainmentMotionBadge.test.tsx — Eğlence portalı park/hareket göstergesi.
 *
 * Regresyon (ekran taraması 2026-10-03): portal ham `obd.speed`'i okuyordu
 * (`isParked = obd.speed === 0`). OBD bağlı değilken hız 0 → başlıkta yeşil
 * "AKTİF" (park modu) — kanıtsız "araç duruyor" iddiası; ayrıca hız gösterimi
 * tek otoriteyi (`useDisplaySpeed`, kütük #417) atlıyordu.
 * Kural: hız bilinmiyorsa (null) ne "AKTİF" ne "HAREKET EDİYOR" gösterilir.
 *
 * Gerçek bileşen gerçek DOM'a basılır; yalnız veri kaynakları taklit edilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const src = vi.hoisted(() => ({ displaySpeed: null as number | null, obdSpeed: 0 }));

vi.mock('../hooks/useDisplaySpeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useDisplaySpeed')>()),
  useDisplaySpeed: () => src.displaySpeed,
}));
vi.mock('../platform/obdService', () => ({ useOBDState: () => ({ speed: src.obdSpeed }) }));
vi.mock('../platform/appLauncher', () => ({ openApp: () => undefined }));
vi.mock('../platform/breakReminderService', () => ({
  useBreakReminderState: () => ({
    enabled: false, intervalMin: 120, drivingStartedAt: null,
    drivingElapsedMin: 0, alertVisible: false, lastDismissedAt: null,
  }),
  enableBreakReminder: () => undefined,
  disableBreakReminder: () => undefined,
  setBreakInterval: () => undefined,
  dismissBreakAlert: () => undefined,
  updateBreakReminder: () => undefined,
}));

import { EntertainmentPortal } from '../components/entertainment/EntertainmentPortal';

let container: HTMLDivElement;
let root: Root;

async function render(displaySpeed: number | null, obdSpeed = 0): Promise<string> {
  src.displaySpeed = displaySpeed;
  src.obdSpeed = obdSpeed;
  await act(async () => { root.render(<EntertainmentPortal key={String(displaySpeed)} />); });
  return container.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Eğlence portalı — park/hareket göstergesi', () => {
  it('hız bilinmiyorken (OBD yok, hız 0 varsayılanı) "AKTİF" park iddiası YOK', async () => {
    const text = await render(null, 0);
    expect(text).not.toMatch(/AKTİF/);
    expect(text).not.toMatch(/HAREKET EDİYOR/);
  });

  it('kanonik hız 0 → park modu "AKTİF"', async () => {
    expect(await render(0)).toMatch(/AKTİF/);
  });

  it('kanonik hız 42 → "ARAÇ HAREKET EDİYOR — 42 KM/H" (ham OBD değil)', async () => {
    const text = await render(42, 0);
    expect(text).toMatch(/HAREKET EDİYOR — 42 KM\/H/i);
    expect(text).not.toMatch(/AKTİF/);
  });
});
