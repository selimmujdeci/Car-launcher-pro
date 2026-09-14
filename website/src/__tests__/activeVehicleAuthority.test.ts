/**
 * activeVehicleAuthority.test.ts — KUMANDA / ÇOKLU ARAÇ AKTİF ARAÇ OTORİTESİ.
 *
 * ── ÖNCEKİ DURUM (bu turda bulunan kusur) ────────────────────────────────────
 * `kumanda/page.tsx` aktif aracı `vehicles.find(online) ?? vehicles[0] ?? null`
 * ile seçiyordu. Kullanıcının birden fazla eşleştirilmiş aracı (Doblo, Megane)
 * aynı anda ONLINE olduğunda EKRAN HİÇBİR SEÇİM SUNMUYOR, sessizce "ilk online
 * / ilk" araca kilitleniyordu — komutlar (Kilitle/Aç/Korna/Alarm/Navigasyon)
 * kullanıcının GÖRMEDİĞİ bir araca gidiyordu.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  · `activeVehicleId`, `vehicles` (eşleştirilmiş + online liste) TEK OTORİTE
 *    olarak `vehicleStore`da tutulur — ikinci bir "selected vehicle" store'u
 *    kurulmaz.
 *  · `getActiveVehicle()` FAIL CLOSED: tek araç dışında hiçbir zaman kendi
 *    kendine bir araca "düşmez" (ilk/online/last-connected fallback YOK).
 *  · `setActiveVehicleId` kullanıcının eşleştirilmiş listesinde olmayan bir
 *    id'yi sessizce reddeder (yanlış araca komut hedefi asla kurulamaz).
 *  · Aktif araç offline olsa da, başka bir araç online olduğu için otomatik
 *    ona geçilmez — yalnız kullanıcı açıkça seçince değişir.
 *  · `clearVehicleAuthority` (hesap/oturum temizliği) aktif araç seçimini de
 *    sıfırlar — bir sonraki hesap eski hesabın aktif aracını miras almaz.
 *  · `initializeFromLocal`, ikinci bir araç eşleştirildiğinde önceden yüklü
 *    diğer araçları SİLMEZ (spread fix — bu turda bulunan ayrı kusur).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useVehicleStore, ACTIVE_VEHICLE_STORAGE_KEY } from '@/store/vehicleStore';
import {
  activateAccountSecurityLockdown,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';
import type { LiveVehicle } from '@/types/realtime';

function vehicle(over: Partial<LiveVehicle> & { id: string }): LiveVehicle {
  return {
    plate: '34 TEST', name: 'Araç', driver: '—', status: 'online',
    lat: 0, lng: 0, speed: 0, fuel: 0, engineTemp: 0, rpm: 0,
    odometer: 0, location: '—', lastSeen: '—', lastTimestamp: 0,
    ...over,
  };
}

/** Bir sonraki "uygulama açılışı"nı taklit eder: bellek-içi Zustand state
 * sıfırlanır (fresh module init davranışı) ama localStorage AYNEN KALIR —
 * gerçek reload'da persisted hint hayatta kalan tek şeydir. */
function simulateFreshAppLoad() {
  useVehicleStore.setState({
    vehicles: {}, connectionStatus: 'disconnected', loading: false,
    error: null, activeVehicleId: null,
  });
}

beforeEach(() => {
  resetAccountSecurityLockdownForTests();
  window.localStorage.removeItem(ACTIVE_VEHICLE_STORAGE_KEY);
  simulateFreshAppLoad();
});

afterEach(() => {
  window.localStorage.removeItem(ACTIVE_VEHICLE_STORAGE_KEY);
});

