/**
 * vehicleComfortIntents — Mavi'nin CAN konfor komutu / araç durumu sorusu ayrıştırıcısı.
 * Örnek cümleler kullanıcının kendi istekleridir (2026-10-02).
 */
import { describe, it, expect } from 'vitest';
import {
  tryParseVehicleComfort, tryParseCanVehicleInfo, encodeComfortCommand, decodeComfortCommand,
} from '../platform/vehicleComfortIntents';
import { parseCommandFull } from '../platform/commandParser';

describe('konfor komutu', () => {
  it('kullanıcı örnekleri', () => {
    expect(tryParseVehicleComfort('Koltuk masajını aç')).toEqual({ target: 'massage', power: 'on' });
    expect(tryParseVehicleComfort('İç ambiyansları mavi yap, şiddetini arttır'))
      .toEqual({ target: 'ambient', color: 2, level: '+' });
  });

  it('masaj: kapat · şiddet · mod · yolcu · hız', () => {
    expect(tryParseVehicleComfort('masajı kapat')).toEqual({ target: 'massage', power: 'off' });
    expect(tryParseVehicleComfort('masajın şiddetini azalt')).toEqual({ target: 'massage', level: '-' });
    expect(tryParseVehicleComfort('masaj şiddetini 3 yap')).toEqual({ target: 'massage', level: 3 });
    expect(tryParseVehicleComfort('masajı en yüksek yap')).toEqual({ target: 'massage', level: 'max' });
    expect(tryParseVehicleComfort('masajı tonik moda al')).toEqual({ target: 'massage', mode: 2 });
    expect(tryParseVehicleComfort('masaj modunu değiştir')).toEqual({ target: 'massage', mode: 'next' });
    expect(tryParseVehicleComfort('yolcu masajını aç')).toEqual({ target: 'massage', power: 'on', zone: 'passenger' });
    expect(tryParseVehicleComfort('masaj hızını artır')).toEqual({ target: 'massage', unavailable: 'massage_speed' });
    expect(tryParseVehicleComfort('masajı açar mısın')).toEqual({ target: 'massage', power: 'on' });
  });

  it('ambiyans: aç/kapat · bölge · renk · parlaklık', () => {
    expect(tryParseVehicleComfort('ambiyansı kapat')).toEqual({ target: 'ambient', power: 'off' });
    expect(tryParseVehicleComfort('ön ambiyansı aç')).toEqual({ target: 'ambient', power: 'on', zone: 'front' });
    expect(tryParseVehicleComfort('arka ambiyansı kapat')).toEqual({ target: 'ambient', power: 'off', zone: 'rear' });
    expect(tryParseVehicleComfort('ambiyansı kırmızıya çevir')).toEqual({ target: 'ambient', color: 1 });
    expect(tryParseVehicleComfort('ambiyansı açık mavi yap')).toEqual({ target: 'ambient', color: 7 });
    expect(tryParseVehicleComfort('ambiyans parlaklığını yüzde 70 yap')).toEqual({ target: 'ambient', level: 70 });
    expect(tryParseVehicleComfort('ambiyansı biraz kıs')).toEqual({ target: 'ambient', level: '-' });
    expect(tryParseVehicleComfort('ambiyansı sarı yap')).toEqual({ target: 'ambient', unavailable: 'color', colorName: 'sari' });
  });

  it('baştaki "Mavi" hitabı renk sanılmaz', () => {
    expect(tryParseVehicleComfort('Mavi ambiyansı kırmızı yap')).toEqual({ target: 'ambient', color: 1 });
    expect(tryParseVehicleComfort('Mavi ambiyansı aç')).toEqual({ target: 'ambient', power: 'on' });
  });

  it('komut OLMAYAN cümleler → null', () => {
    expect(tryParseVehicleComfort('masajı kapatma')).toBeNull();                       // olumsuz emir
    expect(tryParseVehicleComfort('yarın masajı açmayı hatırla')).toBeNull();          // hafıza
    expect(tryParseVehicleComfort('ambiyans kırmızı mı')).toBeNull();                  // soru
    expect(tryParseVehicleComfort('yakında masaj salonu var mı')).toBeNull();
    expect(tryParseVehicleComfort('masajı aç ve ambiyansı kırmızı yap')).toBeNull();   // iki hedef → zincir yolu
    expect(tryParseVehicleComfort('ekran parlaklığını artır')).toBeNull();
  });

  it('taşıma: kodla → çöz birebir; bozuk girdi reddedilir', () => {
    const c = { target: 'ambient', color: 2, level: '+' } as const;
    expect(decodeComfortCommand(encodeComfortCommand(c))).toEqual(c);
    expect(decodeComfortCommand('{"target":"engine","power":"on"}')).toBeNull();
    expect(decodeComfortCommand('{"target":"ambient","color":9}')).toEqual({ target: 'ambient' });
    expect(decodeComfortCommand('bozuk')).toBeNull();
  });
});

describe('araç durumu sorusu', () => {
  it('konular', () => {
    expect(tryParseCanVehicleInfo('Hey Mavi lastik basınçlarını kontrol et')).toBe('tires');
    expect(tryParseCanVehicleInfo('lastikler nasıl')).toBe('tires');
    expect(tryParseCanVehicleInfo('lastik basıncını sıfırla')).toBe('tires_reset');
    expect(tryParseCanVehicleInfo('ortalama yakıt tüketimi ne kadar')).toBe('trip');
    expect(tryParseCanVehicleInfo('kapılar açık mı')).toBe('doors');
    expect(tryParseCanVehicleInfo('bagaj açık mı')).toBe('doors');
    expect(tryParseCanVehicleInfo('klima kaç derece')).toBe('climate');
    expect(tryParseCanVehicleInfo('masaj açık mı')).toBe('massage');
    expect(tryParseCanVehicleInfo('ambiyans ne renk')).toBe('ambient');
  });

  it('komut biçimi soru sayılmaz', () => {
    expect(tryParseCanVehicleInfo('klimayı aç')).toBeNull();
    expect(tryParseCanVehicleInfo('yol bilgisayarını aç')).toBeNull();
    expect(tryParseCanVehicleInfo('kapıları kilitle')).toBeNull();
    expect(tryParseCanVehicleInfo('lastik nasıl değiştirilir')).toBeNull();
  });
});

describe('commandParser bağlantısı', () => {
  it('konfor komutu ve soru tam güvenle (1.0) yerel komut olur', () => {
    const a = parseCommandFull('koltuk masajını aç').command!;
    expect(a.type).toBe('vehicle_comfort');
    expect(a.confidence).toBe(1);
    expect(decodeComfortCommand(a.extra?.comfort)).toEqual({ target: 'massage', power: 'on' });
    const b = parseCommandFull('lastik basınçlarını kontrol et').command!;
    expect(b.type).toBe('vehicle_can_info');
    expect(b.extra?.topic).toBe('tires');
  });

  it('ambiyans parlaklığı EKRAN parlaklığı ayarına düşmez; ekran parlaklığı eskisi gibi', () => {
    expect(parseCommandFull('ambiyansın parlaklığını artır').command?.type).toBe('vehicle_comfort');
    expect(parseCommandFull('ekran parlaklığını artır').command?.type).not.toBe('vehicle_comfort');
  });

  it('korunan donanım komutu önceliğini korur', () => {
    expect(parseCommandFull('kapıları kilitle').command?.type).toBe('hw_lock_doors');
  });
});
