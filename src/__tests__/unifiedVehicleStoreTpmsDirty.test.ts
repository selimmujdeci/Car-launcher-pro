/**
 * unifiedVehicleStoreTpmsDirty.test.ts — K24 perf düzeltmesi (Fix 4 devamı).
 *
 * KAPSAM: UnifiedVehicleStore.updateCanExtras — TPMS (canTpmsKpa) dirty-tracking.
 *
 * NEDEN: updateCanExtras'taki DİĞER TÜM alanlar (chk/chkBool) önce mevcut
 * değerle kıyaslanıp GERÇEKTEN değiştiyse dirty=true set ediyor. TPMS ise
 * istisnaydı: patch.tpms her CAN frame'inde YENİ bir tuple referansıyla
 * geldiğinden (JSON parse/map'ten üretilir), eski kod hiç kıyaslama yapmadan
 * koşulsuz dirty=true set ediyordu → her TPMS frame'inde set() çağrılıyor,
 * store'a subscribe olan HER ŞEY gereksiz yere uyanıyordu.
 *
 * chkTpms artık diğer alanlarla AYNI paternde: 4 tekerlek değeri de
 * (fl/fr/rl/rr) öncekiyle birebir aynıysa dirty tetiklenmez.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

describe('UnifiedVehicleStore.updateCanExtras — TPMS dirty-tracking (K24 perf düzeltmesi devamı)', () => {

  beforeEach(() => {
    useUnifiedVehicleStore.getState().resetCanData();
  });

  it('ilk TPMS gelişinde (önceki değer null) dirty tetiklenir — set() çağrılır', () => {
    let notified = 0;
    const unsub = useUnifiedVehicleStore.subscribe(() => { notified++; });

    useUnifiedVehicleStore.getState().updateCanExtras({ tpms: [220, 221, 219, 218] });

    unsub();
    expect(notified).toBe(1);
    expect(useUnifiedVehicleStore.getState().canTpmsKpa).toEqual([220, 221, 219, 218]);
  });

  it('aynı TPMS değerleri (yeni dizi referansı, birebir aynı içerik) art arda gelirse set() TETİKLENMEZ', () => {
    const s = useUnifiedVehicleStore.getState();
    s.updateCanExtras({ tpms: [220, 221, 219, 218] }); // baseline

    let notified = 0;
    const unsub = useUnifiedVehicleStore.subscribe(() => { notified++; });

    // YENİ dizi referansı ama BİREBİR AYNI içerik (gerçek CAN akışında olduğu gibi)
    s.updateCanExtras({ tpms: [220, 221, 219, 218] });
    s.updateCanExtras({ tpms: [220, 221, 219, 218] });
    s.updateCanExtras({ tpms: [220, 221, 219, 218] });

    unsub();
    expect(notified).toBe(0); // dirty hiç tetiklenmedi → set() hiç çağrılmadı
  });

  it('TPMS elemanlarından biri (örn. rl) gerçekten değişirse set() TETİKLENİR', () => {
    const s = useUnifiedVehicleStore.getState();
    s.updateCanExtras({ tpms: [220, 221, 219, 218] }); // baseline

    let notified = 0;
    const unsub = useUnifiedVehicleStore.subscribe(() => { notified++; });

    s.updateCanExtras({ tpms: [220, 221, 205, 218] }); // rl 219 → 205

    unsub();
    expect(notified).toBe(1);
    expect(useUnifiedVehicleStore.getState().canTpmsKpa).toEqual([220, 221, 205, 218]);
  });

  it('diğer alanlar (rpm) değişirken TPMS aynı kalırsa yine tek set() (TPMS ekstra tetiklemez)', () => {
    const s = useUnifiedVehicleStore.getState();
    s.updateCanExtras({ tpms: [220, 221, 219, 218], rpm: 1500 }); // baseline

    let notified = 0;
    const unsub = useUnifiedVehicleStore.subscribe(() => { notified++; });

    // rpm değişti, tpms AYNI → tek dirty (rpm'den), tpms ekstra tetiklemez
    s.updateCanExtras({ tpms: [220, 221, 219, 218], rpm: 1600 });

    unsub();
    expect(notified).toBe(1);
    expect(useUnifiedVehicleStore.getState().canRpm).toBe(1600);
    expect(useUnifiedVehicleStore.getState().canTpmsKpa).toEqual([220, 221, 219, 218]);
  });

});
