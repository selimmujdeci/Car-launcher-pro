/**
 * mechanicReportView.test — Araç Ustası kartı: rapor yoksa teşhis uydurulmaz,
 * eski rapor güncel sayılmaz, servis metni kanıtsız neden yazmaz.
 */
import { describe, it, expect } from 'vitest';
import {
  buildMechanicReportView, buildServiceReportText, formatReportAge, MECHANIC_REPORT_STALE_MS, plainEvidence,
} from '../platform/ai/mechanic/mechanicReportView';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const report = (over: Record<string, unknown> = {}) => ({
  agentId: 'ai_mechanic', headline: 'Motor sıcaklığı yüksek', urgency: 'urgent', confidence: 72,
  hasEvidence: true,
  evidence: [{ summary: 'Soğutma suyu 112 °C' }],
  counterEvidence: [{ summary: 'Fan çalışıyor görünüyor' }],
  possibleCauses: [{ code: 'coolant_low', description: 'Soğutma suyu eksik', confidence: 60, supportingEvidence: [] }],
  nextSafeChecks: [{ description: 'Motor soğuyunca antifriz seviyesine bak' }],
  ...over,
});

describe('buildMechanicReportView', () => {
  it('🔒 sonuç yoksa / usta raporu yoksa null', () => {
    expect(buildMechanicReportView(null, NOW)).toBeNull();
    expect(buildMechanicReportView({ generatedAt: NOW, reports: [{ agentId: 'other' }] }, NOW)).toBeNull();
  });
  it('rapordan teşhis ve yaş', () => {
    const v = buildMechanicReportView({ generatedAt: NOW - 120_000, reports: [report()] }, NOW)!;
    expect(v.diagnosis.topCause?.description).toBe('Soğutma suyu eksik');
    expect(v.diagnosis.risk).toBe('Yüksek');
    expect(v.stale).toBe(false);
    expect(formatReportAge(v.ageMs)).toBe('2 dk önce');
  });
  it('🔒 eski rapor stale işaretlenir', () => {
    const v = buildMechanicReportView({ generatedAt: NOW - MECHANIC_REPORT_STALE_MS - 1, reports: [report()] }, NOW)!;
    expect(v.stale).toBe(true);
  });
});

describe('buildServiceReportText', () => {
  it('neden, kanıt, karşı kanıt, kontroller ve kodlar', () => {
    const v = buildMechanicReportView({ generatedAt: NOW, reports: [report()] }, NOW)!;
    const t = buildServiceReportText(v, ['P0217'], null);
    expect(t).toContain('Soğutma suyu eksik (%60)');
    expect(t).toContain('Karşı kanıt:');
    expect(t).toContain('P0217');
    expect(t).toContain('güven %72');
  });
  it('🔒 kanıtsız raporda neden ve güven yazılmaz', () => {
    const v = buildMechanicReportView({ generatedAt: NOW, reports: [report({ hasEvidence: false })] }, NOW)!;
    const t = buildServiceReportText(v, [], null);
    expect(t).not.toContain('Olası nedenler');
    expect(t).not.toContain('güven %');
    expect(t).toContain('okunmadı / yok');
  });
});

describe('ekran özeti', () => {
  it('🔒 uzun özet ekranda yarıda kesilmez (Mavi sınırı ayrı)', () => {
    const long = 'Kök neden kanıtlanamadı — kritik mekanik arıza kanıtı yok, ancak bu "sorun yok" demek değildir; bağlantı/kurtarma olayları gözlendi (6 kanıt).';
    const v = buildMechanicReportView({ generatedAt: NOW, reports: [report({ headline: long })] }, NOW)!;
    expect(v.displaySummary).toBe(long);
    expect(v.diagnosis.summary.length).toBeLessThanOrEqual(140);
  });
});

describe('kanıt satırları kullanıcı dilinde (telefonda görülen metinler)', () => {
  it.each([
    ['Handshake sonucu: fail (timeout)', 'OBD adaptörüyle bağlantı kurulamadı (adaptör yanıt vermedi)'],
    ['Reconnect baskısı 2.00 — bağlantı kararsız (yarı-ömür penceresinde 2+ kopma)', 'OBD bağlantısı son dakikalarda birkaç kez koptu'],
    ['8 reconnect kaydı (8 timeout) bu oturumda', 'Bu oturumda 8 kez yeniden bağlanma denendi (8 kez yanıt gelmedi)'],
    ['speed=0km/h (valid, güven 60%)', 'Hız: 0 km/h (ölçüldü)'],
    ['Zorlanan protokol 6 aktif değil — araç/protokol uyuşmazlığı', 'Ayarlarda seçilen OBD protokolü bu araçla eşleşmedi'],
  ])('%s', (raw, plain) => { expect(plainEvidence(raw)).toBe(plain); });
  it('🔒 tanınmayan satır değiştirilmez (anlam uydurulmaz)', () => {
    expect(plainEvidence('Arıza kodu P0217 (kritik)')).toBe('Arıza kodu P0217 (kritik)');
  });
});
