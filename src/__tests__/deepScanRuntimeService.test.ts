/**
 * deepScanRuntimeService — Deep Scan runtime foundation testleri.
 *
 * Servis saf bir durum makinesidir (timer/abonelik/native yok) → enjekte edilen
 * `now()` ile tamamen deterministik test edilir. Canlı servis mock'u GEREKMEZ.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* Kaynak-metin kilitleri: runtime readFileSync yerine Vite `?raw` (transform-time
   sabit → paralel koşumda flake'e bağışık; bkz. regression.guards.test.ts). */
import systemBootSrc from '../platform/system/SystemBoot.ts?raw';
import deepScanServiceSrc from '../platform/deepScan/deepScanRuntimeService.ts?raw';

import {
  DeepScanRuntimeService,
  deepScanRuntimeService,
} from '../platform/deepScan/deepScanRuntimeService';
import {
  canRunPhase,
  clampProgress,
  isActivePhase,
  isCriticalPhase,
  monotonicProgress,
  normalizeFingerprintHash,
  normalizeIgnition,
  resolveScanMode,
  sanitizeText,
  ACTIVE_PHASES,
  MAX_WARNINGS,
  OFFLINE_PHASES,
  type DeepScanEvent,
} from '../platform/deepScan/deepScanModel';

/** Geçerli 16-hane hex parmak izi. */
const HASH = 'a1b2c3d4e5f60718';

let now = 1_000_000;
let svc: DeepScanRuntimeService;

function makeService(): DeepScanRuntimeService {
  return new DeepScanRuntimeService({ now: () => now });
}

/** Kontak doğrulanmış, taraması başlatılmış servis. */
function startedWithIgnition(hasCompletedScanBefore = false): DeepScanRuntimeService {
  const s = makeService();
  s.startScan({ vehicleFingerprintHash: HASH, hasCompletedScanBefore, ignitionConfirmed: true });
  return s;
}

/** Olayları toplayan dinleyici. */
function collector(s: DeepScanRuntimeService): { events: DeepScanEvent[]; unsub: () => void } {
  const events: DeepScanEvent[] = [];
  const unsub = s.subscribe((e) => events.push(e));
  return { events, unsub };
}

