/**
 * Tema Stüdyo · Araca Gönder — "gönderildi" ≠ "uygulandı" (2026-09-26).
 * 1) Eskiden komut sıraya yazılınca "✓ Araca Gönderildi" deniyordu; aracın cevabı okunmuyordu.
 * 2) Saha: telefon arka plandayken tema araçta uygulandı, realtime olayı kaçtı →
 *    stüdyo "Araç bekleniyor" kaldı. Artık durum doğrudan da sorulur.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(__dirname, '../components/pwa/ThemeStudio.tsx'), 'utf8');
const send = src.slice(src.indexOf('const sendToVehicle'), src.indexOf('}, [vehicleId, manifest, settleCommand]);'));
const settle = src.slice(src.indexOf('const settleCommand'), src.indexOf('const sendToVehicle'));

describe('Araca Gönder dürüst durum', () => {
  it('aracın komut durumunu realtime ile dinler', () => {
    expect(send).toContain('subscribeCommandStatus(r.commandId');
  });
  it('yalnız araç "completed" deyince "uygulandı" olur', () => {
    expect(settle.indexOf("setSync('applied')")).toBeGreaterThan(settle.indexOf("status === 'completed'"));
    expect(src.match(/setSync\('applied'\)/g)).toHaveLength(1);
  });
  it('yerel zaman aşımı hata SAYILMAZ (komut sunucuda bekler)', () => {
    const exp = send.slice(send.indexOf("ev.status === 'expired'"));
    expect(exp.slice(0, 250)).not.toContain("setSync('fail')");
  });
  it('realtime kaçarsa: beklerken durum veritabanından sorulur, sayfaya dönünce hemen', () => {
    expect(src).toContain('fetchCommandStatus(p.id)');
    expect(src).toMatch(/addEventListener\('visibilitychange', onVis\)/);
    expect(src).toMatch(/if \(sync !== 'waiting'\) return;/);
  });
  it('eski "Araca Gönderildi" iddiası kalmadı', () => {
    expect(src).not.toContain('✓ Araca Gönderildi');
    expect(src).not.toContain("'✓ Gönderildi'");
  });
});