describe('canonical active vehicle — tek otorite', () => {
  it('senaryo 1: tek eşleştirilmiş araç otomatik aktiftir', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo', status: 'online' })]);
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');
  });

  it('senaryo 2-3: iki araç ONLINE, açık seçim yalnız işaretli araca uygulanır', () => {
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'doblo', status: 'online' }),
      vehicle({ id: 'megane', status: 'online' }),
    ]);
    // Seçim yapılmadan: belirsiz → FAIL CLOSED (ilk/online'a DÜŞMEZ).
    expect(useVehicleStore.getState().getActiveVehicle()).toBeNull();

    useVehicleStore.getState().setActiveVehicleId('doblo');
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');

    useVehicleStore.getState().setActiveVehicleId('megane');
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('megane');
  });

  it('senaryo 4: aktif araç OFFLINE olunca başka ONLINE araca otomatik geçilmez', () => {
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'doblo', status: 'offline' }),
      vehicle({ id: 'megane', status: 'online' }),
    ]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');

    // Megane online olsa da kullanıcı seçmeden aktif değişmez.
    useVehicleStore.getState().applyUpdate({
      vehicleId: 'megane', lat: 1, lng: 1, speed: 10, fuel: 50,
      engineTemp: 80, rpm: 1500, timestamp: Date.now(),
    });
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');
  });

  it('senaryo 6: geçersiz/erişimsiz vehicleId aktif yapılamaz (fail closed)', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    useVehicleStore.getState().setActiveVehicleId('doblo');

    useVehicleStore.getState().setActiveVehicleId('baskasinin-araci');
    // Reddedildi — mevcut seçim KORUNUR, hayalet araç asla aktif olmaz.
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');
  });

  it('senaryo: aktif araç kaldırılınca ve 2+ araç kalınca yeniden belirsizleşir', () => {
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'doblo' }), vehicle({ id: 'megane' }), vehicle({ id: 'clio' }),
    ]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    useVehicleStore.getState().removeVehicle('doblo');
    // Doblo gitti, iki araç kaldı, hiçbiri açıkça seçilmedi → belirsiz.
    expect(useVehicleStore.getState().getActiveVehicle()).toBeNull();
  });

  it('senaryo: aktif araç kaldırılınca ve tek araç kalınca otomatik ona düşer', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    useVehicleStore.getState().removeVehicle('doblo');
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('megane');
  });

  it('senaryo 7: hesap kilidi altında setActiveVehicleId sessizce reddedilir', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    activateAccountSecurityLockdown('cleanup-active-vehicle', 'logout', 10);

    useVehicleStore.getState().setActiveVehicleId('megane');
    expect(useVehicleStore.getState().activeVehicleId).toBe('doblo');
  });

  it('clearVehicleAuthority aktif araç seçimini de sıfırlar', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' })]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    useVehicleStore.getState().clearVehicleAuthority();

    expect(useVehicleStore.getState().activeVehicleId).toBeNull();
    expect(useVehicleStore.getState().isVehicleAuthorityEmpty()).toBe(true);
  });
});

