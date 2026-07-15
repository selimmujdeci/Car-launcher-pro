/**
 * OBD-OS-F4-4 (FleetKB öğrenme) + OBD-OS-F4-5 (servis fonksiyonu kapıları).
 *
 * F4-4 KİLİDİ: hafızadaki bilgi İDDİADIR, kanıt değil. Araç değişmiş olabilir (sahada
 * YAŞANDI: dongle Doblo→Trafic). Çelişkide ARACA inanılır, hafızaya değil.
 *
 * F4-5 KİLİDİ: araca yazan hiçbir işlem, TÜM kapılar açılmadan izin ALMAZ.
 */
import { describe, it, expect } from 'vitest';
import {
  buildFingerprint, learnProfile, profileConfidence, suggestScanTargets, diffProfile,
  type FleetProfile,
} from '../platform/obd/fleetKb';
import { buildTopology, emptyTopology } from '../platform/obd/ecuDiscovery';
import { evaluateServiceRoutine, SERVICE_ROUTINES } from '../platform/obd/serviceFunctions';
import type { WriteGateContext } from '../platform/obd/writeGate';

const NOW = 1_700_000_000_000;
const twoEcus = () => buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', NOW);

/* ═════════════════ F4-4 — FleetKB ═════════════════ */

describe('OBD-OS-F4-4 — fingerprint (kimliksiz öğrenme YASAK)', () => {
  it('VIN varsa VIN kullanılır (en güçlü kimlik)', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    expect(fp.source).toBe('vin');
    expect(fp.fingerprint).toBe('VF1BM0A0H12345678');
  });

  it('VIN yoksa ECU+PID imzası türetilir (aynı model → aynı imza)', () => {
    const a = buildFingerprint(null, twoEcus().ecus, 19)!;
    const b = buildFingerprint(null, twoEcus().ecus, 19)!;
    expect(a.source).toBe('signature');
    expect(a.fingerprint).toBe(b.fingerprint);   // deterministik
  });

  it('🔒 KİLİT: hiç kanıt yoksa fingerprint YOK → öğrenme yapılmaz', () => {
    // Yanlış araca yanlış profil yüklemek, hiç profil yüklememekten KÖTÜDÜR.
    expect(buildFingerprint(null, [], 0)).toBeNull();
  });
});

describe('OBD-OS-F4-4 — öğrenme ve güven', () => {
  it('ilk gözlem → observationCount 1; aynı araç tekrar → artar', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    const p1 = learnProfile(null, fp, twoEcus(), ['7E0'], NOW);
    expect(p1.observationCount).toBe(1);

    const p2 = learnProfile(p1, fp, twoEcus(), ['7E0'], NOW + 1000);
    expect(p2.observationCount).toBe(2);
    expect(profileConfidence(p2)).toBeGreaterThan(profileConfidence(p1));
  });

  it('🔒 KİLİT: güven 1’e ASLA ulaşmaz (araç her an değişebilir)', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    let p = learnProfile(null, fp, twoEcus(), [], NOW);
    for (let i = 0; i < 50; i++) p = learnProfile(p, fp, twoEcus(), [], NOW);
    expect(profileConfidence(p)).toBeLessThan(1);
  });

  it('🔒 KİLİT: ECU artık yanıt vermiyorsa hafızada TUTULMAZ (araca inan, hafızaya değil)', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    const p1 = learnProfile(null, fp, twoEcus(), [], NOW);
    expect(p1.ecus).toHaveLength(2);

    // Bu sefer yalnız motor yanıtladı (ikinci ECU söküldü/bozuldu).
    const onlyEngine = buildTopology('7E8 06 41 00 BE', NOW);
    const p2 = learnProfile(p1, fp, onlyEngine, [], NOW);
    expect(p2.ecus).toHaveLength(1);                 // hafıza CANLI kanıta göre KÜÇÜLDÜ
    expect(p2.ecus[0]!.txHeader).toBe('7E0');
  });
});

