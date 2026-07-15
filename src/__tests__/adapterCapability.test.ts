/**
 * OBD-OS-F3-5 — Adaptör kimliği & yetenek sınıflandırması.
 *
 * KÖK: "ELM327 v1.5" yazan adaptörlerin ÇOĞU klondur ve etiketteki özellikleri TAŞIMAZ.
 * Yeteneği ETİKETTEN değil DAVRANIŞTAN çıkarırız; yanıt yoksa yetenek VARSAYILMAZ.
 */
import { describe, it, expect } from 'vitest';
import { classifyAdapter } from '../platform/obd/adapterCapability';

describe('OBD-OS-F3-5 — classifyAdapter', () => {
  it('STDI yanıt verdi → STN (gerçek ELM327 bu komutu bilmez)', () => {
    const c = classifyAdapter('STN1170 v5.6.1|OBDLink MX|STN1170 v5.6.1');
    expect(c.kind).toBe('stn');
    expect(c.extendedAddressing).toBe(true);
    expect(c.flowControl).toBe(true);
  });

  it('AT@1 anlamlı cihaz tanımı → gerçek ELM327', () => {
    const c = classifyAdapter('ELM327 v1.4b|OBDII to RS232 Interpreter|?');
    expect(c.kind).toBe('elm327');
    expect(c.extendedAddressing).toBe(true);
  });

  it('🔒 KİLİT: etikette ELM327 ama kimlik komutlarına yanıt YOK → KLON (etiket yalan)', () => {
    const c = classifyAdapter('ELM327 v1.5|?|?');
    expect(c.kind).toBe('clone');
    // FAIL-CLOSED: klonda 29-bit/flow-control VARSAYILMAZ — sessizce başarısız olabilirler.
    expect(c.extendedAddressing).toBe(false);
    expect(c.flowControl).toBe(false);
    expect(c.summary).toMatch(/güvenilmez/i);
  });

  it('klon: kimlik komutları boş dönerse de klon sayılır', () => {
    expect(classifyAdapter('ELM327 v2.1||').kind).toBe('clone');
  });

  it('🔒 KİLİT: hiçbir kimlik okunamadı → unknown, yetenek VARSAYILMAZ (fail-closed)', () => {
    const c = classifyAdapter('||');
    expect(c.kind).toBe('unknown');
    expect(c.extendedAddressing).toBe(false);
    expect(c.flowControl).toBe(false);
  });

  it('NO DATA / ERROR yanıtları "anlamlı kimlik" SAYILMAZ', () => {
    expect(classifyAdapter('ELM327 v1.5|NO DATA|ERROR').kind).toBe('clone');
  });

  it('ham ATI (etiket iddiası) kaybolmaz — teşhis raporunda görünür', () => {
    expect(classifyAdapter('ELM327 v1.5|?|?').identity).toBe('ELM327 v1.5');
  });
});