describe('persistence — reload / account isolation / fail-closed restore', () => {
  it('1. seçilen activeVehicle persist edilir', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    useVehicleStore.getState().setActiveVehicleId('megane');
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBe('megane');
  });

  it('2. reload sonrası geçerli vehicle restore edilir', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    useVehicleStore.getState().setActiveVehicleId('megane');

    simulateFreshAppLoad(); // uygulama kapanıp açıldı — bellek sıfırlandı
    expect(useVehicleStore.getState().activeVehicleId).toBeNull(); // memory'de YOK

    // Araçlar yeniden yüklenir (Supabase/local bootstrap) — persisted hint
    // güncel listeye karşı doğrulanıp restore edilir.
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('megane');
  });

  it('3. persisted ID paired listede değilse restore edilmez (FAIL CLOSED)', () => {
    window.localStorage.setItem(ACTIVE_VEHICLE_STORAGE_KEY, 'eski-hesabin-araci');
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    expect(useVehicleStore.getState().getActiveVehicle()).toBeNull();
  });

  it('4. persisted vehicle OFFLINE olsa bile seçim korunur', () => {
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'doblo', status: 'offline' }),
      vehicle({ id: 'megane', status: 'online' }),
    ]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    simulateFreshAppLoad();
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'doblo', status: 'offline' }),
      vehicle({ id: 'megane', status: 'online' }),
    ]);
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');
  });

  it('5. persisted araç offline iken başka ONLINE araca otomatik geçilmez', () => {
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'doblo', status: 'offline' }),
      vehicle({ id: 'megane', status: 'online' }),
    ]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    simulateFreshAppLoad();
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'doblo', status: 'offline' }),
      vehicle({ id: 'megane', status: 'online' }),
    ]);
    useVehicleStore.getState().applyUpdate({
      vehicleId: 'megane', lat: 1, lng: 1, speed: 10, fuel: 50,
      engineTemp: 80, rpm: 1500, timestamp: Date.now(),
    });
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');
  });

  it('6. logout bellekteki activeVehicleId değerini temizler', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' })]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    useVehicleStore.getState().clearVehicleAuthority();
    expect(useVehicleStore.getState().activeVehicleId).toBeNull();
  });

  it('7. logout persisted activeVehicleId\'yi de temizler', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' })]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBe('doblo');

    useVehicleStore.getState().clearVehicleAuthority();
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBeNull();
  });

  it('8. account A\'nın seçimi account B\'ye sızmaz', () => {
    // Account A: Megane'i seçti.
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'a-doblo' }), vehicle({ id: 'a-megane' }),
    ]);
    useVehicleStore.getState().setActiveVehicleId('a-megane');

    // Logout → yeni hesap login (account B, tamamen farklı araç id'leri).
    useVehicleStore.getState().clearVehicleAuthority();
    useVehicleStore.getState().setVehicles([
      vehicle({ id: 'b-clio' }), vehicle({ id: 'b-egea' }),
    ]);

    // A'nın eski id'si B'nin listesinde YOK → asla aktif olamaz; B için
    // hiçbir örtük seçim yapılmaz (fail closed, kullanıcı seçmeli).
    expect(useVehicleStore.getState().getActiveVehicle()).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBeNull();
  });

  it('9. unpair edilen active vehicle persistence\'tan invalidate edilir', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    useVehicleStore.getState().setActiveVehicleId('doblo');
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBe('doblo');

    useVehicleStore.getState().removeVehicle('doblo');
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBeNull();
  });

  it('10. 2+ araç + persistence yok → null (fail closed)', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBeNull();
    expect(useVehicleStore.getState().getActiveVehicle()).toBeNull();
  });

  it('11. tek araçta persistence gerekmeden doğal aktif davranış korunur', () => {
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' })]);
    expect(window.localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY)).toBeNull();
    expect(useVehicleStore.getState().getActiveVehicle()?.id).toBe('doblo');
  });

  it('12. malformed/corrupt storage değeri crash üretmez, fail closed davranır', () => {
    // Rastgele/bozuk bir değer — herhangi bir araç id'siyle eşleşmez.
    window.localStorage.setItem(ACTIVE_VEHICLE_STORAGE_KEY, '{"not":"a-vehicle-id"}');
    useVehicleStore.getState().setVehicles([vehicle({ id: 'doblo' }), vehicle({ id: 'megane' })]);
    expect(() => useVehicleStore.getState().getActiveVehicle()).not.toThrow();
    expect(useVehicleStore.getState().getActiveVehicle()).toBeNull();
  });
});

describe('initializeFromLocal — çoklu araç spread kusuru (bu turda bulundu)', () => {
  afterEach(() => {
    ['caros_pair_vehicle_id', 'caros_pair_api_key', 'caros_pair_vehicle_name', 'caros_pair_vehicle_plate']
      .forEach((k) => window.localStorage.removeItem(k));
  });

  it('ikinci aracı eşleştirince önceden yüklü ilk aracı SİLMEZ', () => {
    // Supabase'ten zaten yüklenmiş bir araç var (Megane) — `handlePaired`
    // sırasında `initializeFromSupabase()` tamamlanmadan önceki an budur.
    useVehicleStore.getState().setVehicles([vehicle({ id: 'megane', plate: '34 MEG' })]);

    // Kullanıcı ikinci aracı (Doblo) az önce eşleştirdi — kanonik pairing
    // rotası `storeLocalVehicle` ile tekil yerel kaydı BUNA günceller.
    window.localStorage.setItem('caros_pair_vehicle_id', 'doblo');
    window.localStorage.setItem('caros_pair_vehicle_name', 'Doblo');
    window.localStorage.setItem('caros_pair_vehicle_plate', '34 DOB');

    useVehicleStore.getState().initializeFromLocal();

    // ÖNCEDEN: `vehicles: { doblo: ... }` state'in TAMAMINI değiştiriyordu →
    // Megane anlık olarak listeden düşüyordu. Artık ikisi de listede kalır.
    const ids = useVehicleStore.getState().getList().map((v) => v.id).sort();
    expect(ids).toEqual(['doblo', 'megane']);
  });
});
