/**
 * maviObservationTruth.test.ts — **MAVİ F7 KİLİTLERİ.**
 *
 * F7'nin sözleşmesini kilitler:
 *  · `PROPOSED ≠ REQUESTED ≠ ACCEPTED ≠ EXECUTED ≠ OBSERVED`,
 *  · bağımsız kanıt yürütücünün İYİMSER dönüşünü EZER,
 *  · kanıt yoksa/bayatsa hiçbir seviye DEĞİŞMEZ,
 *  · zaman aşımı BAŞARIYA dönüşmez,
 *  · gözlem katmanı ikinci otorite KURMAZ (yürütmez · güvenlik kararı vermez),
 *  · `SET_SETTING` koşulsuz "Ayar uygulandı" iddiası KAPANDI,
 *  · medyanın tek gerçeği `playbackTruth`tır (paralel durum YOK),
 *  · F0–F6 invariant'ları BOZULMAZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NO_EVIDENCE, capToCeiling, evidenceFromSettingApply, evidenceOf, freshnessOf,
  reconcileObservation, settleWithoutEvidence,
  type PendingObservation, type SettingApplyEvidence,
} from '../platform/capability/observation/observationContract';
import {
  MAX_PENDING_OBSERVATIONS, OBSERVATION_WINDOW_MS, openPendingObservation,
  readObservationDiagnostics, recordReconciliation, sweepPendingObservations,
  isObservableDomain, isObservationSource, _resetObservationLedgerForTest,
} from '../platform/capability/observation/observationLedger';
import {
  captureObservationBaseline, hasDeferredEvidence, readMediaEvidence,
  readNavigationEvidence, readImmediateEvidence,
} from '../platform/capability/observation/observationAdapters';
import { CAROS_CAPABILITY_CATALOG, findByLegacyIntent } from '../platform/capability/fabric/carosCapabilityCatalog';
import { labelOf } from '../platform/capability/fabric/capabilityPlanSummary';
import { buildCapabilityFabricView } from '../platform/devtools/capabilityFabricModel';
import type { CapabilityOperationDef } from '../platform/capability/fabric/capabilityContract';

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const NAV_DEF = findByLegacyIntent('NAVIGATE_ADDRESS') as CapabilityOperationDef;
const MEDIA_DEF = findByLegacyIntent('MEDIA_NEXT') as CapabilityOperationDef;

beforeEach(() => { _resetObservationLedgerForTest(); });
afterEach(() => { _resetObservationLedgerForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — Beş seviyenin ayrımı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F7 · A · PROPOSED ≠ REQUESTED ≠ ACCEPTED ≠ EXECUTED ≠ OBSERVED', () => {
  it('1. tavan yalnız BAŞARI iddiasını sınırlar — hata/iptal seviyelerine dokunmaz', () => {
    expect(capToCeiling('OBSERVED', 'ACCEPTED')).toBe('ACCEPTED');
    expect(capToCeiling('EXECUTED', 'ACCEPTED')).toBe('ACCEPTED');
    expect(capToCeiling('OBSERVED', 'EXECUTED')).toBe('EXECUTED');
    expect(capToCeiling('OBSERVED', 'OBSERVED')).toBe('OBSERVED');
    for (const bad of ['FAILED', 'UNKNOWN', 'CANCELLED', 'REQUESTED'] as const) {
      expect(capToCeiling(bad, 'ACCEPTED')).toBe(bad);
    }
  });

  it('2. **KANIT YOKSA TABAN AYNEN KALIR** — iddia UYDURULMAZ', () => {
    const r = reconcileObservation({ base: 'ACCEPTED', evidence: NO_EVIDENCE, ceiling: 'OBSERVED' });
    expect(r.level).toBe('ACCEPTED');
    expect(r.source).toBe('EXECUTOR_RESULT');
    expect(r.upgraded).toBe(false);
  });

  it('3. **BAYAT KANIT YENİ TURA BAĞLANMAZ** — seviye değişmez', () => {
    const stale = evidenceOf('PLAYBACK_TRUTH', 'OBSERVED', 'STALE');
    const r = reconcileObservation({ base: 'ACCEPTED', evidence: stale, ceiling: 'OBSERVED' });
    expect(r.level).toBe('ACCEPTED');
    expect(r.source).toBe('EXECUTOR_RESULT');
  });

  it('4. bağımsız kanıt seviyeyi YÜKSELTİR ama TAVANI AŞAMAZ', () => {
    const ev = evidenceOf('PLAYBACK_TRUTH', 'OBSERVED', 'FRESH');
    expect(reconcileObservation({ base: 'ACCEPTED', evidence: ev, ceiling: 'OBSERVED' }).level)
      .toBe('OBSERVED');
    /* Tavanı `ACCEPTED` olan bir işlemde kanıt OBSERVED dese bile yükselmez. */
    const capped = reconcileObservation({ base: 'ACCEPTED', evidence: ev, ceiling: 'ACCEPTED' });
    expect(capped.level).toBe('ACCEPTED');
    expect(capped.upgraded).toBe(false);
  });

  it('5. **SAHTE BAŞARI KAPANDI**: kanıt FAILED derse yürütücünün "succeeded"i EZİLİR', () => {
    const ev = evidenceOf('NAV_DESTINATION', 'FAILED', 'FRESH', 'EXECUTION_FAILED');
    const r = reconcileObservation({ base: 'EXECUTED', evidence: ev, ceiling: 'OBSERVED' });
    expect(r.level).toBe('FAILED');
    expect(r.downgraded).toBe(true);
    expect(r.source).toBe('NAV_DESTINATION');
  });

  it('6. kanıt UNKNOWN ise başarı iddiası ACCEPTED\'e DÜŞER ("gönderdim, göremiyorum")', () => {
    const ev = evidenceOf('PLAYBACK_TRUTH', 'UNKNOWN', 'FRESH');
    const r = reconcileObservation({ base: 'OBSERVED', evidence: ev, ceiling: 'OBSERVED' });
    expect(r.level).toBe('ACCEPTED');
    expect(r.downgraded).toBe(true);
    expect(r.failure).toBe('OBSERVATION_UNKNOWN');
  });

  it('7. **HATA GİZLENEMEZ**: FAILED taban bağımsız kanıtla başarıya ÇEVRİLEMEZ', () => {
    const ev = evidenceOf('PLAYBACK_TRUTH', 'OBSERVED', 'FRESH');
    expect(reconcileObservation({ base: 'FAILED', evidence: ev, ceiling: 'OBSERVED' }).level)
      .toBe('FAILED');
  });

  it('8. iptal ve onay-bekleme TERMİNALDİR — geç kanıt onları geçersiz KILAMAZ', () => {
    const ev = evidenceOf('NAV_DESTINATION', 'EXECUTED', 'FRESH');
    expect(reconcileObservation({ base: 'CANCELLED', evidence: ev, ceiling: 'OBSERVED' }).level)
      .toBe('CANCELLED');
    expect(reconcileObservation({ base: 'REQUESTED', evidence: ev, ceiling: 'OBSERVED' }).level)
      .toBe('REQUESTED');
  });

  it('9. kanıt CANCELLED derse (barge-in/supersede) sonuç iptaldir', () => {
    const ev = evidenceOf('PLAYBACK_TRUTH', 'CANCELLED', 'FRESH', 'CANCELLED');
    expect(reconcileObservation({ base: 'ACCEPTED', evidence: ev, ceiling: 'OBSERVED' }).level)
      .toBe('CANCELLED');
  });

  it('10. tazelik TEK karar noktasıdır ve damgasız kanıt KULLANILMAZ', () => {
    expect(freshnessOf(100, 100)).toBe('FRESH');
    expect(freshnessOf(101, 100)).toBe('FRESH');
    expect(freshnessOf(99, 100)).toBe('STALE');
    expect(freshnessOf(null, 100)).toBe('UNKNOWN');
    expect(freshnessOf(Number.NaN, 100)).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Zaman aşımı ve bekleyen gözlem
 * ════════════════════════════════════════════════════════════════════════ */

const pending = (p: Partial<PendingObservation> = {}): PendingObservation => ({
  key: 'navigation.route#startAddress',
  capabilityId: 'navigation.route',
  operation: 'startAddress',
  domain: 'navigation',
  ceiling: 'ACCEPTED',
  turnId: 't1',
  requestedAtMs: 1_000,
  deadlineMs: 1_000 + OBSERVATION_WINDOW_MS,
  baseline: 0,
  base: 'ACCEPTED',
  ...p,
});

describe('MAVI-F7 · B · zaman aşımı BAŞARIYA dönüşmez', () => {
  it('11. **KANITSIZ KAPANIŞ UNKNOWN\'DIR** — asla EXECUTED/OBSERVED', () => {
    expect(settleWithoutEvidence(pending({ base: 'ACCEPTED' })).level).toBe('UNKNOWN');
    expect(settleWithoutEvidence(pending({ base: 'EXECUTED' })).level).toBe('UNKNOWN');
    expect(settleWithoutEvidence(pending({ base: 'OBSERVED' })).level).toBe('UNKNOWN');
  });

  it('12. zaten terminal olan taban kanıtsız kapanışta KORUNUR', () => {
    expect(settleWithoutEvidence(pending({ base: 'FAILED' })).level).toBe('FAILED');
    expect(settleWithoutEvidence(pending({ base: 'CANCELLED' })).level).toBe('CANCELLED');
  });

  it('13. süresi dolan bekleyen kayıt EXPIRED olarak UNKNOWN kapanır', () => {
    const base = captureObservationBaseline(1_000);
    openPendingObservation(pending(), base);
    expect(readObservationDiagnostics(1_100).pendingCount).toBe(1);
    const after = readObservationDiagnostics(1_000 + OBSERVATION_WINDOW_MS + 1);
    expect(after.pendingCount).toBe(0);
    expect(after.settlements['EXPIRED']).toBe(1);
    expect(after.deferredLevels['UNKNOWN']).toBe(1);
    expect(after.deferredLevels['EXECUTED']).toBeUndefined();
    expect(after.deferredLevels['OBSERVED']).toBeUndefined();
  });

  it('14. bekleyen kuyruk BOUNDED — taşan kayıt EVICTED olur, bellek büyümez', () => {
    const base = captureObservationBaseline(1_000);
    for (let i = 0; i < MAX_PENDING_OBSERVATIONS + 3; i += 1) {
      openPendingObservation(pending({ key: `k${i}`, requestedAtMs: 1_000, deadlineMs: 9_000_000 }), base);
    }
    const d = readObservationDiagnostics(1_100);
    expect(d.pendingCount).toBeLessThanOrEqual(MAX_PENDING_OBSERVATIONS);
    expect(d.settlements['EVICTED']).toBe(3);
    expect(d.opened).toBe(MAX_PENDING_OBSERVATIONS + 3);
  });

  it('15. süpürme İDEMPOTENTtir ve timer KURMAZ', () => {
    const base = captureObservationBaseline(1_000);
    openPendingObservation(pending(), base);
    const t = 1_000 + OBSERVATION_WINDOW_MS + 1;
    sweepPendingObservations(t);
    sweepPendingObservations(t);
    sweepPendingObservations(t);
    expect(readObservationDiagnostics(t).settlements['EXPIRED']).toBe(1);
  });

  it('16. LAB okuması da SÜPÜRÜR — ekranda sonsuza dek "bekliyor" görünmez', () => {
    const base = captureObservationBaseline(1_000);
    openPendingObservation(pending(), base);
    const d = readObservationDiagnostics(1_000 + OBSERVATION_WINDOW_MS + 5);
    expect(d.pendingCount).toBe(0);
    expect(d.pendingDomains).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — Adapterlar mevcut alan otoritelerini OKUR
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F7 · C · alan otoriteleri OKUNUR, paralel gerçek KURULMAZ', () => {
  it('17. okunamayan taban kanıt kapısını KAPALI tutar (sahte kanıt yok)', () => {
    const unreadable = { atMs: 0, navChangeCount: -1, mediaCommandCount: -1 } as const;
    expect(readMediaEvidence(unreadable).level).toBeNull();
    expect(readNavigationEvidence(unreadable, 0).level).toBeNull();
  });

  it('18. taban ÜSTÜNE kayıt yoksa kanıt YOKTUR', () => {
    const base = captureObservationBaseline(Date.now());
    expect(readMediaEvidence(base).level).toBeNull();
    expect(readNavigationEvidence(base, base.atMs).level).toBeNull();
  });

  it('19. navigasyon kanıtı GECİKMELİDİR — anlık yolda okunmaz', () => {
    expect(hasDeferredEvidence('navigation')).toBe(true);
    expect(hasDeferredEvidence('media')).toBe(false);
    const base = captureObservationBaseline(Date.now());
    /* Anlık okuma navigasyon için kanıt ÜRETMEZ (sahte "hemen doğrulandı" yok). */
    expect(readImmediateEvidence(NAV_DEF, base, null).level).toBeNull();
  });

  it('20. ayar port kanıdı gözlem seviyesine DÜRÜSTÇE çevrilir', () => {
    const map: Array<[SettingApplyEvidence | null, string | null]> = [
      [{ kind: 'APPLIED', key: 'performanceMode' }, 'OBSERVED'],
      [{ kind: 'DELIVERED', key: 'wifi' }, 'ACCEPTED'],
      [{ kind: 'SURFACE_OPENED', key: 'wallpaper' }, 'ACCEPTED'],
      [{ kind: 'REJECTED', key: 'unitSystem', reason: 'no_value' }, 'FAILED'],
      [null, 'FAILED'],                                   // port HİÇ YOK
    ];
    for (const [ev, expected] of map) {
      expect(evidenceFromSettingApply(ev).level, JSON.stringify(ev)).toBe(expected);
    }
  });

  it('21. **PORT YOKSA "uygulandı" DENEMEZ** — F5 sahte-ACK borcu kapalı', () => {
    const r = reconcileObservation({
      base: 'EXECUTED', evidence: evidenceFromSettingApply(null), ceiling: 'OBSERVED',
    });
    expect(r.level).toBe('FAILED');
  });

  it('22. WiFi/Bluetooth gibi kanıtsız port OBSERVED ÜRETEMEZ', () => {
    const r = reconcileObservation({
      base: 'EXECUTED',
      evidence: evidenceFromSettingApply({ kind: 'DELIVERED', key: 'wifi' }),
      ceiling: 'OBSERVED',
    });
    expect(r.level).toBe('ACCEPTED');
    expect(r.downgraded).toBe(true);
  });

  it('23. alan ve kaynak adları BOUNDED — uydurma değer defterine giremez', () => {
    for (const d of ['navigation', 'media', 'settings', 'vehicle', 'diagnostics', 'phone', 'surface']) {
      expect(isObservableDomain(d)).toBe(true);
    }
    expect(isObservableDomain('uydurma')).toBe(false);
    for (const s of ['EXECUTOR_RESULT', 'NAV_DESTINATION', 'PLAYBACK_TRUTH', 'SETTINGS_STORE', 'NONE']) {
      expect(isObservationSource(s)).toBe(true);
    }
    expect(isObservationSource('MAVI_TRUTH')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — Kaynak kilitleri (mimari sınırlar)
 * ════════════════════════════════════════════════════════════════════════ */

const OBS_CONTRACT = 'platform/capability/observation/observationContract.ts';
const OBS_ADAPTERS = 'platform/capability/observation/observationAdapters.ts';
const OBS_LEDGER = 'platform/capability/observation/observationLedger.ts';

describe('MAVI-F7 · D · gözlem katmanı OTORİTE DEĞİLDİR', () => {
  it('24. **HİÇBİR ŞEY YÜRÜTMEZ** (ikinci yürütücü yasağı)', () => {
    for (const f of [OBS_CONTRACT, OBS_ADAPTERS, OBS_LEDGER]) {
      const code = codeOf(src(f));
      for (const forbidden of [
        'dispatchIntent', 'executeIntent', 'executeAIResult', 'startNavigation',
        'stopNavigation', 'mediaCommandGateway', 'appLauncher', 'bridge.',
        'speakMaviAnswer', 'speakAlert',
      ]) {
        expect(code, `${f} → ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('25. **GÜVENLİK/ONAY KARARI VERMEZ** (kanonik otorite taklit edilmez)', () => {
    for (const f of [OBS_CONTRACT, OBS_ADAPTERS, OBS_LEDGER]) {
      const code = codeOf(src(f));
      for (const forbidden of [
        'evaluateVehicleAction', 'evaluateActionIdSafety', 'createAiSafetyGate',
        'MOTION_STOPPED_MAX_KMH', 'setPendingAction', 'requiresConfirmation',
      ]) {
        expect(code, `${f} → ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('26. sözleşme katmanı SAFTIR (I/O · timer · Date.now · modül durumu YOK)', () => {
    const code = codeOf(src(OBS_CONTRACT));
    for (const forbidden of ['Date.now', 'setTimeout', 'setInterval', 'localStorage', 'fetch(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    /* Yalnız TİP import eder — çalışma zamanı bağımlılığı yoktur. */
    const imports = src(OBS_CONTRACT).match(/^import .*/gm) ?? [];
    for (const line of imports) expect(line).toMatch(/^import type /);
  });

  it('27. defter TIMER/ABONELİK KURMAZ — süre dolumu TEMBEL süpürmeyle yakalanır', () => {
    const code = codeOf(src(OBS_LEDGER));
    for (const forbidden of ['setTimeout', 'setInterval', 'Date.now', 'addEventListener', 'subscribe(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(code).toContain('sweepPendingObservations');
  });

  it('28. adapterlar TIMER/ABONELİK KURMAZ ve MEVCUT otoriteleri okur', () => {
    const code = codeOf(src(OBS_ADAPTERS));
    for (const forbidden of ['setTimeout', 'setInterval', 'addEventListener']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(code).toContain('getDestinationChangeLog');
    expect(code).toContain('getMediaAuthorityEvidence');
  });

  it('29. **GİZLİLİK**: hedef adı/parça adı/parametre değeri gözlem katmanına GİRMEZ', () => {
    for (const f of [OBS_CONTRACT, OBS_ADAPTERS, OBS_LEDGER]) {
      const code = codeOf(src(f));
      for (const forbidden of ['toName', 'fromName', 'transcript', 'contactName', 'destination.name', 'vin']) {
        expect(code, `${f} → ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('30. defter F6 tek-atışlık plan yuvasına YAZMAZ (turlar arası sızma yok)', () => {
    const code = codeOf(src(OBS_LEDGER));
    expect(code).not.toContain('recordCapabilityObservation');
    expect(code).not.toContain('takeLastCapabilityObservation');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — Yürütücüde kapanan sahte başarı yolları
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F7 · E · yürütücüde sahte başarı KAPANDI', () => {
  const exec = src('platform/commandExecutor.ts');

  it('31. **KOŞULSUZ "Ayar uygulandı" KALDIRILDI**', () => {
    const i = exec.indexOf("case 'SET_SETTING'");
    expect(i).toBeGreaterThan(-1);
    const body = exec.slice(i, i + 1_600);
    /* Başarı iddiası YALNIZ geri okunmuş kanıtla (`APPLIED`) kurulur. */
    expect(body).toContain("case 'APPLIED'");
    expect(body).toContain('setting_readback');
    /* Port yoksa DÜRÜST başarısızlık. */
    expect(body).toContain('setting_port_missing');
    /* Kanıtsız native yol "uygulandı" DEMEZ. */
    expect(body).toContain('setting_unverified');
    /* Yalnız ekran açıldıysa ayar UYGULANMADI denir. */
    expect(body).toContain('setting_surface_only');
  });

  it('32. play/pause artık `playbackTruth` sonucunu BEKLER (ateşle-unut değil)', () => {
    const code = codeOf(exec);
    expect(code).toMatch(/case 'PLAY_MEDIA':[\s\S]{0,240}await playWithResult\(\)/);
    expect(code).toMatch(/case 'PAUSE_MEDIA':[\s\S]{0,240}await pauseWithResult\(\)/);
    /* Doğrulanmamış yolda "çalıyor" DENMEZ. */
    expect(code).toContain('_mediaStateReply');
    const i = code.indexOf('function _mediaStateReply');
    expect(code.slice(i, i + 700)).toContain('r.verified');
  });

  it('33. medya sonucu `playbackTruth` VERIFIED\'ine bağlıdır — paralel durum YOK', () => {
    const media = codeOf(src('platform/mediaService.ts'));
    const i = media.indexOf('function _routeToAuthority');
    expect(i).toBeGreaterThan(-1);
    expect(media.slice(i, i + 900)).toContain("truth.outcome === 'VERIFIED'");
    /* Yeni sürümler AYNI kapıdan geçer; ikinci otorite kurulmaz. */
    expect(media).toMatch(/playWithResult[\s\S]{0,400}_routeToAuthority\('play'\)/);
    expect(media).toMatch(/pauseWithResult[\s\S]{0,400}_routeToAuthority\('pause'\)/);
  });

  it('34. navigasyon portu YOKKEN rota iddiası KURULMAZ', () => {
    const code = codeOf(exec);
    const i = code.indexOf("case 'NAVIGATE_ADDRESS'");
    const body = code.slice(i, i + 700);
    expect(body).toContain('ctx.navigateToPlace');
    /* Port yoksa yalnız haritanın açıldığı söylenir — "gidiyoruz" DENMEZ. */
    expect(body).toContain('Haritayı açtım');
    expect(body).not.toContain('adresine gidiyoruz');
  });

  it('35. gözlem KAYDI yürütmeden ÖNCE taban alır (sonradan bakmak kanıt değildir)', () => {
    const code = codeOf(exec);
    const iBase = code.indexOf('captureObservationBaseline');
    const iDispatch = code.indexOf('await dispatchIntent', iBase);
    expect(iBase).toBeGreaterThan(-1);
    expect(iDispatch).toBeGreaterThan(iBase);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — Katalog ve F6 bütünlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F7 · F · katalog tavanları ve F6 entegrasyonu', () => {
  it('36. tavan yalnız GERÇEK kanıt üretebilen işlemlerde yükseldi', () => {
    /* `playbackTruth` kanıtı olan transport işlemleri. */
    for (const intent of ['PLAY_MEDIA', 'PAUSE_MEDIA', 'MEDIA_NEXT', 'MEDIA_PREV']) {
      expect(findByLegacyIntent(intent)?.observationCeiling, intent).toBe('OBSERVED');
    }
    /* Ayar: depodan geri okuma bağımsız gözlemdir. */
    expect(findByLegacyIntent('SET_SETTING')?.observationCeiling).toBe('OBSERVED');
    /* Kanıt ÜRETMEYEN işlemler DÜRÜSTÇE düşük tavanda BIRAKILDI. */
    for (const intent of ['PLAY_MUSIC_SEARCH', 'OPEN_MUSIC', 'VOLUME_UP', 'VOLUME_DOWN']) {
      expect(findByLegacyIntent(intent)?.observationCeiling, intent).toBe('ACCEPTED');
    }
    /* Navigasyon kanıtı GECİKMELİ olduğu için anlık tavan yükseltilmedi. */
    for (const intent of ['OPEN_NAVIGATION', 'NAVIGATE_ADDRESS', 'SEARCH_POI']) {
      expect(findByLegacyIntent(intent)?.observationCeiling, intent).toBe('ACCEPTED');
    }
  });

  it('37. katalogdaki HER işlemin plan etiketi vardır (bileşik cümle boşluk bırakmaz)', () => {
    for (const d of CAROS_CAPABILITY_CATALOG) {
      expect(labelOf(d), `${d.capabilityId}#${d.operation}`).not.toBe('işlemi');
    }
  });

  it('38. **ACCEPTED ≠ ALL_SUCCEEDED** — F6 invariant\'ı korunur', () => {
    const plan = codeOf(src('platform/capability/fabric/capabilityPlan.ts'));
    /* Kanıtlı başarı kovası YALNIZ EXECUTED/OBSERVED içerir. */
    expect(plan).toMatch(/EXECUTED[\s\S]{0,80}OBSERVED/);
    const runner = codeOf(src('platform/capability/fabric/capabilityPlanRunner.ts'));
    expect(runner).toContain("dep.observationState === 'EXECUTED'");
    expect(runner).toContain("dep.observationState === 'OBSERVED'");
  });

  it('39. F6 plan yolu UZLAŞTIRILMIŞ gözlemi okur (yeni kanal AÇILMADI)', () => {
    const voice = codeOf(src('platform/voiceService.ts'));
    expect(voice).toContain('takeLastCapabilityObservation');
    /* Plan katmanı gözlem defterine DOĞRUDAN bağlanmaz — tek kanal korunur. */
    expect(voice).not.toContain('readObservationDiagnostics');
    const runner = codeOf(src('platform/capability/fabric/capabilityPlanRunner.ts'));
    expect(runner).not.toContain('observationLedger');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G — LAB dürüstlüğü (yeni ekran AÇILMADI)
 * ════════════════════════════════════════════════════════════════════════ */

const fabricInput = (observation: ReturnType<typeof readObservationDiagnostics> | null) => ({
  diagnostics: null,
  observation,
  enforcing: null,
  rows: null,
  integrity: null,
  brainIntentCount: null,
});

describe('MAVI-F7 · G · CAROS LAB gözlem yüzeyi', () => {
  it('40. ölçüm yokken "0" DEĞİL "ölçüm yok" gösterilir', () => {
    const view = buildCapabilityFabricView(fabricInput(readObservationDiagnostics(1_000)));
    const pendingField = view.fields.find((f) => f.id === 'obs_pending');
    expect(pendingField?.klass).toBe('UNAVAILABLE');
    expect(pendingField?.value).not.toContain('0 açıldı');
  });

  it('41. kaynak okunamazsa UNAVAILABLE gösterilir — sahte sıfır ÜRETİLMEZ', () => {
    const view = buildCapabilityFabricView(fabricInput(null));
    for (const id of ['obs_sources', 'obs_honesty', 'obs_pending']) {
      expect(view.fields.find((f) => f.id === id)?.klass, id).toBe('UNAVAILABLE');
    }
  });

  it('42. dürüstlük düzeltmesi (düşürme/yükseltme) ekranda GÖRÜNÜR', () => {
    recordReconciliation(reconcileObservation({
      base: 'EXECUTED',
      evidence: evidenceOf('PLAYBACK_TRUTH', 'UNKNOWN', 'FRESH'),
      ceiling: 'OBSERVED',
    }));
    const view = buildCapabilityFabricView(fabricInput(readObservationDiagnostics(1_000)));
    const honesty = view.fields.find((f) => f.id === 'obs_honesty');
    expect(honesty?.value).toContain('düşürme 1');
    const sources = view.fields.find((f) => f.id === 'obs_sources');
    expect(sources?.value).toContain('PLAYBACK_TRUTH');
  });

  it('43. **YENİ LAB EKRANI AÇILMADI** — mevcut Capability Fabric yüzeyi genişletildi', () => {
    const catalog = src('platform/devtools/carosLabCatalog.ts');
    expect(catalog).not.toContain('observationTruth');
    expect(catalog).not.toContain('ObservationScreen');
    /* Gözlem alanları MEVCUT ekranın modelinde durur. */
    const model = src('platform/devtools/capabilityFabricModel.ts');
    expect(model).toContain('obs_sources');
    expect(model).toContain('obs_pending');
  });

  it('44. LAB kaynak katmanı KOMUT GÖNDERMEZ (salt okuma)', () => {
    const code = codeOf(src('platform/devtools/capabilityFabricSources.ts'));
    for (const forbidden of ['dispatchIntent', 'executeIntent', 'openPendingObservation',
      'recordReconciliation', 'setCapabilityFabricEnforceRemoteFlag', '_reset']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(code).toContain('readObservationDiagnostics');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * H — F0–F6 invariant'ları
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F7 · H · önceki fazların invariant\'ları korunur', () => {
  it('45. F2: gözlem katmanı KULLANICI METNİ ÜRETMEZ (yapay ara söz doğamaz)', () => {
    for (const f of [OBS_CONTRACT, OBS_ADAPTERS, OBS_LEDGER]) {
      const code = codeOf(src(f));
      /* Türkçe cümle üretimi bu katmanda YOKTUR — metin `capabilityPlanSummary`
         ve yürütücüye aittir. */
      expect(code, f).not.toMatch(/'[^']*(açtım|başlattım|çalıyor|uygulandı)[^']*'/);
    }
  });

  it('46. F5: kanonik eylem kapısı hâlâ YÜRÜTÜCÜDEN ÖNCE çalışır', () => {
    const exec = src('platform/commandExecutor.ts');
    expect(exec.indexOf('evaluateVehicleAction'))
      .toBeLessThan(exec.indexOf('switch (intent.type)'));
  });

  it('47. F5: dürüstlük tavanı `classifyObservation` içinde HÂLÂ uygulanır', () => {
    const fab = codeOf(src('platform/capability/fabric/capabilityFabric.ts'));
    expect(fab).toMatch(/ceiling === 'ACCEPTED' \? 'ACCEPTED' : 'EXECUTED'/);
  });

  it('48. uzlaştırma yürütmeyi ETKİLEMEZ — kayıt fail-soft ve yan etkisizdir', () => {
    /* Bozuk girdiyle bile throw ETMEZ. */
    expect(() => recordReconciliation({
      level: 'UNKNOWN', source: 'NONE', downgraded: false, upgraded: false, failure: null,
    })).not.toThrow();
    expect(() => sweepPendingObservations(Number.NaN)).not.toThrow();
    expect(() => readObservationDiagnostics(Number.NaN)).not.toThrow();
    expect(() => readImmediateEvidence(MEDIA_DEF, captureObservationBaseline(0), null)).not.toThrow();
  });
});
