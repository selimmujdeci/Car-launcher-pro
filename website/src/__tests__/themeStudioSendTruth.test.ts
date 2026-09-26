/**
 * Tema Stüdyo · Araca Gönder — "gönderildi" ≠ "uygulandı" (2026-09-26).
 * Eskiden komut sıraya yazılınca "✓ Araca Gönderildi" deniyordu; aracın kendi
 * cevabı (vehicle_commands.status) hiç okunmuyordu.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(__dirname, '../components/pwa/ThemeStudio.tsx'), 'utf8');
const send = src.slice(src.indexOf('const sendToVehicle'), src.indexOf('}, [vehicleId, manifest]);'));

describe('Araca Gönder dürüst durum', () => {
  it('aracın komut durumunu dinler', () => {
    expect(send).toContain('subscribeCommandStatus(r.commandId');
  });
  it('yalnız araç "completed" deyince "uygulandı" olur', () => {
    const applied = send.indexOf("setSync('applied')");
    expect(applied).toBeGreaterThan(send.indexOf("ev.status === 'completed'"));
    expect(send.match(/setSync\('applied'\)/g)).toHaveLength(1);
  });
  it('yerel zaman aşımı hata SAYILMAZ (komut sunucuda bekler)', () => {
    const exp = send.slice(send.indexOf("ev.status === 'expired'"));
    expect(exp.slice(0, 200)).not.toContain("setSync('fail')");
  });
  it('eski "Araca Gönderildi" iddiası kalmadı', () => {
    expect(src).not.toContain('✓ Araca Gönderildi');
    expect(src).not.toContain("'✓ Gönderildi'");
  });
});
