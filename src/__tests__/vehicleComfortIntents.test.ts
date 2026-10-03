/**
 * vehicleComfortIntents — Mavi'nin CAN konfor komutu / araç durumu sorusu ayrıştırıcısı.
 * Örnek cümleler kullanıcının kendi istekleridir (2026-10-02).
 */
import { describe, it, expect } from 'vitest';
import {
  tryParseVehicleComfort, tryParseVehicleComforts, tryParseCanVehicleInfo,
  encodeComfortCommands, decodeComfortCommands,
} from '../platform/vehicleComfortIntents';
import { parseCommandFull, buildCommandGrammar, buildCommandGrammarFor } from '../platform/commandParser';
import { AMBIENT_COLOR_NAMES, MASSAGE_MODE_NAMES } from '../platform/vehicleDataLayer/raiseRenaultFrames';
import { VEHICLE_TYPES } from '../platform/voice/contextGrammarModel';

describe('konfor komutu', () => {
  it('kullanıcı örnekleri', () => {
    expect(tryParseVehicleComfort('Koltuk masajını aç')).toEqual({ target: 'massage', power: 'on' });
    expect(tryParseVehicleComfort('İç ambiyansları mavi yap, şiddetini arttır'))
      .toEqual({ target: 'ambient', color: 3, level: '+' });
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
    expect(tryParseVehicleComfort('ambiyansı kırmızıya çevir')).toEqual({ target: 'ambient', color: 2 });
    expect(tryParseVehicleComfort('ambiyansı açık mavi yap')).toEqual({ target: 'ambient', color: 6 });
    expect(tryParseVehicleComfort('ambiyans parlaklığını yüzde 70 yap')).toEqual({ target: 'ambient', level: 70 });
    expect(tryParseVehicleComfort('ambiyansı biraz kıs')).toEqual({ target: 'ambient', level: '-' });
    expect(tryParseVehicleComfort('ambiyansı sarı yap')).toEqual({ target: 'ambient', color: 7 });   // Renault listesinde VAR
    expect(tryParseVehicleComfort('ambiyansı pembe yap')).toEqual({ target: 'ambient', unavailable: 'color', colorName: 'pembe' });
  });

  it('baştaki "Mavi" hitabı renk sanılmaz', () => {
    expect(tryParseVehicleComfort('Mavi ambiyansı kırmızı yap')).toEqual({ target: 'ambient', color: 2 });
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
    const list = [{ target: 'ambient', color: 3, level: '+' }, { target: 'massage', power: 'on' }] as const;
    expect(decodeComfortCommands(encodeComfortCommands(list))).toEqual(list);
    expect(decodeComfortCommands('{"target":"massage","power":"on"}')).toEqual([{ target: 'massage', power: 'on' }]);
    expect(decodeComfortCommands('[{"target":"engine","power":"on"}]')).toBeNull();
    expect(decodeComfortCommands('[{"target":"ambient","color":9}]')).toEqual([{ target: 'ambient' }]);
    expect(decodeComfortCommands('[]')).toBeNull();
    expect(decodeComfortCommands('bozuk')).toBeNull();
  });
});

describe('"… ve …" konfor cümleleri (zincire bölünmez)', () => {
  it('iki hedef → iki komut', () => {
    expect(tryParseVehicleComforts('Masajı aç ve ambiyansı mavi yap')).toEqual([
      { target: 'massage', power: 'on' }, { target: 'ambient', color: 3 },
    ]);
  });

  it('hedefsiz devam cümleciği önceki hedefi devralır ve birleşir', () => {
    expect(tryParseVehicleComforts('masajı aç ve şiddetini artır'))
      .toEqual([{ target: 'massage', power: 'on', level: '+' }]);
    expect(tryParseVehicleComforts('iç ambiyansları mavi yap ve parlaklığını artır'))
      .toEqual([{ target: 'ambient', color: 3, level: '+' }]);
    expect(tryParseVehicleComforts('ambiyansı aç ve mavi yap'))
      .toEqual([{ target: 'ambient', power: 'on', color: 3 }]);
  });

  it('konfor DIŞI cümlecik varsa null → zincir yolu (müzik kaybolmaz)', () => {
    expect(tryParseVehicleComforts('masajı aç ve müziği aç')).toBeNull();
    expect(tryParseVehicleComforts('ambiyansı mavi yap ve ekran parlaklığını artır')).toBeNull();
    expect(tryParseVehicleComforts('müziği aç ve masajı aç')).toBeNull();
  });

  it('ön ve arka birlikte → bölge yok (tümü)', () => {
    expect(tryParseVehicleComfort('ön ve arka ambiyansı aç')).toEqual({ target: 'ambient', power: 'on' });
  });

  it('commandParser: devam cümleciği ses/ekran komutuna DÜŞMEZ', () => {
    const a = parseCommandFull('masajı aç ve şiddetini artır').command!;
    expect(a.type).toBe('vehicle_comfort');
    expect(decodeComfortCommands(a.extra?.comfort)).toEqual([{ target: 'massage', power: 'on', level: '+' }]);
    const b = parseCommandFull('masajı aç ve ambiyansı mavi yap').command!;
    expect(decodeComfortCommands(b.extra?.comfort)).toHaveLength(2);
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
    expect(decodeComfortCommands(a.extra?.comfort)).toEqual([{ target: 'massage', power: 'on' }]);
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

describe('sözlük tek kaynaktan (kod çözücünün adları)', () => {
  it('kod çözücünün HER renk adı ayrıştırıcıda kendi numarasına çözülür', () => {
    AMBIENT_COLOR_NAMES.forEach((name, i) => {
      expect(tryParseVehicleComfort(`ambiyansı ${name} yap`), name).toEqual({ target: 'ambient', color: i });
    });
  });

  it('her masaj modu adı kendi numarasına çözülür', () => {
    MASSAGE_MODE_NAMES.forEach((name, i) => {
      expect(tryParseVehicleComfort(`masajı ${name} moda al`)?.mode, name).toBe(i);
    });
  });

  it('internetsiz sözlükler konfor sözcüklerini taşır (genel + araç bağlamı)', () => {
    const general = buildCommandGrammar();
    const vehicle = buildCommandGrammarFor(VEHICLE_TYPES);
    for (const w of ['masaj', 'ambiyans', 'lastik basıncı', 'mavi', 'tonik']) {
      expect(general, w).toContain(w);
      expect(vehicle, w).toContain(w);
    }
    expect(general[general.length - 1]).toBe('[unk]');
  });
});

describe('Multi-Sense sürüş modu (saha 2026-10-03)', () => {
  it.each([
    ['spor modunu aç', 'drive_mode_set'],
    ['Mavi eko moduna geç', 'drive_mode_set'],
    ['konfor moduna al', 'drive_mode_set'],
    ['ekonomik modu aç', 'drive_mode_set'],
    ['hangi moddayım', 'drive_mode'],
    ['araç hangi sürüş modunda', 'drive_mode'],
    ['spor modunda mıyım', 'drive_mode'],
  ])('"%s" → %s', (t, topic) => { expect(tryParseCanVehicleInfo(t)).toBe(topic); });

  it('uygulama komutları ve masaj modu gasp edilmez', () => {
    expect(tryParseCanVehicleInfo('sürüş moduna geç')).toBeNull();      // CarOS sürüş arayüzü
    expect(tryParseCanVehicleInfo('masajı bel moduna al')).toBeNull();
    expect(tryParseCanVehicleInfo('eko puanım kaç')).toBeNull();
  });
});