describe('OBD-OS-F4-4 — araç değişimi tespiti (sahada yaşanan vaka)', () => {
  it('🔒 KİLİT: hiç ortak ECU yoksa → BAŞKA ARAÇ (dongle taşındı)', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    const profile = learnProfile(null, fp, twoEcus(), [], NOW);

    // Dongle başka araca takıldı: 29-bit adresli, tamamen farklı ECU'lar.
    const other = buildTopology('18DAF110 06 41 00 BE', NOW);
    const d = diffProfile(profile, other);
    expect(d.vehicleChanged).toBe(true);
    expect(d.missing).toContain('7E0');
  });

  it('aynı araç + yeni ECU → araç değişimi DEĞİL, sadece yeni keşif', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    const profile = learnProfile(null, fp, twoEcus(), [], NOW);

    const richer = buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80\r\n7EA 06 41 00 80', NOW);
    const d = diffProfile(profile, richer);
    expect(d.vehicleChanged).toBe(false);
    expect(d.added).toContain('7E2');
    expect(d.missing).toEqual([]);
  });

  it('araç hiç yanıt vermiyorsa "araç değişti" DENMEZ (bağlantı sorunu olabilir)', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    const profile = learnProfile(null, fp, twoEcus(), [], NOW);
    const d = diffProfile(profile, emptyTopology());
    expect(d.vehicleChanged).toBe(false);   // kanıt yok → suçlama yok
  });

  it('bilinmeyen araç → tam keşif önerilir', () => {
    expect(suggestScanTargets(null).ecus).toEqual([]);
    expect(suggestScanTargets(null).hint).toMatch(/tam keşif/);
  });

  it('bilinen araç → hazır hedefler, ama "canlı doğrulanacak" notuyla', () => {
    const fp = buildFingerprint('VF1BM0A0H12345678', twoEcus().ecus, 19)!;
    const p: FleetProfile = learnProfile(null, fp, twoEcus(), ['7E0'], NOW);
    const s = suggestScanTargets(p);
    expect(s.ecus).toHaveLength(2);
    expect(s.udsFirst).toContain('7E0');
    expect(s.hint).toMatch(/canlı doğrulanacak/);   // hafıza KANIT DEĞİL
  });
});

/* ═════════════════ F4-5 — Servis fonksiyonu kapıları ═════════════════ */

const okGate = (over: Partial<WriteGateContext> = {}): WriteGateContext => ({
  connectionState: 'connected',
  speedKmh: 0,
  rpm: 0,
  lastSeenMs: NOW - 500,
  nowMs: NOW,
  confirmed: true,
  ...over,
});

describe('OBD-OS-F4-5 — servis fonksiyonu ÇOK-KAPILI yazma', () => {
  it('tüm kapılar açık + motor kapalı → servis sıfırlama İZİNLİ', () => {
    const d = evaluateServiceRoutine({
      kind: 'service_reset', gate: okGate(), supported: true, riskAcknowledged: true,
    });
    expect(d.allowed).toBe(true);
  });

  it('🔒 KİLİT: araç HAREKET HALİNDE → reddedilir (WriteGate)', () => {
    const d = evaluateServiceRoutine({
      kind: 'service_reset', gate: okGate({ speedKmh: 30 }), supported: true, riskAcknowledged: true,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('write_gate');
  });

  it('🔒 KİLİT: rutin destekli olduğu DOĞRULANMADIYSA çalışmaz (bilinmiyor ≠ destekli)', () => {
    for (const supported of [null, false]) {
      const d = evaluateServiceRoutine({
        kind: 'service_reset', gate: okGate(), supported, riskAcknowledged: true,
      });
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason).toBe('not_supported');
    }
  });

  it('🔒 KİLİT: DPF rejenerasyonu motor ÇALIŞMADAN yapılmaz', () => {
    const d = evaluateServiceRoutine({
      kind: 'dpf_regeneration', gate: okGate({ rpm: 0 }), supported: true, riskAcknowledged: true,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('engine_state');
  });

  it('DPF rejenerasyonu: araç duruyor + motor çalışıyor → izinli', () => {
    const d = evaluateServiceRoutine({
      kind: 'dpf_regeneration', gate: okGate({ rpm: 850 }), supported: true, riskAcknowledged: true,
    });
    expect(d.allowed).toBe(true);
  });

  it('🔒 KİLİT: servis sıfırlama motor ÇALIŞIRKEN yapılmaz', () => {
    const d = evaluateServiceRoutine({
      kind: 'service_reset', gate: okGate({ rpm: 850 }), supported: true, riskAcknowledged: true,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('engine_state');
  });

  it('🔒 KİLİT: motor durumu BİLİNMİYORSA (rpm -1) fail-closed reddedilir', () => {
    const d = evaluateServiceRoutine({
      kind: 'dpf_regeneration', gate: okGate({ rpm: -1 }), supported: true, riskAcknowledged: true,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('engine_state');
  });

  it('🔒 KİLİT: risk KABUL EDİLMEDİYSE çalışmaz — riski görmeden verilen onay, onay DEĞİLDİR', () => {
    const d = evaluateServiceRoutine({
      kind: 'dpf_regeneration', gate: okGate({ rpm: 850 }), supported: true, riskAcknowledged: false,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('risk_not_ack');
      expect(d.userMessage).toBe(SERVICE_ROUTINES.dpf_regeneration.risk);   // riski AÇIKÇA söyler
      expect(d.userMessage).toMatch(/Egzoz sıcaklığı/);
    }
  });

  it('her rutinin riski TANIMLI (boş risk metni yasak — bilgilendirilmiş rıza şartı)', () => {
    for (const spec of Object.values(SERVICE_ROUTINES)) {
      expect(spec.risk.length, `${spec.kind} risk metni boş`).toBeGreaterThan(20);
    }
  });
});
