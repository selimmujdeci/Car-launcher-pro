/**
 * vehicleFingerprintBuilder.test.ts — Otomatik Araç Parmak İzi Üreticisi (PR-26).
 *
 * Kilitlenen davranışlar: ilk bağlantıda üretim · aynı araç duplicate ÜRETMEZ ·
 * lastSeen/sourceCount/confidence güncellenir · VIN→profileHint · VIN'siz çalışır ·
 * Discovery bağlıyken davranış değişmez (SALT-OKUNUR) · FAIL-SOFT · kimlik-imza guard
 * (telemetri tick'i yeni kayıt üretmez).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  profileHintFromVin,
  ingestVehicleFingerprint,
  isConnectionComplete,
  collectEcuAddresses,
  assembleFingerprintInput,
  fingerprintInputSignature,
  AutomaticVehicleFingerprint,
  type LearnedVehicleFingerprint,
} from '../platform/vehicleFingerprintBuilder';
import { VehicleFingerprintStore } from '../platform/vehicleFingerprintService';
import { useVidStore } from '../store/useVidStore';
import {
  DiscoveryCaptureService,
  DiscoveryQueue,
  DiscoveryCache,
  type DiscoveryObservation,
} from '../platform/obd/discovery';

let _k = 0;
function store() { return new VehicleFingerprintStore(`avf-test-${_k++}`); }

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
  useVidStore.getState().resetStore();
});

/* ── profileHint (WMI) ────────────────────────────────────────────────────── */
describe('profileHintFromVin', () => {
  it('VIN WMI → marka ipucu', () => {
    expect(profileHintFromVin('VF1BM0A0H12345678')).toBe('Renault');
    expect(profileHintFromVin('UU1KABC00000001')).toBe('Dacia');
    expect(profileHintFromVin('WF0AXXWPMA000000')).toBe('Ford');
    expect(profileHintFromVin('NMTKZ3JE00R000000')).toBe('Toyota');
  });
  it('VIN yok/kısa/bilinmeyen → ""', () => {
    expect(profileHintFromVin('')).toBe('');
    expect(profileHintFromVin(undefined)).toBe('');
    expect(profileHintFromVin('AB')).toBe('');
    expect(profileHintFromVin('ZZZ00000000000000')).toBe('');
  });
});

/* ── ingest: yeni / duplicate yaşam-döngüsü ───────────────────────────────── */
describe('ingestVehicleFingerprint', () => {
  const vehA = { vin: 'VF1BM0A0H12345678', protocol: '6', ecuAddresses: ['7E8', '7E9'] };

  it('ilk bağlantıda YENİ kayıt (createdAt/firstSeen/lastSeen + confidence + profileHint)', () => {
    const s = store();
    const fp = ingestVehicleFingerprint(vehA, s, 1000);
    expect(s.size).toBe(1);
    expect(fp.createdAt).toBe(1000);
    expect(fp.firstSeen).toBe(1000);
    expect(fp.lastSeen).toBe(1000);
    expect(fp.sourceCount).toBe(1);
    expect(fp.confidence).toBeCloseTo(0.6); // VIN bonusu (0.5 + 0.1)
    expect(fp.profileHint).toBe('Renault');
  });

  it('aynı araç ikinci kez DUPLICATE ÜRETMEZ; lastSeen/sourceCount/confidence güncellenir', () => {
    const s = store();
    const first = ingestVehicleFingerprint(vehA, s, 1000);
    const second = ingestVehicleFingerprint(vehA, s, 5000);
    expect(s.size).toBe(1);                 // duplicate yok
    expect(second.hash).toBe(first.hash);
    expect(second.createdAt).toBe(1000);    // createdAt korunur
    expect(second.firstSeen).toBe(1000);    // firstSeen korunur
    expect(second.lastSeen).toBe(5000);     // lastSeen güncellendi
    expect(second.sourceCount).toBe(2);     // sourceCount arttı
    expect(second.confidence).toBeGreaterThan(first.confidence); // confidence arttı
  });

  it('confidence tavanı 1.0 aşmaz', () => {
    const s = store();
    let fp!: LearnedVehicleFingerprint;
    for (let i = 0; i < 20; i++) fp = ingestVehicleFingerprint(vehA, s, 1000 + i);
    expect(fp.confidence).toBeLessThanOrEqual(1.0);
    expect(fp.confidence).toBe(1.0);
    expect(fp.sourceCount).toBe(20);
  });

  it('VIN YOKken çalışır (profileHint "", taban güven 0.5)', () => {
    const s = store();
    const fp = ingestVehicleFingerprint({ vin: '', protocol: '6', ecuAddresses: ['7E8'] }, s, 1000);
    expect(s.size).toBe(1);
    expect(fp.vin).toBe('');
    expect(fp.profileHint).toBe('');
    expect(fp.confidence).toBeCloseTo(0.5);
    // VIN'siz ikinci gözlem de duplicate üretmez
    const again = ingestVehicleFingerprint({ vin: '', protocol: '6', ecuAddresses: ['7E8'] }, s, 2000);
    expect(s.size).toBe(1);
    expect(again.sourceCount).toBe(2);
  });

  it('farklı araç → ayrı kayıt', () => {
    const s = store();
    ingestVehicleFingerprint(vehA, s, 1000);
    ingestVehicleFingerprint({ vin: 'WF0AXXWPMA000000', protocol: '6', ecuAddresses: ['7E8'] }, s, 1000);
    expect(s.size).toBe(2);
  });
});

