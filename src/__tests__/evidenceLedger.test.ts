// @vitest-environment node
/**
 * Kanıt kaydedici (`npm run kanit`) — kütüğe yazan saf mantığın kilitleri.
 * Kütük kimlik numaralarına commit/kod referans verir; numara kuralı ve tablo
 * biçimi bozulursa tüm referanslar belirsizleşir (dosya başındaki kural).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEvidence, buildRow, cell, maxEntryNumber, provenance } from '../../scripts/lib/evidenceLedger.mjs';

const FIXTURE = [
  '# Kütük',
  '## 🔴 CİHAZDA TEST EDİLMEDİ (bekliyor)',
  '| # | Özellik | Nerede | Kabul ölçütü (cihazda ne gözlemlenmeli) | Eklendi |',
  '|---|---------|--------|------------------------------------------|---------|',
  '| 1328 | **🔴 NAV-UI — ARAMA (CİHAZDA TEST EDİLMEDİ)** | `Search.tsx` | Arama ekranı önizleme diliyle aynı | 2026-09-20 |',
  '| 1300 | **🔴 ESKİ** | x | y | 2026-09-01 |',
  '## 🟢 CİHAZDA DOĞRULANDI (testten geçti)',
  '| # | Özellik | Nasıl kanıtlandı | Doğrulandı |',
  '|---|---------|------------------|------------|',
  '| 1305 | **🟢 VAR OLAN** | ölçüldü | 2026-09-06 |',
  '## ❌ TEST EDİLDİ / DÜŞTÜ (geri dönüş gerekli)',
  '| # | Özellik | Nasıl kanıtlandı | Doğrulandı |',
  '|---|---------|------------------|------------|',
].join('\n');

const prov = provenance({ date: '2026-09-29', source: 'sahip gözlemi (smoke)', commit: 'abc1234', version: '1.0.2' });

describe('kanıt kaydedici', () => {
  it('yeni numara = dosyadaki en büyük + 1 (sıra değil)', () => {
    expect(maxEntryNumber(FIXTURE)).toBe(1328);
    const { no, text } = applyEvidence(FIXTURE, { result: 'gecti', area: 'mavi', note: 'uyanma smoke', prov, date: '2026-09-29' });
    expect(no).toBe(1329);
    expect(maxEntryNumber(text)).toBe(1329);
  });

  it('yeni madde 🟢 tablosunun en üstüne, Türkçe büyük harfle ve künyeyle eklenir', () => {
    const { text } = applyEvidence(FIXTURE, { result: 'gecti', area: 'navigasyon', note: 'smoke geçti', prov, date: '2026-09-29' });
    const lines = text.split('\n');
    const sep = lines.findIndex((l, i) => i > lines.findIndex((x) => x.startsWith('## 🟢')) && l.startsWith('|---'));
    expect(lines[sep + 1]).toMatch(/^\| 1329 \| \*\*🟢 NAVİGASYON — CİHAZDA DOĞRULANDI\*\* — smoke geçti \| Kaynak: sahip gözlemi \(smoke\) · 2026-09-29 · derleme 1\.0\.2 \(abc1234\) · cihaz bilgisi alınamadı \(adb yok\) \| 2026-09-29 \|$/);
  });

  it('--kapatir: 🔴 madde silinmez, 🟢 tablosuna TAŞINIR; kabul ölçütü korunur, hüküm eklenir', () => {
    const { text } = applyEvidence(FIXTURE, { result: 'gecti', area: 'navigasyon', note: 'smoke', closes: [1328], prov, date: '2026-09-29' });
    const red = text.slice(text.indexOf('## 🔴'), text.indexOf('## 🟢'));
    const green = text.slice(text.indexOf('## 🟢'), text.indexOf('## ❌'));
    expect(red).not.toContain('| 1328 |');
    expect(green).toMatch(/\| 1328 \| \*\*🟢 NAV-UI — ARAMA \(CİHAZDA TEST EDİLMEDİ\)\*\* \*\*→ CİHAZDA DOĞRULANDI \(2026-09-29\)\*\* \| Kabul ölçütü: Arama ekranı önizleme diliyle aynı — Kaynak:/);
    expect(green).toContain('Kapattığı madde(ler): #1328.');
    expect(text.match(/\| 1328 \|/g)).toHaveLength(1);
  });

  it('düşen sonuç ❌ tablosuna gider', () => {
    // Büyük harfle verilen kısaltma korunur (OBD-DİD olmaz).
    const { text } = applyEvidence(FIXTURE, { result: 'dustu', area: 'OBD-DID', note: 'DID boş', prov, date: '2026-09-29' });
    expect(text.slice(text.indexOf('## ❌'))).toContain('| 1329 | **❌ OBD-DID — CİHAZDA DÜŞTÜ** — DID boş');
  });

  it('eksik/geçersiz girdi kayıt ÜRETMEZ (sessiz yanlış kayıt yok)', () => {
    const base = { area: 'mavi', note: 'x', prov, date: '2026-09-29' };
    expect(() => applyEvidence(FIXTURE, { ...base, result: 'belki' })).toThrow(/Geçersiz sonuç/);
    expect(() => applyEvidence(FIXTURE, { ...base, result: 'gecti', area: '' })).toThrow(/--alan/);
    expect(() => applyEvidence(FIXTURE, { ...base, result: 'gecti', note: ' ' })).toThrow(/--not/);
    expect(() => applyEvidence(FIXTURE, { ...base, result: 'gecti', closes: [9999] })).toThrow(/#9999/);
  });

  it('tablo hücresi bozulmaz: | ve satır sonu temizlenir', () => {
    expect(cell('a | b\nc')).toBe('a / b c');
    expect(buildRow({ no: 1, result: 'gecti', area: 'x', note: 'p|q', prov: 'k', date: 'd' }).split(' | ')).toHaveLength(4);
  });

  it('gerçek kütük biçimi aracın beklentisiyle uyumlu', () => {
    const ledger = readFileSync(join(__dirname, '../../docs/DEVICE_VALIDATION_LEDGER.md'), 'utf8');
    const { no } = applyEvidence(ledger, { result: 'gecti', area: 'deneme', note: 'yalnız bellek içi', prov, date: '2026-09-29' });
    expect(no).toBe(maxEntryNumber(ledger) + 1);
  });
});
