/**
 * carosLabRecoveryMonitor.test.tsx — CAROS LAB · Kurtarma İzleyici KİLİTLERİ.
 *
 * YAKLAŞIM (A3–A8 turlarıyla aynı): model TAMAMEN SAF → gerçek davranış servis
 * mock'u olmadan doğrulanır; ekran kilidi `renderToStaticMarkup` ile alınır.
 *
 * ANA İLKE: bu ekran YENİ OTORİTE DEĞİLDİR ve KURTARMAYA DOKUNMAZ.
 * Kilitler üç soruyu sorar: (1) uydurdu mu? (2) sızdırdı mı? (3) tetikledi mi?
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  resolveRecoveryAuthority, evaluateRecoveryGates, firstBlockingGate,
  deriveRecoveryVerdict, cooldownRemainingMs,
  buildLadderFields, buildKwpFields, buildLedgerFields,
  RECOVERY_GATE_ORDER,
  type RecoveryGateInput, type RecoveryFieldsInput,
} from '../platform/devtools/recoveryMonitorModel';
import { RecoveryMonitorScreen } from '../components/devtools/screens/RecoveryMonitorScreen';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * Kilitler KODU hedefler, BELGEYİ değil.
 *
 * Bu dosyanın ilk koşumunda dört kilit yalnız YORUM metnine takılmıştı: başlık
 * bloğu doğal olarak "refreshKwpRecoveryEvidence çağrılmaz", "VIN taşınmaz",
 * "_maybeRunEcuRecovery" gibi ifadeler içeriyor. Yasağı ANLATAN cümleyi yasağın
 * İHLALİ sayan bir kilit, doğru kodu kırmızı gösterir ve zamanla belgeyi
 * budamaya zorlar. Bu yüzden eşleşme öncesi yorumlar SÖKÜLÜR.
 */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote !== null) {
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i += 1; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

const NOW = 1_700_000_000_000;

/** Tüm kapıların AÇIK olduğu taban — her test yalnız ilgilendiği alanı bozar. */
function ladder(over: Partial<RecoveryGateInput> = {}): RecoveryGateInput {
  return {
    inFlight: false,
    exhausted: false,
    transportConnected: true,
    dataFresh: false,              // ECU susmuş → kurtarılacak durum VAR
    ecuSilentStreak: 2,
    streakThreshold: 2,
    nativeReconnectInFlight: false,
    protocolActive: '6',           // CAN
    canApplicable: true,
    voltageKnown: true,
    engineLikelyRunning: true,
    batteryVoltage: 14.1,
    engineVoltageThresholdV: 13.0,
    lastRecoveryAtMs: 0,
    cooldownMs: 10_000,
    nextLevelPresent: true,
    ...over,
  };
}

const gateOf = (gs: readonly { id: string; state: string }[], id: string) =>
  gs.find((g) => g.id === id);

/* ══════════════════════════════════════════════════════════════════════════
 * 1) OTORİTE — iki motor, tek sahip
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › kurtarma otoritesi', () => {
  it('CAN protokolünde otorite TS merdivenidir', () => {
    expect(resolveRecoveryAuthority({ protocolActive: '6', canApplicable: true }))
      .toBe('CAN_LADDER');
  });

  it('KWP/ISO9141 (3/4/5) otoriteyi NATIVE ATPC\'ye verir — arıza DEĞİL, tasarım', () => {
    for (const p of ['3', '4', '5']) {
      expect(resolveRecoveryAuthority({ protocolActive: p, canApplicable: false }))
        .toBe('KWP_NATIVE');
    }
  });

  it('protokol bilinmiyorsa FAIL-CLOSED: hiçbir motor sahiplenmez', () => {
    expect(resolveRecoveryAuthority({ protocolActive: null, canApplicable: false }))
      .toBe('UNKNOWN_PROTOCOL');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) KAPILAR — kod sırası ve "sıra gelmedi" dürüstlüğü
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › kapılar', () => {
  it('tüm kapılar açıkken hiçbiri DURDURMAZ', () => {
    const gs = evaluateRecoveryGates(ladder(), NOW);
    expect(firstBlockingGate(gs)).toBeNull();
    expect(gs).toHaveLength(RECOVERY_GATE_ORDER.length);
  });

  it('İLK DURDURAN kapıdan SONRASI "GEÇTİ" değil "SIRA GELMEDİ"dir (kodda erken return)', () => {
    // transport kopuk → 3. kapı durdurur; sonraki kapılar HİÇ değerlendirilmez.
    const gs = evaluateRecoveryGates(ladder({ transportConnected: false }), NOW);
    expect(gateOf(gs, 'transport')?.state).toBe('BLOCKED');
    for (const id of ['ecu-silent', 'streak', 'native-authority', 'can-protocol',
                      'ignition', 'cooldown', 'ceiling']) {
      expect(gateOf(gs, id)?.state, `${id} sıra gelmemiş olmalı`).toBe('NOT_REACHED');
    }
    // Erken durduran kapıdan ÖNCEKİLER gerçekten değerlendirilmiştir.
    expect(gateOf(gs, 'inflight')?.state).toBe('PASS');
    expect(gateOf(gs, 'exhausted')?.state).toBe('PASS');
  });

  it('kapı sırası `_maybeRunEcuRecovery` KONTROL SIRASI ile birebir aynıdır', () => {
    const gs = evaluateRecoveryGates(ladder(), NOW);
    expect(gs.map((g) => g.id)).toEqual([...RECOVERY_GATE_ORDER]);
  });

  it('TEK stale olayı merdiveni başlatmaz — eşik altı streak DURDURUR', () => {
    const gs = evaluateRecoveryGates(ladder({ ecuSilentStreak: 1 }), NOW);
    expect(gateOf(gs, 'streak')?.state).toBe('BLOCKED');
    expect(gateOf(gs, 'streak')?.evidence).toContain('1/2');
  });

  it('CAN dışı protokolde can-protocol kapısı ÇİFT ATPC yasağını gerekçe gösterir', () => {
    const gs = evaluateRecoveryGates(
      ladder({ protocolActive: '4', canApplicable: false }), NOW);
    expect(gateOf(gs, 'can-protocol')?.state).toBe('BLOCKED');
    expect(gateOf(gs, 'can-protocol')?.evidence).toMatch(/ATPC/);
  });

  it('native reconnect uçuştaysa TS karışmaz (çift motor yasağı)', () => {
    const gs = evaluateRecoveryGates(ladder({ nativeReconnectInFlight: true }), NOW);
    expect(gateOf(gs, 'native-authority')?.state).toBe('BLOCKED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) KANITSIZ GEÇİŞ — en kritik dürüstlük kilidi
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › kontak kapısı kanıt dürüstlüğü', () => {
  it('voltaj ÖLÇÜLDÜ ve eşik üstündeyse GEÇTİ (kanıtlı)', () => {
    const gs = evaluateRecoveryGates(
      ladder({ voltageKnown: true, engineLikelyRunning: true, batteryVoltage: 14.1 }), NOW);
    expect(gateOf(gs, 'ignition')?.state).toBe('PASS');
  });

  it('voltaj BİLİNMİYORSA kapı geçer ama "motor çalışıyor" DENMEZ → PASS_UNPROVEN', () => {
    // isEngineLikelyRunning bilinmeyen voltajda `true` döner (saha 2026-07-19 / iCar3):
    // kurtarma engellenmez — ama bu bir OLUMLAMA değildir.
    const gs = evaluateRecoveryGates(
      ladder({ voltageKnown: false, engineLikelyRunning: true, batteryVoltage: null }), NOW);
    const g = gateOf(gs, 'ignition');
    expect(g?.state).toBe('PASS_UNPROVEN');
    expect(g?.evidence).toMatch(/KANITLANAMADI/);
    // Sahte voltaj UYDURULMAZ.
    expect(g?.evidence).not.toMatch(/0\.0 V/);
  });

  it('motor KAPALI kanıtı varsa kurtarma yapılmaz (park dalgalanması önlenir)', () => {
    const gs = evaluateRecoveryGates(
      ladder({ voltageKnown: true, engineLikelyRunning: false, batteryVoltage: 12.3 }), NOW);
    expect(gateOf(gs, 'ignition')?.state).toBe('BLOCKED');
    expect(gateOf(gs, 'ignition')?.evidence).toMatch(/BEKLENİR/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) COOLDOWN — sahte süre ve saat sıçraması
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › cooldown', () => {
  it('hiç deneme yoksa cooldown İŞLEMEZ (null) — "0 ms kaldı" UYDURULMAZ', () => {
    expect(cooldownRemainingMs({ lastRecoveryAtMs: 0, cooldownMs: 10_000, nowMs: NOW }))
      .toBeNull();
  });

  it('saat GERİYE sıçradıysa kalan süre hesaplanmaz (null)', () => {
    expect(cooldownRemainingMs({
      lastRecoveryAtMs: NOW + 5_000, cooldownMs: 10_000, nowMs: NOW,
    })).toBeNull();
  });

  it('cooldown dolmadıysa kapı DURDURUR; dolduysa geçer', () => {
    const blocked = evaluateRecoveryGates(
      ladder({ lastRecoveryAtMs: NOW - 3_000, cooldownMs: 10_000 }), NOW);
    expect(gateOf(blocked, 'cooldown')?.state).toBe('BLOCKED');

    const passed = evaluateRecoveryGates(
      ladder({ lastRecoveryAtMs: NOW - 30_000, cooldownMs: 10_000 }), NOW);
    expect(gateOf(passed, 'cooldown')?.state).toBe('PASS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) HÜKÜM
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › genel hüküm', () => {
  const verdict = (over: Partial<RecoveryGateInput> = {}, available = true) => {
    const l = ladder(over);
    const gates = evaluateRecoveryGates(available ? l : null, NOW);
    return deriveRecoveryVerdict({
      gates,
      authority: resolveRecoveryAuthority({
        protocolActive: l.protocolActive, canApplicable: l.canApplicable,
      }),
      inFlight: l.inFlight, exhausted: l.exhausted, dataFresh: l.dataFresh,
      available,
    });
  };

  it('veri TAZE ise hüküm HEALTHY olur — kırmızı yanlış alarm ÜRETİLMEZ', () => {
    // `ecu-silent` kapısının durdurması sistemin DOĞRU çalıştığının kanıtıdır.
    expect(verdict({ dataFresh: true })).toBe('HEALTHY');
  });

  it('KWP protokolünde hüküm NOT_APPLICABLE — "bozuk" DEĞİL', () => {
    expect(verdict({ protocolActive: '4', canApplicable: false })).toBe('NOT_APPLICABLE');
  });

  it('tavan dolduysa EXHAUSTED', () => {
    expect(verdict({ exhausted: true })).toBe('EXHAUSTED');
  });

  it('tırmanırken CLIMBING', () => {
    expect(verdict({ inFlight: true })).toBe('CLIMBING');
  });

  it('tüm kapılar açıkken READY', () => {
    expect(verdict()).toBe('READY');
  });

  it('kaynak okunamadıysa UNAVAILABLE — "hiç denenmedi" ile KARIŞTIRILMAZ', () => {
    expect(verdict({}, false)).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6) ALANLAR — sahte 0 / sahte damga yasağı
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › alan dürüstlüğü', () => {
  const fieldsInput = (over: Partial<RecoveryFieldsInput> = {}): RecoveryFieldsInput => ({
    ladder: { ...ladder(), attemptsUsed: 0, maxAttempts: 3,
              nextLevel: 'protocol_close', lastLevel: null },
    kwp: null, reconnect: null, linkLoss: null, nowMs: NOW,
    ...over,
  });

  it('lastRecoveryAt=0 → "0 ms önce" DEĞİL, UNAVAILABLE', () => {
    const fs = buildLadderFields(fieldsInput());
    const f = fs.find((x) => x.id === 'ladder-last-at');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/DEĞİL/);
  });

  it('merdiven okunamadıysa UNAVAILABLE ve "hiç denenmedi" ile karıştırılmaz', () => {
    const fs = buildLadderFields(fieldsInput({ ladder: null }));
    expect(fs[0].klass).toBe('UNAVAILABLE');
    expect(fs[0].note).toMatch(/KARIŞTIRILMAZ/);
  });

  it('KWP önbelleği boşken tazeleme TETİKLEMEDİĞİ açıkça yazılır', () => {
    const fs = buildKwpFields(fieldsInput({ kwp: null }));
    expect(fs[0].klass).toBe('UNAVAILABLE');
    expect(fs[0].note).toMatch(/TETİKLEMEZ/);
  });

  it('consecutiveFailedRecoveries null ise TÜRETİLMEZ (#642)', () => {
    const fs = buildKwpFields(fieldsInput({
      kwp: {
        status: 'NOT_ATTEMPTED', recoveryCount: 4, consecutiveFailedRecoveries: null,
        suppressedCount: 0, atpcSendFailures: 0, maxCoreNoDataStreak: 3,
        lastRecoveryToFirstPidMs: -1, refreshedAt: NOW - 1000,
      },
    }));
    const f = fs.find((x) => x.id === 'kwp-consec');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/TÜRETİLMEZ/);
    // recoveryCount'tan sayı SIZMAMALI.
    expect(f?.value).not.toContain('4');
  });

  it('ölçülmemiş ATPC→PID süresi (-1) sahte 0 olarak GÖSTERİLMEZ', () => {
    const fs = buildKwpFields(fieldsInput({
      kwp: {
        status: 'RECOVERED', recoveryCount: 1, consecutiveFailedRecoveries: 0,
        suppressedCount: 0, atpcSendFailures: 0, maxCoreNoDataStreak: 3,
        lastRecoveryToFirstPidMs: -1, refreshedAt: NOW,
      },
    }));
    const f = fs.find((x) => x.id === 'kwp-ttfp');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.value).not.toBe('0 ms');
  });

  it('kapanmış kurtarma yoksa medyan/en kötü süre UYDURULMAZ', () => {
    const fs = buildLedgerFields(fieldsInput({
      linkLoss: {
        total: 3, pendingRecoveryCount: 1, supersededCount: 2,
        medianRecoveryMs: null, maxRecoveryMs: null,
      },
    }));
    expect(fs.find((x) => x.id === 'll-median')?.klass).toBe('UNAVAILABLE');
    expect(fs.find((x) => x.id === 'll-max')?.klass).toBe('UNAVAILABLE');
    // superseded "bekliyor" SAYILMAZ — ayrı alan olarak durur.
    expect(fs.find((x) => x.id === 'll-superseded')?.value).toBe('2');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7) KATALOG + EKRAN BAĞI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › katalog ve ekran bağı', () => {
  it('katalog AVAILABLE ve ekran eşlemesi GERÇEKTEN vardır', () => {
    const tool = getCarosLabTool('recovery-monitor');
    expect(tool?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('recovery-monitor')).not.toBeNull();
  });

  it('katalog notu artık "Ekran yok" DEMEZ', () => {
    expect(getCarosLabTool('recovery-monitor')?.note).not.toMatch(/^Ekran yok/);
  });

  it('ekran render olur ve salt-okunur beyanını basar', () => {
    const html = renderToStaticMarkup(<RecoveryMonitorScreen />);
    expect(html).toContain('KURTARMA İZLEYİCİ');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="rm-verdict"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8) SIZINTI / YAN ETKİ KİLİTLERİ (kaynak metni üzerinden)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('recoveryMonitor › yan etki ve gizlilik kilitleri', () => {
  /* KOD — yorumlar sökülmüş hâli (bkz. stripComments başlığı). */
  const src    = stripComments(read('src/platform/devtools/recoveryMonitorSources.ts'));
  const model  = stripComments(read('src/platform/devtools/recoveryMonitorModel.ts'));
  const screen = stripComments(read('src/components/devtools/screens/RecoveryMonitorScreen.tsx'));

  it('kaynak katmanı native KWP tazelemesini TETİKLEMEZ (async pull yasağı)', () => {
    expect(src).not.toMatch(/refreshKwpRecoveryEvidence\s*\(/);
  });

  it('hiçbir katman kurtarma/reconnect TETİKLEMEZ', () => {
    for (const [name, text] of [['sources', src], ['model', model], ['screen', screen]] as const) {
      expect(text, `${name} kurtarma tetikliyor`).not.toMatch(/_maybeRunEcuRecovery|scheduleReconnect|connectOBD|sendCommand/);
    }
  });

  it('saf model I/O · timer · Date.now İÇERMEZ', () => {
    expect(model).not.toMatch(/Date\.now\(/);
    expect(model).not.toMatch(/setInterval|setTimeout/);
    expect(model).not.toMatch(/from '\.\.\/obdService'/);
  });

  it('ekran TIMER kurmaz (LAB deseni: tek okuma + elle YENİLE)', () => {
    expect(screen).not.toMatch(/setInterval\(/);
  });

  it('ekran unmount sonrası setState yapmaz (zero-leak)', () => {
    expect(screen).toContain('mountedRef');
    expect(screen).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('VIN · MAC · ham çerçeve bu zincire SIZMAZ', () => {
    for (const text of [src, model, screen]) {
      expect(text).not.toMatch(/\bvin\b/i);
      expect(text).not.toMatch(/macAddress|deviceName|rawFrame/i);
    }
  });
});