beforeEach(() => { now = 1_000_000; svc = makeService(); });
afterEach(() => { svc.dispose(); vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Başlangıç durumu
 * ════════════════════════════════════════════════════════════════════════ */

describe('başlangıç durumu', () => {
  it('idle ve tüm sayaçlar sıfır', () => {
    const snap = svc.getSnapshot();

    expect(snap.status).toBe('idle');
    expect(snap.scanId).toBeNull();
    expect(snap.mode).toBeNull();
    expect(snap.phase).toBeNull();
    expect(snap.progressPercent).toBe(0);
    expect(snap.discoveredEcuCount).toBe(0);
    expect(snap.discoveredPidCount).toBe(0);
    expect(snap.discoveredDidCount).toBe(0);
    expect(snap.newDiscoveriesCount).toBe(0);
    expect(snap.changedFirmware).toBe(false);
    expect(snap.changedEcu).toBe(false);
    expect(snap.warnings).toEqual([]);
    expect(snap.errorCode).toBeNull();
    expect(snap.reportSummary).toBeNull();
  });

  it('kontak bilinmiyor (null) — açık VARSAYILMAZ', () => {
    expect(svc.getSnapshot().ignitionConfirmed).toBeNull();
    expect(svc.getSnapshot().ignitionRequired).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2-3. FULL_SCAN / CHANGE_CHECK kararı
 * ════════════════════════════════════════════════════════════════════════ */

describe('tarama modu kararı', () => {
  it('yeni araç (önceki tarama yok) → FULL_SCAN + isFirstScan=true', () => {
    svc.startScan({ vehicleFingerprintHash: HASH, ignitionConfirmed: true });
    const snap = svc.getSnapshot();

    expect(snap.mode).toBe('FULL_SCAN');
    expect(snap.isFirstScan).toBe(true);
  });

  it('öğrenilmiş araç (önceki tarama tamamlanmış) → CHANGE_CHECK + isFirstScan=false', () => {
    svc.startScan({ vehicleFingerprintHash: HASH, hasCompletedScanBefore: true, ignitionConfirmed: true });
    const snap = svc.getSnapshot();

    expect(snap.mode).toBe('CHANGE_CHECK');
    expect(snap.isFirstScan).toBe(false);
  });

  it('resolveScanMode saf kararı — undefined/false → FULL_SCAN, true → CHANGE_CHECK', () => {
    expect(resolveScanMode(undefined)).toBe('FULL_SCAN');
    expect(resolveScanMode(false)).toBe('FULL_SCAN');
    expect(resolveScanMode(true)).toBe('CHANGE_CHECK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4-6. Kontak güvenliği
 * ════════════════════════════════════════════════════════════════════════ */

describe('kontak (ignition) güvenliği — fail-closed', () => {
  it('kontak doğrulanmamışsa startScan → waiting_for_ignition + ignition_required', () => {
    const { events } = collector(svc);
    svc.startScan({ vehicleFingerprintHash: HASH }); // ignitionConfirmed verilmedi → null

    expect(svc.getSnapshot().status).toBe('waiting_for_ignition');
    expect(svc.getSnapshot().ignitionConfirmed).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['scan_started', 'ignition_required']);
  });

  it('kontak kapalıyken (false) aktif scanning fazına GEÇİLEMEZ', () => {
    svc.startScan({ vehicleFingerprintHash: HASH, ignitionConfirmed: false });
    const { events } = collector(svc);

    svc.updatePhase('ecu_discovery'); // aktif faz

    const snap = svc.getSnapshot();
    expect(snap.status).toBe('waiting_for_ignition');
    expect(snap.phase).toBeNull();          // faz DEĞİŞMEDİ
    expect(snap.progressPercent).toBe(0);   // sahte ilerleme yok
    expect(events.some((e) => e.type === 'ignition_required')).toBe(true);
    expect(events.some((e) => e.type === 'phase_changed')).toBe(false);
    expect(snap.warnings.some((w) => w.startsWith('ignition_not_confirmed'))).toBe(true);
  });

  it('kontak BİLİNMİYORken (null) de aktif faz açılmaz — açık varsayılmaz', () => {
    svc.startScan({ vehicleFingerprintHash: HASH, ignitionConfirmed: null });
    svc.updatePhase('standard_pid_discovery');

    expect(svc.getSnapshot().phase).toBeNull();
    expect(svc.getSnapshot().status).toBe('waiting_for_ignition');
  });

  it('kontak kapalıyken OFFLINE analiz fazına izin verilir', () => {
    svc.startScan({ vehicleFingerprintHash: HASH, ignitionConfirmed: false });
    svc.updatePhase('capability_analysis');

    const snap = svc.getSnapshot();
    expect(snap.phase).toBe('capability_analysis');
    expect(snap.status).toBe('analyzing');
    expect(snap.progressPercent).toBeGreaterThan(0);
  });

  it('kontak kapalıyken report_generation ve change_detection çalışır', () => {
    svc.startScan({ ignitionConfirmed: false });
    svc.updatePhase('change_detection');
    expect(svc.getSnapshot().status).toBe('analyzing');
    svc.updatePhase('report_generation');
    expect(svc.getSnapshot().phase).toBe('report_generation');
  });

  it('kontak kapalıyken AKTİF keşif kaydı (PID/DID/ECU/firmware) kabul edilmez', () => {
    svc.startScan({ ignitionConfirmed: false });

    svc.recordEcuDiscovery({ ecuAddress: '7E8' });
    svc.recordPidDiscovery({ pidOrDid: '0C' });
    svc.recordDidDiscovery({ pidOrDid: 'F190' });
    svc.recordFirmwareResult({ changed: true });

    const snap = svc.getSnapshot();
    expect(snap.discoveredEcuCount).toBe(0);
    expect(snap.discoveredPidCount).toBe(0);
    expect(snap.discoveredDidCount).toBe(0);
    expect(snap.changedFirmware).toBe(false); // araca sorgu gitmemiş sayılır
  });

  it('setIgnitionConfirmed(true) beklemedeki taramayı preparing yapar', () => {
    svc.startScan({ ignitionConfirmed: null });
    expect(svc.getSnapshot().status).toBe('waiting_for_ignition');

    svc.setIgnitionConfirmed(true);

    expect(svc.getSnapshot().status).toBe('preparing');
    expect(svc.getSnapshot().ignitionConfirmed).toBe(true);
  });

  it('tarama sırasında kontak kaybedilirse waiting_for_ignition\'a düşer', () => {
    const s = startedWithIgnition();
    s.updatePhase('ecu_discovery');
    expect(s.getSnapshot().status).toBe('scanning');

    s.setIgnitionConfirmed(false);

    expect(s.getSnapshot().status).toBe('waiting_for_ignition');
    s.dispose();
  });

  it('canRunPhase: aktif fazlar yalnız true ile, offline fazlar her koşulda', () => {
    for (const p of ACTIVE_PHASES) {
      expect(canRunPhase(p, true)).toBe(true);
      expect(canRunPhase(p, false)).toBe(false);
      expect(canRunPhase(p, null)).toBe(false);
    }
    for (const p of OFFLINE_PHASES) {
      expect(canRunPhase(p, true)).toBe(true);
      expect(canRunPhase(p, false)).toBe(true);
      expect(canRunPhase(p, null)).toBe(true);
    }
  });

  it('normalizeIgnition yalnız gerçek boolean kabul eder', () => {
    expect(normalizeIgnition(true)).toBe(true);
    expect(normalizeIgnition(false)).toBe(false);
    expect(normalizeIgnition(null)).toBeNull();
    expect(normalizeIgnition(undefined)).toBeNull();
    expect(normalizeIgnition(1)).toBeNull();
    expect(normalizeIgnition('true')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7-10. Faz + ilerleme modeli
 * ════════════════════════════════════════════════════════════════════════ */

describe('faz ve ilerleme modeli', () => {
  it('phase güncelleniyor ve status aktif/offline\'a göre ayarlanıyor', () => {
    const s = startedWithIgnition();

    s.updatePhase('protocol_detection');
    expect(s.getSnapshot().phase).toBe('protocol_detection');
    expect(s.getSnapshot().status).toBe('scanning');

    s.updatePhase('knowledge_update');
    expect(s.getSnapshot().status).toBe('analyzing');
    s.dispose();
  });

  it('progress 0..100 aralığına clamp edilir', () => {
    expect(clampProgress(-50)).toBe(0);
    expect(clampProgress(150)).toBe(100);
    // Imkânsız değerler (NaN/Infinity/sayı olmayan) → 0 (CLAUDE.md sensör sanitizasyonu:
    // sahte ilerleme üretmektense sıfır kabul et).
    expect(clampProgress(NaN)).toBe(0);
    expect(clampProgress(Infinity)).toBe(0);
    expect(clampProgress('42' as unknown)).toBe(0);
    expect(clampProgress(42)).toBe(42);

    const s = startedWithIgnition();
    s.updateProgress(500);
    expect(s.getSnapshot().progressPercent).toBe(100);
    s.dispose();
  });

  it('progress geriye düşmez (monotonik)', () => {
    expect(monotonicProgress(50, 30)).toBe(50);
    expect(monotonicProgress(50, 70)).toBe(70);

    const s = startedWithIgnition();
    s.updateProgress(40);
    s.updateProgress(10);
    expect(s.getSnapshot().progressPercent).toBe(40);
    s.dispose();
  });

  it('faz değişiminde progress mantıklı artar, geri fazda düşmez', () => {
    const s = startedWithIgnition();

    s.updatePhase('vehicle_identity');
    const p1 = s.getSnapshot().progressPercent;
    s.updatePhase('ecu_discovery');
    const p2 = s.getSnapshot().progressPercent;
    expect(p2).toBeGreaterThan(p1);

    s.updatePhase('vehicle_identity'); // geri dönüş — progress DÜŞMEZ
    expect(s.getSnapshot().progressPercent).toBe(p2);
    s.dispose();
  });

  it('completeScan → progress 100 + completed + rapor özeti', () => {
    const s = startedWithIgnition();
    s.updatePhase('ecu_discovery');
    now += 5_000;
    s.completeScan({ note: 'tarama tamam' });

    const snap = s.getSnapshot();
    expect(snap.status).toBe('completed');
    expect(snap.progressPercent).toBe(100);
    expect(snap.completedAt).toBe(now);
    expect(snap.reportSummary).not.toBeNull();
    expect(snap.reportSummary!.mode).toBe('FULL_SCAN');
    expect(snap.reportSummary!.durationMs).toBe(5_000);
    expect(snap.reportSummary!.note).toBe('tarama tamam');
    s.dispose();
  });

  it('failed/cancelled durumunda mevcut progress KORUNUR (100 yazılmaz)', () => {
    const a = startedWithIgnition();
    a.updateProgress(37);
    a.failScan('ecu_timeout');
    expect(a.getSnapshot().progressPercent).toBe(37);
    expect(a.getSnapshot().status).toBe('failed');
    a.dispose();

    const b = startedWithIgnition();
    b.updateProgress(58);
    b.cancelScan('user');
    expect(b.getSnapshot().progressPercent).toBe(58);
    expect(b.getSnapshot().status).toBe('cancelled');
    b.dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11-16. Keşif sayaçları / değişiklik tespiti
 * ════════════════════════════════════════════════════════════════════════ */

describe('keşif sayaçları', () => {
  it('ECU discovery sayısı doğru', () => {
    const s = startedWithIgnition();
    s.recordEcuDiscovery({ ecuAddress: '7E8' });
    s.recordEcuDiscovery({ ecuAddress: '7E9' });
    expect(s.getSnapshot().discoveredEcuCount).toBe(2);
    s.dispose();
  });

  it('PID discovery sayısı doğru (ECU başına ayrı sinyal)', () => {
    const s = startedWithIgnition();
    s.recordPidDiscovery({ pidOrDid: '0C', ecuAddress: '7E8' });
    s.recordPidDiscovery({ pidOrDid: '0D', ecuAddress: '7E8' });
    s.recordPidDiscovery({ pidOrDid: '0C', ecuAddress: '7E9' }); // farklı ECU → ayrı
    expect(s.getSnapshot().discoveredPidCount).toBe(3);
    s.dispose();
  });

  it('DID discovery sayısı doğru', () => {
    const s = startedWithIgnition();
    s.recordDidDiscovery({ pidOrDid: 'F190' });
    s.recordDidDiscovery({ pidOrDid: 'F1A0' });
    expect(s.getSnapshot().discoveredDidCount).toBe(2);
    s.dispose();
  });

  it('duplicate keşif sayacı ŞİŞİRMEZ (normalize + dedup)', () => {
    const s = startedWithIgnition();

    s.recordEcuDiscovery({ ecuAddress: '7E8' });
    s.recordEcuDiscovery({ ecuAddress: '7e8' });    // küçük harf
    s.recordEcuDiscovery({ ecuAddress: ' 0x7E8 ' }); // 0x + boşluk
    s.recordPidDiscovery({ pidOrDid: '0C', ecuAddress: '7E8' });
    s.recordPidDiscovery({ pidOrDid: '0c', ecuAddress: '7E8' });
    s.recordDidDiscovery({ pidOrDid: 'F190' });
    s.recordDidDiscovery({ pidOrDid: 'f190' });

    const snap = s.getSnapshot();
    expect(snap.discoveredEcuCount).toBe(1);
    expect(snap.discoveredPidCount).toBe(1);
    expect(snap.discoveredDidCount).toBe(1);
    s.dispose();
  });

  it('newDiscoveriesCount yalnız isNew=true olan TEKİL sinyalleri sayar', () => {
    const s = startedWithIgnition();
    s.recordPidDiscovery({ pidOrDid: '0C', isNew: false });
    s.recordPidDiscovery({ pidOrDid: '78', isNew: true });
    s.recordPidDiscovery({ pidOrDid: '78', isNew: true }); // duplicate
    s.recordDidDiscovery({ pidOrDid: 'F190', isNew: true });

    expect(s.getSnapshot().newDiscoveriesCount).toBe(2);
    s.dispose();
  });

  it('firmware değişikliği işaretleniyor', () => {
    const s = startedWithIgnition();
    s.recordFirmwareResult({ ecuAddress: '7E8', changed: false });
    expect(s.getSnapshot().changedFirmware).toBe(false);
    s.recordFirmwareResult({ ecuAddress: '7E9', changed: true });
    expect(s.getSnapshot().changedFirmware).toBe(true);

    s.completeScan();
    expect(s.getSnapshot().reportSummary!.firmwareCheckedCount).toBe(2);
    s.dispose();
  });

  it('ECU değişikliği recordChangeDetection ile işaretleniyor (offline — kontak gerekmez)', () => {
    svc.startScan({ ignitionConfirmed: false });
    const { events } = collector(svc);

    svc.recordChangeDetection({ changedEcu: true, reason: 'yeni ECU adresi' });

    expect(svc.getSnapshot().changedEcu).toBe(true);
    expect(events.some((e) => e.type === 'change_detected')).toBe(true);
  });

  it('recordChangeDetection değişiklik yoksa olay yaymaz', () => {
    svc.startScan({ ignitionConfirmed: false });
    const { events } = collector(svc);

    svc.recordChangeDetection({ changedEcu: false, changedFirmware: false });

    expect(events.some((e) => e.type === 'change_detected')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 17. Warnings bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('uyarılar (warnings)', () => {
  it('bounded — tavanı aşmaz, en eskisi düşer', () => {
    const s = startedWithIgnition();
    for (let i = 0; i < MAX_WARNINGS + 20; i++) {
      s.reportPhaseFailure('capability_analysis', `err${i}`);
    }

    const w = s.getSnapshot().warnings;
    expect(w.length).toBe(MAX_WARNINGS);
    expect(w[w.length - 1]).toContain(`err${MAX_WARNINGS + 19}`); // en yenisi korunur
    s.dispose();
  });

  it('kritik olmayan faz hatası taramayı düşürmez (fail-soft, atlanır)', () => {
    const s = startedWithIgnition();
    s.updatePhase('ecu_discovery');
    s.reportPhaseFailure('firmware_inventory', 'no_response');

    expect(s.getSnapshot().status).toBe('scanning'); // devam
    expect(s.getSnapshot().warnings.some((x) => x.includes('phase_skipped'))).toBe(true);
    s.dispose();
  });

  it('kritik faz hatası (kimlik/protokol) taramayı failed yapar', () => {
    expect(isCriticalPhase('vehicle_identity')).toBe(true);
    expect(isCriticalPhase('protocol_detection')).toBe(true);
    expect(isCriticalPhase('firmware_inventory')).toBe(false);

    const s = startedWithIgnition();
    s.reportPhaseFailure('protocol_detection', 'no_protocol');

    expect(s.getSnapshot().status).toBe('failed');
    expect(s.getSnapshot().errorCode).toContain('protocol_detection');
    s.dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 18-19. Dinleyiciler
 * ════════════════════════════════════════════════════════════════════════ */

describe('olay aboneliği', () => {
  it('subscribe/unsubscribe çalışıyor', () => {
    const s = startedWithIgnition();
    const { events, unsub } = collector(s);

    s.updatePhase('ecu_discovery');
    const count = events.length;
    expect(count).toBeGreaterThan(0);

    unsub();
    s.updateProgress(90);
    expect(events.length).toBe(count); // artık olay gelmiyor
    expect(s.listenerCount).toBe(0);
    s.dispose();
  });

  it('aynı dinleyici iki kez eklenirse duplicate oluşmaz', () => {
    const s = startedWithIgnition();
    const fn = vi.fn();
    s.subscribe(fn);
    s.subscribe(fn);
    s.subscribe(fn);

    expect(s.listenerCount).toBe(1);
    s.updateProgress(50);
    expect(fn).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('dinleyici hatası servisi çökertmez ve raporlanır', () => {
    vi.spyOn(console, 'error').mockImplementation(() => { /* sessiz */ });
    const s = startedWithIgnition();
    const good = vi.fn();

    s.subscribe(() => { throw new Error('dinleyici patladı'); });
    s.subscribe(good);

    expect(() => s.updateProgress(50)).not.toThrow();
    expect(good).toHaveBeenCalled();                          // diğer dinleyici çalıştı
    expect(s.getSnapshot().progressPercent).toBe(50);         // durum bozulmadı
    expect(s.getSnapshot().warnings.some((w) => w.startsWith('listener_error'))).toBe(true);
    s.dispose();
  });

  it('olay zarfı dondurulmuş snapshot taşır', () => {
    const s = startedWithIgnition();
    const { events } = collector(s);
    s.updateProgress(10);

    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0].snapshot)).toBe(true);
    s.dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 20-25. Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('yaşam döngüsü', () => {
  it('startScan idempotent — ikinci çağrı yeni scanId üretmez', () => {
    svc.startScan({ vehicleFingerprintHash: HASH, ignitionConfirmed: true });
    const id = svc.getSnapshot().scanId;

    svc.startScan({ vehicleFingerprintHash: HASH, hasCompletedScanBefore: true, ignitionConfirmed: true });

    expect(svc.getSnapshot().scanId).toBe(id);
    expect(svc.getSnapshot().mode).toBe('FULL_SCAN'); // ilk karar korundu
  });

  it('cancel çalışıyor ve terminal durumda mutasyon kabul edilmez', () => {
    const s = startedWithIgnition();
    s.updatePhase('ecu_discovery');
    s.cancelScan('kullanıcı iptali');

    expect(s.getSnapshot().status).toBe('cancelled');

    s.updateProgress(99);
    s.updatePhase('report_generation');
    s.recordEcuDiscovery({ ecuAddress: '7EA' });

    expect(s.getSnapshot().status).toBe('cancelled');
    expect(s.getSnapshot().progressPercent).toBeLessThan(99);
    expect(s.getSnapshot().discoveredEcuCount).toBe(0);
    s.dispose();
  });

  it('pause/resume çalışıyor', () => {
    const s = startedWithIgnition();
    s.updatePhase('ecu_discovery');
    const { events } = collector(s);

    s.pauseScan('termal');
    expect(s.getSnapshot().status).toBe('paused');
    s.updatePhase('standard_pid_discovery'); // duraklamışken faz değişmez
    expect(s.getSnapshot().phase).toBe('ecu_discovery');

    s.resumeScan();
    expect(s.getSnapshot().status).toBe('scanning');
    expect(events.map((e) => e.type)).toContain('scan_paused');
    expect(events.map((e) => e.type)).toContain('scan_resumed');
    s.dispose();
  });

  it('duraklamışken kontak kaybedilirse resume aktif faza dönmez', () => {
    const s = startedWithIgnition();
    s.updatePhase('ecu_discovery');
    s.pauseScan();
    s.setIgnitionConfirmed(false);

    s.resumeScan();

    expect(s.getSnapshot().status).toBe('waiting_for_ignition');
    s.dispose();
  });

  it('reset çalışıyor — durum idle\'a döner, dinleyiciler KORUNUR', () => {
    const s = startedWithIgnition();
    s.recordEcuDiscovery({ ecuAddress: '7E8' });
    s.updateProgress(50);
    const fn = vi.fn();
    s.subscribe(fn);

    s.reset();

    const snap = s.getSnapshot();
    expect(snap.status).toBe('idle');
    expect(snap.scanId).toBeNull();
    expect(snap.progressPercent).toBe(0);
    expect(snap.discoveredEcuCount).toBe(0);
    expect(snap.ignitionConfirmed).toBeNull();
    expect(s.listenerCount).toBe(1); // dinleyici korundu

    s.startScan({ ignitionConfirmed: true }); // reset sonrası yeniden başlatılabilir
    expect(s.getSnapshot().status).toBe('preparing');
    s.dispose();
  });

  it('dispose zero-leak — dinleyiciler bırakılır, sonraki çağrılar no-op', () => {
    const s = startedWithIgnition();
    const fn = vi.fn();
    s.subscribe(fn);
    expect(s.listenerCount).toBe(1);

    s.dispose();

    expect(s.listenerCount).toBe(0);
    expect(s.isDisposed).toBe(true);

    s.startScan({ ignitionConfirmed: true });
    s.updateProgress(80);
    s.recordEcuDiscovery({ ecuAddress: '7E8' });

    expect(s.getSnapshot().status).toBe('idle');
    expect(s.getSnapshot().progressPercent).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('dispose idempotent', () => {
    const s = startedWithIgnition();
    s.dispose();
    expect(() => s.dispose()).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 26-27. Immutability
 * ════════════════════════════════════════════════════════════════════════ */

describe('immutability', () => {
  it('snapshot ve warnings dizisi dondurulmuştur', () => {
    const s = startedWithIgnition();
    s.reportPhaseFailure('capability_analysis', 'x');
    const snap = s.getSnapshot();

    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.warnings)).toBe(true);

    const mutable = snap as unknown as { progressPercent: number };
    try { mutable.progressPercent = 99; } catch { /* strict mode → TypeError */ }
    expect(snap.progressPercent).not.toBe(99);
    s.dispose();
  });

  it('rapor özeti dondurulmuştur', () => {
    const s = startedWithIgnition();
    s.completeScan();
    expect(Object.isFrozen(s.getSnapshot().reportSummary)).toBe(true);
    s.dispose();
  });

  it('girdi nesnelerini MUTASYONA UĞRATMAZ', () => {
    const s = startedWithIgnition();
    const start = { vehicleFingerprintHash: HASH, hasCompletedScanBefore: true, ignitionConfirmed: true };
    const ecu = { ecuAddress: '7E8', isNew: true };
    const pid = { pidOrDid: '0C', ecuAddress: '7E8', isNew: true };
    const before = JSON.stringify([start, ecu, pid]);

    s.recordEcuDiscovery(ecu);
    s.recordPidDiscovery(pid);
    svc.startScan(start);

    expect(JSON.stringify([start, ecu, pid])).toBe(before);
    s.dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 28. Gizlilik
 * ════════════════════════════════════════════════════════════════════════ */

describe('gizlilik — hassas veri snapshot\'a sızmaz', () => {
  it('VIN parmak izi hash\'i olarak KABUL EDİLMEZ (17 karakter kapısı)', () => {
    svc.startScan({ vehicleFingerprintHash: 'WF0AXXTTRAJA12345', ignitionConfirmed: true });

    const snap = svc.getSnapshot();
    expect(snap.vehicleFingerprintHash).toBeNull();
    expect(JSON.stringify(snap)).not.toContain('WF0AXXTTRAJA12345');
    expect(snap.warnings).toContain('invalid_fingerprint_hash');
  });

  it('geçerli hash korunur', () => {
    svc.startScan({ vehicleFingerprintHash: HASH, ignitionConfirmed: true });
    expect(svc.getSnapshot().vehicleFingerprintHash).toBe(HASH);
  });

  it('normalizeFingerprintHash: VIN / serbest metin / kısa değer reddedilir', () => {
    expect(normalizeFingerprintHash(HASH)).toBe(HASH);
    expect(normalizeFingerprintHash('A1B2C3D4E5F60718')).toBe(HASH); // büyük harf → küçük
    expect(normalizeFingerprintHash('WF0AXXTTRAJA12345')).toBeNull(); // 17 = VIN
    expect(normalizeFingerprintHash('Renault Trafic')).toBeNull();
    expect(normalizeFingerprintHash('abc')).toBeNull();
    expect(normalizeFingerprintHash(42)).toBeNull();
  });

  it('uyarı ve hata metinlerinden MAC / koordinat / ham CAN / secret temizlenir', () => {
    const s = startedWithIgnition();
    s.reportPhaseFailure('capability_analysis', 'mac AA:BB:CC:DD:EE:FF');
    s.reportPhaseFailure('capability_analysis', 'konum 40.9901, 29.0250');
    s.reportPhaseFailure('capability_analysis', 'frame 7E803410C1AF8');
    s.failScan('key sk_live_abcdefghijklmnop');

    const snap = s.getSnapshot();
    const json = JSON.stringify(snap);
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(json).not.toContain('40.9901');
    expect(json).not.toContain('7E803410C1AF8');
    expect(json).not.toContain('sk_live_abcdefghijklmnop');
    expect(json).toContain('[redacted]');
    s.dispose();
  });

  it('sanitizeText saf fonksiyonu girdiyi bozmadan temizler', () => {
    expect(sanitizeText('VIN WF0AXXTTRAJA12345 var')).toBe('VIN [redacted] var');
    expect(sanitizeText('mac 00:11:22:33:44:55')).toBe('mac [redacted]');
    expect(sanitizeText(123)).toBe('');
    expect(sanitizeText('temiz metin')).toBe('temiz metin');
    expect(sanitizeText('x'.repeat(300)).length).toBe(160);
  });

  it('snapshot ECU adresi / ham hex TAŞIMAZ — yalnız sayım', () => {
    const s = startedWithIgnition();
    s.recordEcuDiscovery({ ecuAddress: '18DAF110' });
    s.recordPidDiscovery({ pidOrDid: '0C', ecuAddress: '18DAF110' });

    const json = JSON.stringify(s.getSnapshot());
    expect(json).not.toContain('18DAF110');
    expect(s.getSnapshot().discoveredEcuCount).toBe(1);
    s.dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 29-30. Yan etki yok / wiring yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('foundation güvencesi — yan etki ve wiring yok', () => {
  it('SystemBoot Deep Scan servisini BAŞLATMAZ (wiring yok)', () => {
    expect(systemBootSrc).not.toContain('deepScan');
    expect(systemBootSrc).not.toContain('DeepScan');
  });

  it('modül import\'u yan etki üretmez — tekil servis idle ve dinleyicisiz', () => {
    expect(deepScanRuntimeService.getSnapshot().status).toBe('idle');
    expect(deepScanRuntimeService.getSnapshot().scanId).toBeNull();
    expect(deepScanRuntimeService.listenerCount).toBe(0);
    expect(deepScanRuntimeService.isDisposed).toBe(false);
  });

  it('pasif servis (tarama başlatılmamış) hiçbir mutasyonu kabul etmez', () => {
    const s = makeService();

    s.updatePhase('ecu_discovery');
    s.updateProgress(50);
    s.recordEcuDiscovery({ ecuAddress: '7E8' });
    s.completeScan();
    s.pauseScan();

    const snap = s.getSnapshot();
    expect(snap.status).toBe('idle');
    expect(snap.phase).toBeNull();
    expect(snap.progressPercent).toBe(0);
    expect(snap.discoveredEcuCount).toBe(0);
    expect(snap.reportSummary).toBeNull();
    s.dispose();
  });

  it('deepScanRuntimeService hiçbir OBD/discovery servisini import etmez', () => {
    const imports = deepScanServiceSrc.match(/from\s+'[^']+'/g) ?? [];
    expect(imports).toEqual(["from './deepScanModel'"]); // TEK import: saf model
  });

  it('isActivePhase sınıflandırması aktif/offline fazları doğru ayırır', () => {
    expect(isActivePhase('ecu_discovery')).toBe(true);
    expect(isActivePhase('firmware_inventory')).toBe(true);
    expect(isActivePhase('capability_analysis')).toBe(false);
    expect(isActivePhase('report_generation')).toBe(false);
  });
});
