/**
 * #661 KİLİTLERİ — araç kimliği · harita kadrajı · konum kartı.
 *
 * Kilitlenen saha kusurları:
 *  1. Plaka boşken ARAÇ UUID'si plaka diye gösteriliyordu
 *     (`5758b3dd-d210-4799-a565-0ff3f968e5af`).
 *  2. Araca isim/plaka verecek HİÇBİR yazma ucu yoktu.
 *  3. Ters coğrafi çözümleme başarısızlığında adres UYDURULMAMALI.
 *
 * Bu kilitler ZAYIFLATILMAZ; davranış bilinçli değişirse kilit GÜNCELLENİR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isUuidLike,
  vehicleTitle,
  vehicleSubtitle,
  vehicleShortId,
  hasVehicleIdentity,
  isFallbackTitle,
  formatCoords,
  validateIdentityPatch,
} from '@/lib/vehicleDisplay';
import { formatNominatimAddress, resetReverseGeocodeCache } from '@/lib/reverseGeocode';

const UUID = '5758b3dd-d210-4799-a565-0ff3f968e5af';

describe('#661 · araç kimliği tek otorite', () => {
  it('UUID ASLA plaka/başlık olarak gösterilmez', () => {
    expect(isUuidLike(UUID)).toBe(true);
    const title = vehicleTitle({ id: UUID, plate: UUID, name: null });
    expect(title).not.toContain(UUID);
    expect(title).toBe('Araç #5758b3dd');
  });

  it('kimlik yoksa başlık "Araç #kısaid" olur ve yedek olarak işaretlenir', () => {
    const v = { id: UUID, plate: '', name: '' };
    expect(vehicleTitle(v)).toBe('Araç #5758b3dd');
    expect(hasVehicleIdentity(v)).toBe(false);
    expect(isFallbackTitle(v)).toBe(true);
    expect(vehicleSubtitle(v)).toBeNull();
  });

  it('eşleştirme yer tutucuları ("—", "Araç") kimlik sayılmaz', () => {
    expect(hasVehicleIdentity({ id: UUID, plate: '—', name: 'Araç' })).toBe(false);
    expect(vehicleTitle({ id: UUID, plate: '—', name: 'Araç' })).toBe('Araç #5758b3dd');
  });

  it('plaka varsa başlık plakadır, isim alt satıra düşer', () => {
    const v = { id: UUID, plate: '06 ABC 123', name: 'Servis Aracı' };
    expect(vehicleTitle(v)).toBe('06 ABC 123');
    expect(vehicleSubtitle(v)).toBe('Servis Aracı');
    expect(isFallbackTitle(v)).toBe(false);
  });

  it('yalnız isim varsa başlık isimdir, alt satırda kısa kimlik durur', () => {
    const v = { id: UUID, plate: null, name: 'Servis Aracı' };
    expect(vehicleTitle(v)).toBe('Servis Aracı');
    expect(vehicleSubtitle(v)).toBe('#5758b3dd');
  });

  it('kısa kimlik 8 haneyi aşmaz', () => {
    expect(vehicleShortId(UUID)).toBe('#5758b3dd');
  });
});

describe('#661 · kimlik yazma doğrulaması', () => {
  it('her iki alan da boşsa yazma REDDEDİLİR', () => {
    const r = validateIdentityPatch({ plate: '  ', name: '' });
    expect(r.ok).toBe(false);
  });

  it('kimlik alanına UUID yazılamaz', () => {
    const r = validateIdentityPatch({ plate: UUID });
    expect(r.ok).toBe(false);
  });

  it('boş bırakılan alan null olur (silme), dolu alan kırpılır', () => {
    const r = validateIdentityPatch({ plate: '  06 ABC 123 ', name: '', driver: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.plate).toBe('06 ABC 123');
    expect(r.patch.name).toBeNull();
    expect(r.patch.driver_name).toBeNull();
  });

  it('aşırı uzun değer reddedilir', () => {
    expect(validateIdentityPatch({ plate: 'X'.repeat(17) }).ok).toBe(false);
    expect(validateIdentityPatch({ name: 'X'.repeat(41) }).ok).toBe(false);
  });
});

describe('#661 · konum gösterimi kanıta bağlı', () => {
  beforeEach(() => resetReverseGeocodeCache());

  it('koordinat sabit 5 haneyle yazılır (uydurma hassasiyet yok)', () => {
    expect(formatCoords(39.9207734, 32.8540123)).toBe('39.92077, 32.85401');
  });

  it('adres çözümlenemezse null döner — uydurma adres ÜRETİLMEZ', () => {
    expect(formatNominatimAddress(null)).toBeNull();
    expect(formatNominatimAddress({})).toBeNull();
    expect(formatNominatimAddress({ address: {} })).toBeNull();
  });

  it('adres yol + yerleşim olarak kısaltılır', () => {
    expect(
      formatNominatimAddress({ address: { road: 'Atatürk Bulvarı', city: 'Ankara', state: 'İç Anadolu' } }),
    ).toBe('Atatürk Bulvarı, Ankara');
  });

  it('yapısal alan yoksa display_name ilk iki parçaya iner', () => {
    expect(
      formatNominatimAddress({ display_name: 'Atatürk Bulvarı, Çankaya, Ankara, Türkiye' }),
    ).toBe('Atatürk Bulvarı, Çankaya');
  });
});
