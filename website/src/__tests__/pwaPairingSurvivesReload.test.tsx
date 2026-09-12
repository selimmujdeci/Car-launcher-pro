/**
 * #648 — SAYFA YENİLENİNCE EŞLEŞTİRME DÜŞÜYORDU (regresyon kilidi).
 *
 * Kusur: `useRealtime` yetki kapısını (`REALTIME_SUBSCRIBE`) hesap-temizlik
 * runtime'ı BAŞLATILMADAN soruyordu. Runtime'ı başlatan çağrı da aynı efektin
 * içindeydi → taze yüklemede kapı KESİN kapalı → `initializeFromLocal()` hiç
 * çalışmıyor, `localStorage`daki eşleşmiş araç ekrana GELMİYOR, `loading`
 * sonsuza dek `true` kalıyordu.
 *
 * Bu kilit iki şeyi birden ölçer: (a) yerel araç store'a giriyor mu,
 * (b) `loading` düşüyor mu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/lib/vehicles.service', () => ({ fetchVehicles: vi.fn(async () => []) }));

describe('#648 PWA yenilemesinde eşleştirme kalıcılığı', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('caros_pair_vehicle_id',    'veh-648');
    localStorage.setItem('caros_pair_vehicle_name',  'Duster');
    localStorage.setItem('caros_pair_vehicle_plate', '33 ABC 33');
  });

  it('taze yüklemede yerel araç yüklenir ve loading düşer', async () => {
    const { useRealtime }     = await import('@/hooks/useRealtime');
    const { useVehicleStore } = await import('@/store/vehicleStore');

    function Sonda() { useRealtime(); return null; }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => { root.render(createElement(Sonda)); });
    // runtime.initialize() mikro-görev zincirinin tamamlanmasını bekle
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const s = useVehicleStore.getState();
    expect(Object.keys(s.vehicles)).toEqual(['veh-648']);
    expect(s.loading).toBe(false);

    await act(async () => { root.unmount(); });
    host.remove();
  });
});
