/**
 * physicalEcuProbe.test.ts — P0-OBD-PARITY · STANDART FİZİKSEL ECU KEŞFİ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KUSUR: ECU keşfi TEK komuta bağlıydı — fonksiyonel `0100` (7DF).
 * `0100` bir OBD-II emisyon servisidir; fonksiyonel yayına katılmayan birimler
 * onu HİÇ yanıtlamaz ve ürün için yapısal olarak GÖRÜNMEZ kalırlar.
 *
 * Bu dosya genişletmenin GÜVENLİK SINIRLARINI kilitler — çünkü asıl risk
 * özelliğin kendisi değil, sınırlarının sessizce gevşemesidir:
 *   · K-line'da ASLA koşmaz (kör adres taraması başka modülü uyandırır)
 *   · protokol bilinmiyorsa koşmaz (fail-closed)
 *   · yalnız salt-okunur `19 02 FF`
 *   · SESSİZLİK ECU SAYILMAZ (uydurma envanter YASAK)
 *   · rol UYDURULMAZ
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:        vi.fn(),
    readDtcFromEcu:   vi.fn(),
    readUdsDtcs:      vi.fn(),
    readAdvancedDtcs: vi.fn(),
  },
}));

const protocolRef = { value: null as string | null };
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => 0,
  getHandshakeDiagnostics: () => ({ protocolActive: protocolRef.value, protocolTried: null }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { discoverEcus } from '../platform/obd/multiEcuScan';
import {
  STANDARD_PHYSICAL_TX, MAX_PHYSICAL_PROBES,
  rxForPhysicalTx, isEcuPresenceEvidence, ecuFromPhysicalProbe, planPhysicalProbes,
  getPhysicalProbes, _resetPhysicalProbesForTest,
  type PhysicalProbeResult,
} from '../platform/obd/physicalEcuProbe';
import type { DiscoveredEcu } from '../platform/obd/ecuDiscovery';

function knownEcu(tx: string, rx: string): DiscoveredEcu {
  return {
    rxHeader: rx, txHeader: tx, addressBits: 11, role: 'unknown', roleEvidence: 'none',
    label: `ECU ${tx}`, discoverySource: 'functional_0100', probeOutcome: 'responded',
    txProvenance: 'can_11bit_standard',
  };
}
function probe(over: Partial<PhysicalProbeResult> = {}): PhysicalProbeResult {
  return { txHeader: '7E1', rxHeader: '7E9', outcome: 'ok', nrc: null, raw: 'FF', present: true, ...over };
}

beforeEach(() => {
  _resetPhysicalProbesForTest();
  protocolRef.value = null;
  vi.mocked(CarLauncher.probeEcus).mockReset();
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockReset();
  vi.mocked(CarLauncher.probeEcus).mockResolvedValue({ raw: '7E8 06 41 00 BE' });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) SAF KURALLAR — adres standarttan, rol hiçbir yerden
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · A) adres ve varlık kuralları', () => {
  it('🔒 KİLİT: taranan aralık ISO 15765-4 standardıdır (7E1..7E7) — araç-özel adres YOK', () => {
    expect(STANDARD_PHYSICAL_TX).toEqual(['7E1', '7E2', '7E3', '7E4', '7E5', '7E6', '7E7']);
    expect(MAX_PHYSICAL_PROBES).toBe(7);
  });

  it('🔒 KİLİT: rx = tx + 8 (standart aritmetik, tahmin DEĞİL)', () => {
    expect(rxForPhysicalTx('7E1')).toBe('7E9');
    expect(rxForPhysicalTx('7E7')).toBe('7EF');
    expect(rxForPhysicalTx('ZZZ')).toBeNull();
  });

  it('🔒 ANA KİLİT: SESSİZLİK ECU SAYILMAZ — "duydu ve reddetti" ECU’DUR', () => {
    for (const ok of ['ok', 'negative_nrc', 'unsupported', 'security_required', 'condition_required']) {
      expect(isEcuPresenceEvidence(ok), ok).toBe(true);
    }
    for (const no of ['no_response', 'timeout', 'transport_error', 'malformed', '']) {
      expect(isEcuPresenceEvidence(no), no).toBe(false);
    }
  });

  it('🔒 KİLİT: sessiz adresten envanter kaydı ÜRETİLMEZ', () => {
    expect(ecuFromPhysicalProbe(probe({ present: false }))).toBeNull();
  });

  it('🔒 KİLİT: bulunan ECU’nun ROLÜ UYDURULMAZ — 7E1 "şanzıman" DEĞİLDİR', () => {
    const e = ecuFromPhysicalProbe(probe())!;
    expect(e.role).toBe('unknown');
    expect(e.roleEvidence).toBe('none');
    expect(e.label).toBe('ECU 7E1');          // adres, sistem adı DEĞİL
    expect(e.discoverySource).toBe('physical_probe');
    expect(e.txProvenance).toBe('can_11bit_standard');
  });

  it('zaten bilinen adres tekrar sorulmaz; bütçe kırpması SESSİZ DEĞİLDİR', () => {
    expect(planPhysicalProbes([knownEcu('7E1', '7E9')]).targets)
      .toEqual(['7E2', '7E3', '7E4', '7E5', '7E6', '7E7']);
    const tight = planPhysicalProbes([], 2);
    expect(tight.targets).toEqual(['7E1', '7E2']);
    expect(tight.skipped).toBe(5);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) GÜVENLİK KAPILARI — sınırların gevşemesi asıl risktir
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · B) güvenlik kapıları', () => {
  it('🔒 ANA KİLİT: YAVAŞ SERİ HATTA (KWP/ISO9141) TEK PROB BİLE GÖNDERİLMEZ', async () => {
    protocolRef.value = '5';   // ISO 14230-4 KWP
    await discoverEcus();
    expect(CarLauncher.readAdvancedDtcs).not.toHaveBeenCalled();
    expect(getPhysicalProbes()).toHaveLength(0);
  });

  it('🔒 ANA KİLİT: PROTOKOL BİLİNMİYORSA koşmaz (fail-closed)', async () => {
    protocolRef.value = null;
    await discoverEcus();
    expect(CarLauncher.readAdvancedDtcs).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: gönderilen TEK komut salt-okunur `19 02 FF` — yazma/rutin/oturum YOK', async () => {
    protocolRef.value = '6';   // ISO 15765-4 CAN 11/500
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'no_response', raw: '', kind: 'NO_DATA',
    });
    await discoverEcus();
    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.service === '19' && c.subFunction === '02' && c.payload === 'FF')).toBe(true);
  });

  it('🔒 KİLİT: fonksiyonel keşifte bulunan adres TEKRAR SORULMAZ', async () => {
    protocolRef.value = '6';
    // 7E8 (→tx 7E0) ve 7E9 (→tx 7E1) fonksiyonel geldi.
    vi.mocked(CarLauncher.probeEcus).mockResolvedValue({ raw: '7E8 06 41 00 BE\r\n7E9 06 41 00 80' });
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'no_response', raw: '', kind: 'NO_DATA',
    });
    await discoverEcus();
    const txs = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls.map((c) => c[0].tx);
    expect(txs).not.toContain('7E0');
    expect(txs).not.toContain('7E1');
    expect(txs).toEqual(['7E2', '7E3', '7E4', '7E5', '7E6', '7E7']);
  });

  it('köprü YOKSA (eski APK) keşif sessizce ESKİSİ GİBİ çalışır', async () => {
    protocolRef.value = '6';
    const bridge = CarLauncher as unknown as { readAdvancedDtcs?: unknown };
    const saved = bridge.readAdvancedDtcs;
    delete bridge.readAdvancedDtcs;
    try {
      const t = await discoverEcus();
      expect(t.ecus).toHaveLength(1);          // yalnız fonksiyonel 7E8
      expect(getPhysicalProbes()).toHaveLength(0);
    } finally {
      bridge.readAdvancedDtcs = saved;
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) KEŞİF GENİŞLEMESİ — yalnız KANITLA
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · C) keşif genişlemesi', () => {
  it('🔒 ANA KİLİT: NRC ile cevap veren adres ENVANTERE GİRER (ECU var, servisi yok)', async () => {
    protocolRef.value = '6';
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E3'
        ? { outcome: 'negative_nrc', raw: '', kind: 'NEG_7F', nrc: 0x11 }
        : { outcome: 'no_response', raw: '', kind: 'NO_DATA' },
    );

    const t = await discoverEcus();
    const found = t.ecus.filter((e) => e.discoverySource === 'physical_probe');
    expect(found.map((e) => e.txHeader)).toEqual(['7E3']);
    expect(found[0]!.rxHeader).toBe('7EB');
    expect(found[0]!.role).toBe('unknown');    // rol UYDURULMADI
  });

  it('🔒 ANA KİLİT: HİÇBİRİ CEVAP VERMEZSE envanter BÜYÜMEZ (uydurma ECU YASAK)', async () => {
    protocolRef.value = '6';
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'no_response', raw: '', kind: 'NO_DATA',
    });
    const t = await discoverEcus();
    expect(t.ecus).toHaveLength(1);            // yalnız fonksiyonel 7E8
    expect(t.ecus.every((e) => e.discoverySource === 'functional_0100')).toBe(true);
  });

  it('🔒 KİLİT: fonksiyonel kayıtlar ÖNDE kalır (kanıtı daha güçlü)', async () => {
    protocolRef.value = '6';
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E2' ? { outcome: 'ok', raw: 'FF', kind: 'OK' }
        : { outcome: 'no_response', raw: '', kind: 'NO_DATA' },
    );
    const t = await discoverEcus();
    expect(t.ecus[0]!.discoverySource).toBe('functional_0100');
    expect(t.ecus[t.ecus.length - 1]!.discoverySource).toBe('physical_probe');
  });

  it('🔒 GÖZLEMLENEBİLİRLİK: her prob KANIT olarak kaydedilir (sessiz olanlar dâhil)', async () => {
    protocolRef.value = '6';
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E4' ? { outcome: 'ok', raw: 'FF', kind: 'OK' }
        : { outcome: 'no_response', raw: '', kind: 'NO_DATA' },
    );
    await discoverEcus();
    const probes = getPhysicalProbes();
    expect(probes).toHaveLength(7);                                   // hepsi kayıtlı
    expect(probes.filter((p) => p.present).map((p) => p.txHeader)).toEqual(['7E4']);
    expect(probes.every((p) => p.protocol === '6')).toBe(true);
  });

  it('bir adres düşerse tarama SÜRER (fail-soft)', async () => {
    protocolRef.value = '6';
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ tx }) => {
      if (tx === '7E1') throw new Error('hat hatası');
      if (tx === '7E5') return { outcome: 'ok', raw: 'FF', kind: 'OK' };
      return { outcome: 'no_response', raw: '', kind: 'NO_DATA' };
    });
    const t = await discoverEcus();
    expect(t.ecus.some((e) => e.txHeader === '7E5')).toBe(true);
  });
});
