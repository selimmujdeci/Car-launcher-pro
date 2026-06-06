import { describe, it, expect } from 'vitest';
import { matchVoiceSetting } from '../platform/settingsVoice';
import { parseCommand } from '../platform/commandParser';

/**
 * Sesli ayar kontrolü — registry eşleştirmesi + parser entegrasyonu.
 * matchVoiceSetting saf fonksiyon; parseCommand ön-kontrol üzerinden set_setting üretir.
 */

describe('matchVoiceSetting — boolean', () => {
  it('performans modunu aç → performanceMode/on', () => {
    expect(matchVoiceSetting('performans modunu aç')).toMatchObject({ key: 'performanceMode', action: 'on' });
  });
  it('performans modunu kapat → off', () => {
    expect(matchVoiceSetting('performans modunu kapat')).toMatchObject({ key: 'performanceMode', action: 'off' });
  });
  it('smart engine kapat → smartContextEnabled/off', () => {
    expect(matchVoiceSetting('smart engine kapat')).toMatchObject({ key: 'smartContextEnabled', action: 'off' });
  });
  it('akıllı motoru aç → smartContextEnabled/on', () => {
    expect(matchVoiceSetting('akıllı motoru aç')).toMatchObject({ key: 'smartContextEnabled', action: 'on' });
  });
  it('çevrimdışı haritayı aç → offlineMap/on', () => {
    expect(matchVoiceSetting('çevrimdışı haritayı aç')).toMatchObject({ key: 'offlineMap', action: 'on' });
  });
});

describe('matchVoiceSetting — enum', () => {
  it('birimleri imperial yap → unitSystem/imperial', () => {
    expect(matchVoiceSetting('birimleri imperial yap')).toMatchObject({ key: 'unitSystem', action: 'set', value: 'imperial' });
  });
  it('birim sistemini metrik yap → metric', () => {
    expect(matchVoiceSetting('birim sistemini metrik yap')).toMatchObject({ key: 'unitSystem', value: 'metric' });
  });
  it('dili ingilizce yap → language/en', () => {
    expect(matchVoiceSetting('dili ingilizce yap')).toMatchObject({ key: 'language', value: 'en' });
  });
  it('varsayılan navigasyonu waze yap → defaultNav/waze', () => {
    expect(matchVoiceSetting('varsayılan navigasyonu waze yap')).toMatchObject({ key: 'defaultNav', value: 'waze' });
  });
});

describe('matchVoiceSetting — number', () => {
  it('parlaklığı azalt → brightness/dec', () => {
    expect(matchVoiceSetting('parlaklığı azalt')).toMatchObject({ key: 'brightness', action: 'dec' });
  });
  it('parlaklığı artır → brightness/inc', () => {
    expect(matchVoiceSetting('parlaklığı artır')).toMatchObject({ key: 'brightness', action: 'inc' });
  });
  it('parlaklığı %50 yap → brightness/set/50', () => {
    expect(matchVoiceSetting('parlaklığı %50 yap')).toMatchObject({ key: 'brightness', action: 'set', value: 50 });
  });
  it('volume inc/dec registry üstlenmez (mevcut volume_up/down korunur)', () => {
    expect(matchVoiceSetting('ses seviyesini artır')).toBeNull();
  });
});

describe('matchVoiceSetting — native & openTab', () => {
  it('wifi aç → wifi/on', () => {
    expect(matchVoiceSetting('wifi aç')).toMatchObject({ key: 'wifi', action: 'on' });
  });
  it('bluetooth kapat → bluetooth/off', () => {
    expect(matchVoiceSetting('bluetooth kapat')).toMatchObject({ key: 'bluetooth', action: 'off' });
  });
  it('duvar kağıdını değiştir → wallpaper/open', () => {
    expect(matchVoiceSetting('duvar kağıdını değiştir')).toMatchObject({ key: 'wallpaper', action: 'open' });
  });
});

describe('matchVoiceSetting — yanlış pozitif koruması', () => {
  it('fiilsiz ayar adı komut sayılmaz', () => {
    expect(matchVoiceSetting('performans modu nedir')).toBeNull();
  });
  it('alakasız cümle null', () => {
    expect(matchVoiceSetting('bugün hava nasıl')).toBeNull();
  });
  it('"sesi aç" registry’ye düşmez (volume_up’a bırakılır)', () => {
    expect(matchVoiceSetting('sesi aç')).toBeNull();
  });
});

describe('parser entegrasyonu (parseCommand → set_setting)', () => {
  it('performans modunu aç → set_setting + doğru extra', () => {
    const cmd = parseCommand('performans modunu aç');
    expect(cmd?.type).toBe('set_setting');
    expect(cmd?.extra).toMatchObject({ settingKey: 'performanceMode', settingAction: 'on' });
  });
  it('parlaklığı %40 yap → set_setting/brightness/40', () => {
    const cmd = parseCommand('parlaklığı %40 yap');
    expect(cmd?.type).toBe('set_setting');
    expect(cmd?.extra).toMatchObject({ settingKey: 'brightness', settingAction: 'set', settingValue: '40' });
  });

  // REGRESYON — mevcut komutlar bozulmamalı
  it('REGRESYON: "sesi aç" → volume_up', () => {
    expect(parseCommand('sesi aç')?.type).toBe('volume_up');
  });
  it('REGRESYON: "tema değiştir" → theme_cycle', () => {
    expect(parseCommand('tema değiştir')?.type).toBe('theme_cycle');
  });
  it('REGRESYON: "gece moduna geç" → theme_night', () => {
    expect(parseCommand('gece moduna geç')?.type).toBe('theme_night');
  });
});