/* ── VID + Discovery okuma ────────────────────────────────────────────────── */
describe('bağlantı-tamam + Discovery toplama (SALT-OKUNUR)', () => {
  it('isConnectionComplete: taşıma doğrulandı + protokol var', () => {
    const base = useVidStore.getState();
    expect(isConnectionComplete(base)).toBe(false); // başlangıç
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    expect(isConnectionComplete(useVidStore.getState())).toBe(true);
  });

  it('collectEcuAddresses: gözlemlerden benzersiz + sıralı ECU', () => {
    const obs = [
      { record: { ecuAddress: '7E9' } },
      { record: { ecuAddress: '7e8' } },
      { record: { ecuAddress: '7E8' } },
      { record: { ecuAddress: '' } },
    ] as unknown as DiscoveryObservation[];
    expect(collectEcuAddresses(obs)).toEqual(['7E8', '7E9']);
  });

  it('assembleFingerprintInput: VID vehicle/adapter + discovery ECU birleşir', () => {
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678', make: 'Renault', model: 'Trafic' });
    useVidStore.getState().updateObdAdapterInfo({ lastProtocolNum: '6', lastAddress: 'AA:BB:CC:DD' });
    const obs = [{ record: { ecuAddress: '7E8' } }] as unknown as DiscoveryObservation[];
    const input = assembleFingerprintInput(useVidStore.getState(), obs);
    expect(input.vin).toBe('VF1BM0A0H12345678');
    expect(input.protocol).toBe('6');
    expect(input.ecuAddresses).toEqual(['7E8']);
    expect(input.metadata?.adapterMac).toBe('AA:BB:CC:DD');
    expect(input.metadata?.label).toBe('Renault Trafic');
  });
});

/* ── Otomatik üretici (useVidStore aboneliği) ─────────────────────────────── */
describe('AutomaticVehicleFingerprint — canlı abonelik', () => {
  it('araç bilgisi hazırken bağlantı tamamlanınca fingerprint otomatik oluşur', () => {
    const s = store();
    const svc = new AutomaticVehicleFingerprint(s, () => useVidStore.getState(), () => []);
    const stop = svc.start();
    expect(s.size).toBe(0); // henüz bağlantı yok
    // VIN hazır (henüz bağlantı tamamlanmadı → tetiklenmez)
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    expect(s.size).toBe(0);
    // Bağlantı tamamlandı (VIN/protocol/ECU hazır) → otomatik üretim
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6', lastAddress: 'MAC1' });
    expect(s.size).toBe(1);
    expect(s.list()[0].vin).toBe('VF1BM0A0H12345678');
    stop();
  });

  it('kimlik-imza guard: telemetri tick\'i YENİ kayıt/sourceCount üretmez (hot-path korunur)', () => {
    const s = store();
    const svc = new AutomaticVehicleFingerprint(s, () => useVidStore.getState(), () => []);
    const stop = svc.start();
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    expect(s.size).toBe(1);
    const afterConnect = (s.list()[0] as LearnedVehicleFingerprint).sourceCount;
    // Yalnız telemetri değişimleri — kimlik imzası değişmez.
    useVidStore.getState().updateTelemetryInfo({ trustScore: 0.9, thermalStatus: 'WARM' });
    useVidStore.getState().updateTelemetryInfo({ trustScore: 0.8, healthState: 'MONITOR' });
    expect(s.size).toBe(1);
    expect((s.list()[0] as LearnedVehicleFingerprint).sourceCount).toBe(afterConnect); // artmadı
    stop();
  });

  it('stop() sonrası VID değişimi işlenmez (zero-leak)', () => {
    const s = store();
    const svc = new AutomaticVehicleFingerprint(s, () => useVidStore.getState(), () => []);
    const stop = svc.start();
    stop();
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    expect(s.size).toBe(0);
  });

  it('Discovery bağlı olsa da davranış değişmez (capture/queue DEĞİŞMEZ)', () => {
    // Gerçek discovery servisine katalog-dışı sinyal ekle → getObservations dolu olsun.
    const disc = new DiscoveryCaptureService({ cache: new DiscoveryCache(), queue: new DiscoveryQueue(`avf-disc-${_k++}`), emitDiagnostic: vi.fn() });
    disc.capture({ pidOrDid: '242E', discoverySource: 'DID', mode: '22', ecuAddress: '7E0' });
    const capturedBefore = disc.getCaptured().length;

    const s = store();
    const svc = new AutomaticVehicleFingerprint(s, () => useVidStore.getState(), () => disc.getObservations());
    const stop = svc.start();
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });

    // Fingerprint oluştu VE discovery kuyruğu/gözlemi HİÇ değişmedi (salt-okuma).
    expect(s.size).toBe(1);
    expect(s.list()[0].ecuAddresses).toContain('7E0'); // discovery ECU'su fingerprint'e girdi
    expect(disc.getCaptured().length).toBe(capturedBefore); // queue davranışı değişmedi
    stop();
  });

  it('FAIL-SOFT: depo hata fırlatsa da abonelik/akış çökmez', () => {
    const throwing = {
      load: () => { throw new Error('disk fail'); },
      save: () => { throw new Error('disk fail'); },
    } as unknown as VehicleFingerprintStore;
    const svc = new AutomaticVehicleFingerprint(throwing, () => useVidStore.getState(), () => []);
    const stop = svc.start();
    expect(() => {
      useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
      useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    }).not.toThrow(); // OBD akışı (store yazımı) etkilenmez
    stop();
  });

  it('singleton export & fingerprintInputSignature dedup anahtarı', () => {
    const a = fingerprintInputSignature({ vin: 'vf1', protocol: '6', ecuAddresses: ['7E9', '7E8'] });
    const b = fingerprintInputSignature({ vin: 'VF1', protocol: '6', ecuAddresses: ['7e8', '7e9'] });
    expect(a).toBe(b); // normalize + sıra-bağımsız
  });
});
