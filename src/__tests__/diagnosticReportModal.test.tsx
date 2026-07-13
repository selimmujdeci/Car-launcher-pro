/**
 * diagnosticReportModal.test.tsx — PR-4 ortak "Tanı Gönder" modalı.
 *
 * Repo konvansiyonu: component'ler SSR (renderToStaticMarkup) + kaynak-sözleşme
 * ile kilitlenir (testing-library repoda yok). Etkileşim mantığı (rıza kapısı,
 * teslim bekleme, kopyalama, iptal) kaynak-sözleşmeyle; alan varlığı SSR ile;
 * veri-gerçeği (meta/önizleme/maskeleme) servis seviyesinde (supportSnapshot.test).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiagnosticReportModal } from '../components/common/DiagnosticReportModal';

const noop = () => {};
const fakeSend = async () => ({ status: 'queued' as const, reportId: 'support_snapshot-abcd1234' });

const src = readFileSync(join(process.cwd(),
  'src/components/common/DiagnosticReportModal.tsx'), 'utf-8');

describe('DiagnosticReportModal — SSR render (alan varlığı)', () => {
  it('open=false → hiçbir şey render etmez', () => {
    const html = renderToStaticMarkup(
      <DiagnosticReportModal open={false} onClose={noop} send={fakeSend} />);
    expect(html).toBe('');
  });

  it('MODAL AÇILIYOR: kategori + açıklama + önizleme + rıza + aksiyonlar render olur', () => {
    const html = renderToStaticMarkup(
      <DiagnosticReportModal open onClose={noop} send={fakeSend} title="Tanı Raporu Gönder" />);
    expect(html).toContain('Tanı Raporu Gönder');
    // KATEGORİ SEÇİMİ — çipler
    expect(html).toContain('Kategori');
    expect(html).toContain('OBD');
    expect(html).toContain('Çökme');
    expect(html).toContain('Diğer');
    // AÇIKLAMA alanı
    expect(html).toContain('Problem açıklaması');
    expect(html).toContain('<textarea');
    // ÖNİZLEME paneli
    expect(html).toContain('Gönderilecek veri önizlemesi');
    // AÇIK RIZA kutusu
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('göndermeyi onaylıyorum');
    // AKSİYONLAR
    expect(html).toContain('Gönder');
    expect(html).toContain('Vazgeç');
    // gizlilik güvencesi
    expect(html).toContain('kişisel bilgisi gönderilmez');
  });

  it('RIZA KAPISI (render): rıza işaretsizken en az bir buton disabled ("Gönder")', () => {
    const html = renderToStaticMarkup(
      <DiagnosticReportModal open onClose={noop} send={fakeSend} />);
    // consent=false başlangıç → canSend=false → Gönder butonu disabled
    expect(html).toContain('disabled');
  });
});

describe('DiagnosticReportModal — kaynak-sözleşme (davranış kilidi)', () => {
  it('RIZA OLMADAN GÖNDERİLEMEZ: handleSend consent kapısıyla korunur', () => {
    expect(src).toMatch(/if \(!consent \|\| phase !== 'form'\) return/);
    expect(src).toMatch(/disabled=\{!canSend\}/);
    expect(src).toMatch(/const canSend = consent/);
  });

  it('ÖNİZLEME upload YAPMAZ: buildDiagnosticPreview yalnız payload kurar', () => {
    expect(src).toContain('buildDiagnosticPreview()');
    // önizleme yalnız effect'te; gönderim ayrı (send prop)
    expect(src).toContain('void buildDiagnosticPreview()');
  });

  it('TESLİMAT GERÇEĞİ: kabul → awaitDelivery ile gerçek durum (yalancı "Gönderildi" yok)', () => {
    expect(src).toContain('awaitDelivery(');
    expect(src).toContain('deliveryLabel(');
  });

  it('REPORT ID gösterilir ve KOPYALANABİLİR', () => {
    expect(src).toContain('Rapor Numarası');
    expect(src).toMatch(/navigator\.clipboard\?\.writeText\(reportId\)/);
  });

  it('CANCEL çalışır: Vazgeç/Kapat + backdrop onClose çağırır', () => {
    expect(src).toMatch(/onClick=\{onClose\}/);          // backdrop + kapat
    expect(src).toMatch(/\? 'Kapat' : 'Vazgeç'/);
  });

  it('GİZLİLİK: yeni telemetri/tracking/analytics YOK', () => {
    expect(src).not.toMatch(/analytics|gtag|mixpanel|amplitude|\btrack\(/i);
  });

  it('OFFLINE: queued_offline durumu kullanıcıya gösterilir', () => {
    expect(src).toContain('queued_offline');
    expect(src).toContain('internet gelince gönderilecek');
  });
});
