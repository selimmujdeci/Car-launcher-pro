/**
 * P0-OBD-FINAL-01 · ÖNCELİK 4 — "KEŞİF GÖZLEMLERİ BOŞ" EKRANININ KİLİDİ.
 *
 * Sahada LAB'da bu bölüm boştu ve boşluk iki bambaşka durumu aynı gösteriyordu:
 * "araçta başka ECU yok" ile "keşif hiç koşmadı / çözümlenemedi". Bir ekran bu
 * ikisini ayıramıyorsa kök nedeni GİZLER — nitekim 3 hafta gizledi.
 *
 * Bu dosya iki şeyi kilitler:
 *  · Boş liste ASLA "temiz/tek ECU" anlamına gelecek biçimde sunulmaz.
 *  · Dolu satırlar kararın TÜM kanıtını taşır: keşif kaynağı · tx/rx rotası ·
 *    tx kuralı · protokol · oturum · prob sonucu · adreslenebilirlik · servis
 *    denemeleri (alt fonksiyon dahil) · HAM yanıt · otorite yayını.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEcuDiscoveryRows, buildDtcCoverageView, NA,
  type EcuDiscoveryObservationInput,
} from '../platform/devtools/dtcCoverageModel';
import { summarizeDtcEvidence } from '../platform/obd/dtcScanEvidence';

function obs(over: Partial<EcuDiscoveryObservationInput> = {}): EcuDiscoveryObservationInput {
  return {
    atMs: 1_000, sessionEpoch: 3, protocol: '5',
    rxHeader: '486B10', txHeader: '8110F1', addressBits: 8,
    label: 'Motor (ECM)', discoverySource: 'functional_0100', probeOutcome: 'responded',
    txProvenance: 'kwp_iso14230', addressability: 'PROVEN',
    addressabilityReason: 'fiziksel istek cevaplandı (03:OK)',
    admission: 'READY', kwpTargetVerified: true, publishedToAuthority: true,
    attempts: [
      { service: '03', subFunction: null, outcome: 'OK', raw: '43 00 00', codeCount: 0 },
      { service: '18', subFunction: '18', outcome: 'ok', raw: '58 01 12 34 60', codeCount: 1 },
    ],
    ...over,
  };
}

describe('P0-OBD-FINAL-01 · LAB ECU keşif satırları', () => {
  it('kararın TÜM kanıtı satırda taşınır', () => {
    const [row] = buildEcuDiscoveryRows([obs()], 3);
    expect(row.route).toBe('tx 8110F1 → rx 486B10');
    expect(row.txRule).toContain('ISO 14230-4');
    expect(row.protocol).toBe('ATDPN 5');
    expect(row.epoch).toBe('3');
    expect(row.addressability).toBe('PROVEN');
    expect(row.services).toEqual(['03: OK (0 kod)', '18-18: ok (1 kod)']);
    expect(row.raws).toEqual(['03: 43 00 00', '18: 58 01 12 34 60']);
    expect(row.published).toContain('YAZILDI');
    expect(row.kwpTarget).toContain('DOĞRULANDI');
  });

  it('🔒 KİLİT: tx türetilemediyse rota UNAVAILABLE — sahte adres GÖSTERİLMEZ', () => {
    const [row] = buildEcuDiscoveryRows(
      [obs({ txHeader: null, txProvenance: 'unknown', addressability: 'NOT_ATTEMPTED' })], 3);
    expect(row.route).toBe(`tx ${NA} → rx 486B10`);
    expect(row.txRule).toContain('TÜRETİLEMEDİ');
    expect(row.tone).toBe('warn');
  });

  it('🔒 KİLİT: ULAŞILAMAYAN ECU asla yeşil (ok) tonda gösterilmez', () => {
    const [row] = buildEcuDiscoveryRows([obs({ addressability: 'NOT_ADDRESSABLE' })], 3);
    expect(row.tone).toBe('bad');
  });

  it('ham yanıt YOKSA satır ÜRETİLMEZ — boş string sahte kanıttır', () => {
    const [row] = buildEcuDiscoveryRows([obs({
      attempts: [{ service: '03', subFunction: null, outcome: 'NO_RESPONSE', raw: null, codeCount: 0 }],
    })], 3);
    expect(row.raws).toEqual([]);
    expect(row.services).toEqual(['03: NO_RESPONSE (0 kod)']);
  });

  it('otorite yayını ÖLÇÜLMEDİYSE UNAVAILABLE — sahte "yazıldı" YOK', () => {
    const [row] = buildEcuDiscoveryRows([obs({ publishedToAuthority: null })], 3);
    expect(row.published).toBe(NA);
  });

  it('BAŞKA oturumun gözlemi ekrana SIZMAZ', () => {
    expect(buildEcuDiscoveryRows([obs({ sessionEpoch: 2 })], 3)).toHaveLength(0);
    expect(buildEcuDiscoveryRows([obs({ sessionEpoch: 2 })], null)).toHaveLength(1);
  });

  it('🔒 KİLİT: gözlem yokken görünüm BOŞ değil, AÇIK biçimde "gözlem yok" der', () => {
    const view = buildDtcCoverageView([], summarizeDtcEvidence([]), 3, []);
    expect(view.ecuEmpty).toBe(true);
    expect(view.ecuRows).toHaveLength(0);
  });

  it('gözlem varken ecuEmpty düşer ve satırlar görünüme girer', () => {
    const view = buildDtcCoverageView([], summarizeDtcEvidence([]), 3, [obs()]);
    expect(view.ecuEmpty).toBe(false);
    expect(view.ecuRows).toHaveLength(1);
  });
});
