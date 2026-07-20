/**
 * maviActionRegistry.test.ts — Mavi Çekirdeği Faz-1 · Typed AppAction defteri sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Bilinmeyen id → undefined (fail-closed); has() false.
 *  2. Çift kayıt → Error (kurulum-zamanı programlama hatası).
 *  3. Payload doğrulayıcılar: enum / sayı-aralık / zorunlu-string / opsiyonel-string / boş.
 *  4. Pilot set 10 eylem içerir; vehicle.health.read yalnız 'read' araç kapsamı taşır.
 *  5. Yasak kapsam (ecu_write/coding/actuator/adaptation) metadata olarak bile reddedilir.
 */
import { describe, it, expect } from 'vitest';
import {
  createActionRegistry, createPilotActionRegistry, PILOT_ACTIONS, PILOT_THEMES,
  makeEnumValidator, makeNumberRangeValidator, makeRequiredStringValidator,
  makeOptionalStringValidator, validateEmpty,
  type ActionDefinition,
} from '../platform/maviCore/actionRegistry';

const dummy: Omit<ActionDefinition, 'id'> = {
  title: 'x', risk: 'low', reversible: true, timeoutMs: 1000,
  resultContract: 'ack', validate: validateEmpty,
};

describe('MaviActionRegistry — kayıt / arama', () => {
  it('bilinmeyen id fail-closed (undefined + has=false)', () => {
    const reg = createActionRegistry();
    expect(reg.get('yok.olan')).toBeUndefined();
    expect(reg.has('yok.olan')).toBe(false);
    expect(reg.get(undefined as unknown as string)).toBeUndefined();
  });

  it('kayıt sonrası get/has çalışır, ids sıralı döner', () => {
    const reg = createActionRegistry();
    reg.register({ ...dummy, id: 'b.two' });
    reg.register({ ...dummy, id: 'a.one' });
    expect(reg.size).toBe(2);
    expect(reg.has('a.one')).toBe(true);
    expect(reg.ids()).toEqual(['a.one', 'b.two']);
  });

  it('çift kayıt Error fırlatır', () => {
    const reg = createActionRegistry();
    reg.register({ ...dummy, id: 'dup' });
    expect(() => reg.register({ ...dummy, id: 'dup' })).toThrow(/çift kayıt/);
  });

  it('id yok/boş → Error', () => {
    const reg = createActionRegistry();
    expect(() => reg.register({ ...dummy, id: '' })).toThrow(/geçersiz tanım/);
  });

  it('yasak araç kapsamı (ecu_write) metadata olarak bile reddedilir', () => {
    const reg = createActionRegistry();
    expect(() => reg.register({ ...dummy, id: 'evil', vehicleScope: 'ecu_write' })).toThrow(/yasak kapsam/);
    expect(() => reg.register({ ...dummy, id: 'evil2', vehicleScope: 'actuator' })).toThrow(/yasak kapsam/);
  });

  it('kayıtlı tanım dondurulmuş (mutasyona kapalı)', () => {
    const reg = createActionRegistry();
    reg.register({ ...dummy, id: 'frozen' });
    const def = reg.get('frozen')!;
    expect(Object.isFrozen(def)).toBe(true);
  });
});

describe('payload doğrulayıcılar', () => {
  it('enum: geçerli/ geçersiz', () => {
    const v = makeEnumValidator('theme', PILOT_THEMES);
    expect(v({ theme: 'night' }).ok).toBe(true);
    expect(v({ theme: 'mor' }).ok).toBe(false);
    expect(v({}).ok).toBe(false);
    expect(v(null).ok).toBe(false);
  });

  it('sayı-aralık: sınırlar + geçersiz tipler', () => {
    const v = makeNumberRangeValidator('value', 0, 100);
    expect(v({ value: 0 }).ok).toBe(true);
    expect(v({ value: 100 }).ok).toBe(true);
    expect(v({ value: 101 }).ok).toBe(false);
    expect(v({ value: -1 }).ok).toBe(false);
    expect(v({ value: NaN }).ok).toBe(false);
    expect(v({ value: '50' }).ok).toBe(false);
  });

  it('zorunlu string: boş/eksik reddedilir, normalize (trim) edilir', () => {
    const v = makeRequiredStringValidator('page');
    expect(v({ page: '  ayarlar ' }).value).toEqual({ page: 'ayarlar' });
    expect(v({ page: '' }).ok).toBe(false);
    expect(v({}).ok).toBe(false);
  });

  it('opsiyonel string: yok → ok (boş value); boş string → hata', () => {
    const v = makeOptionalStringValidator('destination');
    expect(v({}).ok).toBe(true);
    expect(v({ destination: 'ev' }).value).toEqual({ destination: 'ev' });
    expect(v({ destination: '   ' }).ok).toBe(false);
  });

  it('boş: her zaman ok', () => {
    expect(validateEmpty(undefined).ok).toBe(true);
    expect(validateEmpty({ fazla: 1 }).ok).toBe(true);
  });
});

describe('PİLOT eylem seti', () => {
  it('10 pilot eylem beklenen id/metadata ile kayıtlı', () => {
    const reg = createPilotActionRegistry();
    expect(reg.size).toBe(10);
    expect(reg.ids()).toEqual([
      'media.next', 'media.pause', 'media.play', 'media.volume.set',
      'navigation.cancel', 'navigation.open',
      'ui.brightness.set', 'ui.page.open', 'ui.theme.set',
      'vehicle.health.read',
    ]);
  });

  it('vehicle.health.read yalnız araç-etkili: read kapsamı + value kontratı', () => {
    const reg = createPilotActionRegistry();
    const h = reg.get('vehicle.health.read')!;
    expect(h.vehicleScope).toBe('read');
    expect(h.resultContract).toBe('value');
    // UI/media/nav eylemleri araç kapsamsız
    expect(reg.get('ui.theme.set')!.vehicleScope).toBeUndefined();
    expect(reg.get('media.play')!.vehicleScope).toBeUndefined();
  });

  it('media.next tek-yön (reversible=false); tema/medya/parlaklık geri alınabilir', () => {
    const reg = createPilotActionRegistry();
    expect(reg.get('media.next')!.reversible).toBe(false);
    expect(reg.get('navigation.cancel')!.reversible).toBe(false);
    expect(reg.get('ui.theme.set')!.reversible).toBe(true);
    expect(reg.get('media.pause')!.reversible).toBe(true);
  });

  it('tüm pilot eylemler bounded timeout + geçerli risk taşır', () => {
    for (const def of PILOT_ACTIONS) {
      expect(def.timeoutMs).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(def.risk);
      expect(['ack', 'value']).toContain(def.resultContract);
    }
  });

  it('pilot eylem payload doğrulaması gerçek örneklerle çalışır', () => {
    const reg = createPilotActionRegistry();
    expect(reg.get('ui.theme.set')!.validate({ theme: 'oled' }).ok).toBe(true);
    expect(reg.get('ui.theme.set')!.validate({ theme: 'yok' }).ok).toBe(false);
    expect(reg.get('ui.brightness.set')!.validate({ value: 55 }).ok).toBe(true);
    expect(reg.get('navigation.open')!.validate({}).ok).toBe(true);
    expect(reg.get('navigation.open')!.validate({ destination: 'iş' }).ok).toBe(true);
  });
});
