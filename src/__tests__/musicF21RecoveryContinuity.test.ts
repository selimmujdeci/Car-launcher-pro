/**
 * musicF21RecoveryContinuity.test.ts — MUSIC F21 · Offline / kurtarma / süreklilik.
 *
 * ÖLÇÜLEN GERÇEK (F21 denetimi): kurtarma mimarisi ZATEN sağlamdı —
 * `restoreListeningSession` ASLA çalmaz, süreklilik `UNKNOWN` başlar, YouTube
 * kuyrukta `piped://` SENTINEL taşır (adres çalma anında çözülür).
 *
 * KAPATILAN AÇIK: doğrudan `http(s)` akış adresi taşıyan sağlayıcı girdileri
 * kalıcı kayda giriyordu ve saatler sonra "canlı" muamelesi görüyordu.
 *
 * Bu paket şunları KİLİTLER:
 *   · süresi dolmuş uzak adres geri yüklemede DÜŞÜRÜLÜR ve SAYILIR
 *   · sentinel taşıyan sağlayıcı girdisi KORUNUR (çalma anında çözülür)
 *   · otomatik devam FAIL-CLOSED'dur; kontak ölçülemiyorsa ASLA devam etmez
 *   · kullanıcı duraklattıysa kendiliğinden çalma YOK
 *   · çevrimdışıyken ağ gerektiren kaynak dürüstçe TEKLİF edilir
 *   · kontak sinyali UYDURULMAZ (yalnız RPM/gerilim kanıtı)
 *   · kurtarma katmanı çalma BAŞLATMAZ ve ikinci otorite AÇMAZ
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyCacheHealth, classifyEntryFreshness, decideAutoResume, shouldDropOnRestore,
  type AutoResumeInput,
} from '../platform/media/recovery/recoveryModel';
import {
  _resetRecoveryTelemetryForTest, getRecoveryTelemetry, noteEntryFreshness,
} from '../platform/media/recovery/recoveryTelemetry';
import { POLICY_ALLOWS_AUTO_RESUME } from '../platform/media/recovery/recoveryRuntime';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

function resumeInput(over: Partial<AutoResumeInput> = {}): AutoResumeInput {
  return {
    sessionRestored: true,
    playableEntries: 5,
    userPaused: false,
    ignition: 'RUNNING',
    requiresNetwork: false,
    online: true,
    policyAllowsAutoResume: true,
    ...over,
  };
}

beforeEach(() => {
  _resetRecoveryTelemetryForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · GİRDİ TAZELİĞİ — bayat uzak adres canlı sayılmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('F21 · süresi dolmuş uzak adres canlı sayılmaz', () => {
  it('1 · şema sınıflandırması ölçülen gerçeği taşır', () => {
    expect(classifyEntryFreshness('content://media/external/audio/1')).toBe('LOCAL');
    expect(classifyEntryFreshness('file:///storage/x.mp3')).toBe('LOCAL');
    /* Sentinel taşıyanlar bayatlamaz: adres çalma anında çözülür. */
    expect(classifyEntryFreshness('piped://abc123')).toBe('RESOLVE_AT_PLAY');
    expect(classifyEntryFreshness('archive://item')).toBe('RESOLVE_AT_PLAY');
    expect(classifyEntryFreshness('spotify:track:xyz')).toBe('RESOLVE_AT_PLAY');
    /* Doğrudan uzak adres ölmüş olabilir. */
    expect(classifyEntryFreshness('https://cdn.example/audio.mp3')).toBe('EXPIRING_REMOTE');
    expect(classifyEntryFreshness('http://cdn.example/audio.mp3')).toBe('EXPIRING_REMOTE');
    expect(classifyEntryFreshness(null)).toBe('UNKNOWN');
    expect(classifyEntryFreshness('')).toBe('UNKNOWN');
    expect(classifyEntryFreshness('weird:thing')).toBe('UNKNOWN');
  });

  it('2 · yalnız bayat/bilinmeyen düşürülür; yerel ve sentinel KORUNUR', () => {
    expect(shouldDropOnRestore('EXPIRING_REMOTE')).toBe(true);
    expect(shouldDropOnRestore('UNKNOWN')).toBe(true);
    expect(shouldDropOnRestore('LOCAL'), 'yerel girdi düşürülmüş').toBe(false);
    expect(shouldDropOnRestore('RESOLVE_AT_PLAY'), 'sentinel girdi düşürülmüş').toBe(false);
  });

  it('3 · düşürme SESSİZ DEĞİLDİR — sayılır', () => {
    noteEntryFreshness('LOCAL', false);
    noteEntryFreshness('RESOLVE_AT_PLAY', false);
    noteEntryFreshness('EXPIRING_REMOTE', true);
    noteEntryFreshness('UNKNOWN', true);
    const c = getRecoveryTelemetry().counters;
    expect(c.entriesLocal).toBe(1);
    expect(c.entriesResolveAtPlay).toBe(1);
    expect(c.entriesExpiringDropped).toBe(1);
    expect(c.entriesUnknownDropped).toBe(1);
  });

  it('4 · geri yükleme yolu sınıflandırmayı GERÇEKTEN uygular', () => {
    const src = codeOnly(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(src, 'geri yüklemede tazelik sınıflandırması yok')
      .toMatch(/restoreListeningSession[\s\S]{0,3000}classifyEntryFreshness/);
    expect(src).toMatch(/shouldDropOnRestore/);
    /* Geri yükleme HÂLÂ çalmaz. */
    expect(src).toMatch(/playbackClaim: 'NONE'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · OTOMATİK DEVAM — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

describe('F21 · otomatik devam fail-closed', () => {
  it('5 · kanıt zinciri tamamsa RESUME çıkar (referans dal)', () => {
    const r = decideAutoResume(resumeInput());
    expect(r.decision).toBe('RESUME');
    expect(r.reason).toBe('EVIDENCE_COMPLETE');
  });

  it('6 · kontak ÖLÇÜLEMİYORSA asla RESUME olmaz', () => {
    const r = decideAutoResume(resumeInput({ ignition: 'UNKNOWN' }));
    expect(r.decision, 'kontak bilinmezken otomatik çalma verilmiş').not.toBe('RESUME');
    expect(r.decision).toBe('OFFER');
    expect(r.reason).toBe('IGNITION_UNKNOWN');
  });

  it('7 · kontak KAPALIYSA beklenir', () => {
    const r = decideAutoResume(resumeInput({ ignition: 'OFF' }));
    expect(r.decision).toBe('HOLD');
    expect(r.reason).toBe('IGNITION_OFF');
  });

  it('8 · kullanıcı duraklattıysa kendiliğinden ÇALMAZ (niyet korunur)', () => {
    const r = decideAutoResume(resumeInput({ userPaused: true }));
    expect(r.decision).toBe('HOLD');
    expect(r.reason).toBe('USER_PAUSED');
  });

  it('9 · geri yüklenmemiş veya boş kuyrukta karar HOLD', () => {
    expect(decideAutoResume(resumeInput({ sessionRestored: false })).reason).toBe('NOT_RESTORED');
    expect(decideAutoResume(resumeInput({ playableEntries: 0 })).reason).toBe('NO_PLAYABLE');
  });

  it('10 · çevrimdışıyken ağ gerektiren kaynak dürüstçe TEKLİF edilir', () => {
    const r = decideAutoResume(resumeInput({ requiresNetwork: true, online: false }));
    expect(r.decision).toBe('OFFER');
    expect(r.reason).toBe('OFFLINE');
    /* Ağ gerekmeyen (yerel) kaynak çevrimdışı da devam edebilir. */
    expect(decideAutoResume(resumeInput({ requiresNetwork: false, online: false })).decision)
      .toBe('RESUME');
  });

  it('11 · politika kapalıysa en fazla TEKLİF olur', () => {
    const r = decideAutoResume(resumeInput({ policyAllowsAutoResume: false }));
    expect(r.decision).toBe('OFFER');
    expect(r.reason).toBe('POLICY_DENIED');
  });

  it('12 · ÜRETİMDE politika KAPALIDIR — kendiliğinden ses başlamaz', () => {
    expect(POLICY_ALLOWS_AUTO_RESUME, 'UI\'sız otomatik çalma açılmış').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · ÖNBELLEK BOZULMASI
 * ════════════════════════════════════════════════════════════════════════ */

describe('F21 · önbellek bozulması oynatmayı çökertmez', () => {
  it('13 · sağlık sınıflandırması dürüsttür', () => {
    expect(classifyCacheHealth({ present: false, schemaMatches: true, parseFailures: 0 }))
      .toBe('UNKNOWN');
    expect(classifyCacheHealth({ present: true, schemaMatches: false, parseFailures: 0 }))
      .toBe('SCHEMA_MISMATCH');
    expect(classifyCacheHealth({ present: true, schemaMatches: true, parseFailures: 3 }))
      .toBe('CORRUPT');
    expect(classifyCacheHealth({ present: true, schemaMatches: true, parseFailures: 0 }))
      .toBe('HEALTHY');
  });

  it('14 · her önbellek KENDİ şema sürümüne sahiptir (bayat kayıt reddedilir)', () => {
    /* Kilit kör kalmasın: sürüm sabitleri gerçekten var mı. */
    expect(read('src/platform/media/traits/traitRuntime.ts')).toContain('TRAIT_SCHEMA_VERSION');
    expect(read('src/platform/media/sonic/sonicDescriptor.ts')).toContain('SONIC_SCHEMA_VERSION');
    expect(read('src/platform/media/session/sessionPersistence.ts')).toContain('SESSION_SCHEMA');
    expect(read('src/platform/media/transition/transitionPreference.ts'))
      .toContain('TRANSITION_SCHEMA_VERSION');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · MİMARİ SINIRLAR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F21 · kurtarma katmanı ikinci otorite açmaz', () => {
  it('15 · saf model I/O · timer · global durum TAŞIMAZ', () => {
    const raw = read('src/platform/media/recovery/recoveryModel.ts');
    expect(raw.length, 'model okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    const src = codeOnly(raw);
    expect(src).not.toMatch(/setInterval|setTimeout/);
    expect(src, 'saf modelde Date.now var').not.toMatch(/Date\.now/);
    expect(src, 'saf model kalıcılığa yazmış').not.toMatch(/safeStorage|localStorage/);
  });

  it('16 · kurtarma runtime\'ı ÇALMA BAŞLATMAZ ve komut göndermez', () => {
    const src = codeOnly(read('src/platform/media/recovery/recoveryRuntime.ts'));
    expect(src, 'kurtarma çalma başlatmış')
      .not.toMatch(/startLibraryListening|startProviderListening|playByQuery|playSource/);
    expect(src, 'kurtarma native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(src, 'kurtarma gateway\'e komut vermiş').not.toContain('mediaCommandGateway');
    expect(src, 'kurtarma kuyruğa yazmış')
      .not.toMatch(/\b(createQueue|addToQueue|setCurrentIndex|restoreQueue)\s*\(/);
    expect(src, 'kurtarma timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
  });

  it('17 · kontak kanıtı UYDURULMAZ — yalnız ölçülen araç sinyalinden', () => {
    const src = codeOnly(read('src/platform/media/recovery/recoverySources.ts'));
    expect(src, 'kontak kanıtı araç store\'undan okunmuyor')
      .toContain('useUnifiedVehicleStore');
    expect(src).toMatch(/rpm/);
    expect(src).toMatch(/canBatteryVolt/);
    /* Eşik OBD ile AYNI olmalı — ikinci bir gerçek üretilmez. */
    expect(src).toContain('IGNITION_OFF_VOLTAGE');
    const linkLoss = read('src/platform/obd/linkLossLedger.ts');
    const obdThreshold = /LINK_LOSS_IGNITION_OFF_V\s*=\s*([0-9.]+)/.exec(linkLoss)?.[1];
    const mediaThreshold = /IGNITION_OFF_VOLTAGE\s*=\s*([0-9.]+)/.exec(
      read('src/platform/media/recovery/recoverySources.ts'),
    )?.[1];
    expect(obdThreshold, 'OBD eşiği bulunamadı').toBeDefined();
    expect(mediaThreshold, 'media eşiği bulunamadı').toBeDefined();
    expect(Number(mediaThreshold), 'aynı gerçeğe iki farklı eşik verilmiş')
      .toBe(Number(obdThreshold));
  });

  it('18 · LAB kartı salt gözlemdir — kurtarma TETİKLEMEZ', () => {
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(model).toContain('28 · Süreklilik / Kurtarma (F21)');
    const sources = codeOnly(read('src/platform/devtools/mediaAuthoritySources.ts'));
    expect(sources, 'LAB kurtarma tetiklemiş')
      .not.toMatch(/\b(evaluateAutoResume|restoreListeningSession)\s*\(/);
    expect(sources, 'LAB parça adı taşımış').not.toMatch(/f21(Title|Artist|Uri|Track)/);
  });

  it('19 · telemetri metin/ad TAŞIMAZ', () => {
    const src = read('src/platform/media/recovery/recoveryTelemetry.ts');
    for (const f of ['title', 'artist', 'uri', 'query', 'utterance', 'location']) {
      expect(src.toLowerCase(), `yasaklı alan sızmış: ${f}`).not.toContain(`${f}:`);
    }
    expect(src).toContain('entriesExpiringDropped');
  });

  it('20 · ikinci kurtarma motoru KURULMAZ (§18)', () => {
    const src = codeOnly(read('src/platform/media/recovery/recoveryRuntime.ts'));
    /* Domain kendi restart/backoff motorunu kurmaz — politika supervisor'ın. */
    expect(src, 'domain kendi yeniden başlatma motorunu kurmuş')
      .not.toMatch(/backoff|retryTimer|restartService/i);
    expect(src, 'kurtarma supervisor\'ı ele geçirmiş')
      .not.toContain('RuntimeRecoverySupervisor');
  });
});
