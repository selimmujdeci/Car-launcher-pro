/**
 * carosLabActionAuthority.test.tsx — CAROS LAB · Eylem Otoritesi KİLİTLERİ (MAVI-M4-LAB).
 *
 * ANA İLKELER:
 *  1. **GİZLİLİK YAPISALDIR:** ham kullanıcı komutu · kişi adı · telefon numarası ·
 *     sağlayıcı cevabı ne diagnostics API'sine girer ne render'a çıkar. Kilitler
 *     bunu HEM otorite yüzeyinden HEM gerçek markup'tan doğrular.
 *  2. **SALT-OKUNUR:** ekran hiçbir executor/bridge/OBD fonksiyonunu çağıramaz;
 *     eylem çalıştırma ve onay onaylama/iptal butonu YOKTUR.
 *  3. Kaynak yoksa UNAVAILABLE — sahte 0 / sahte tarih YOK.
 *  4. Karar halkası BOUNDED; sayaçlar doyar.
 *  5. Ekran kapalıyken polling YOK; unmount'ta timer temizlenir.
 *  6. M4 authority davranışı DEĞİŞMEZ (gözlem kararı etkilemez).
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  VEHICLE_ACTIONS, evaluateVehicleAction, getActionAuthorityDiagnostics,
  MAX_ACTION_DECISIONS, _resetActionAuthorityDiagnosticsForTest,
} from '../platform/action/maviActionAuthority';
import {
  setPendingAction, getPendingActionDiagnostics, peekPendingAction,
  _resetPendingActionForTest, PENDING_ACTION_TTL_MS,
} from '../platform/action/pendingActionConfirmation';
import {
  buildAaSections, buildAaActionRows, buildAaDecisionRows, countByAaClass,
  MAX_AA_DECISION_ROWS,
  type AaRawSnapshot,
} from '../platform/devtools/actionAuthorityModel';
import { readActionAuthoritySnapshot } from '../platform/devtools/actionAuthoritySources';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { ActionAuthorityScreen } from '../components/devtools/screens/ActionAuthorityScreen';
import { isCarosLabAllowed, shouldRenderCarosLab } from '../platform/devtools/carosLabGate';
import type { AppIntent, IntentType } from '../platform/intentEngine';
import type { VehicleContext } from '../platform/aiVoiceService';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture — SIZDIRILMASI YASAK içerikler burada tanımlıdır
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

/** Bunlar markup'ta veya herhangi bir snapshot alanında GÖRÜNMEMELİDİR. */
const SECRET_CONTACT   = 'Ayşe Yıldırım';
const SECRET_PHONE     = '+905551112233';
const SECRET_UTTERANCE = 'Ayşe Yıldırım\'ı hemen ara lütfen';

/** Yorumları çıkarır — kaynak kilitleri YALNIZ gerçek koda bakar. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function motion(state: 'moving' | 'stopped' | 'unknown'): VehicleContext {
  return {
    speedKmh: state === 'moving' ? 90 : 0,
    drivingMode: state === 'moving' ? 'driving' : 'idle',
    isDriving: state === 'moving',
    motionState: state,
  } as unknown as VehicleContext;
}

/** PII TAŞIYAN intent — bekleyen onay slotuna bilerek bu konur. */
function piiIntent(): AppIntent {
  return {
    type: 'OPEN_PHONE',
    payload: { contactName: SECRET_CONTACT, sourceText: SECRET_UTTERANCE },
    priority: 'high',
  } as AppIntent;
}

function snapshot(over: Partial<AaRawSnapshot> = {}): AaRawSnapshot {
  return {
    readAt: NOW,
    actions: [
      { intent: 'HARDWARE_UNLOCK' as IntentType, actionId: 'vehicle.doors.unlock', risk: 'high',
        requiresConfirmation: false, capability: 'hwUnlockDoors', vehicleScope: null,
        motionPolicy: 'requires_stopped' },
      { intent: 'HARDWARE_FLASH' as IntentType, actionId: 'vehicle.lights.flash', risk: 'low',
        requiresConfirmation: false, capability: 'hwFlashLights', vehicleScope: null, motionPolicy: 'any' },
    ],
    decisions: [
      { intent: 'HARDWARE_UNLOCK', actionId: 'vehicle.doors.unlock', status: 'denied',
        reason: 'vehicle_moving', atMs: NOW - 1_000 },
      { intent: 'HARDWARE_FLASH', actionId: 'vehicle.lights.flash', status: 'allowed',
        reason: 'gate_passed', atMs: NOW - 5_000 },
    ],
    capacity: MAX_ACTION_DECISIONS,
    counters: { evaluated: 2, allowed: 1, denied: 1, confirmationRequired: 0, unsupported: 0, failed: 0 },
    countersSaturated: false,
    pending: { pending: false, actionId: null, ageMs: null, expiresInMs: null },
    ...over,
  };
}

beforeEach(() => {
  _resetActionAuthorityDiagnosticsForTest();
  _resetPendingActionForTest();
});

afterEach(() => {
  _resetActionAuthorityDiagnosticsForTest();
  _resetPendingActionForTest();
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 — Registry'deki bütün actionlar görünür
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 1. defterdeki tüm eylemler görünür', () => {
  it('kaynak katmanı defterdeki HER eylemi taşır (13 eylem)', () => {
    const snap = readActionAuthoritySnapshot();
    const ids = new Set((snap.actions ?? []).map((a) => a.actionId));
    const expected = Object.values(VEHICLE_ACTIONS).map((d) => d!.actionId);
    expect(expected.length).toBe(13);
    for (const id of expected) expect(ids.has(id), `${id} ekranda YOK`).toBe(true);
  });

  it('her satır zorunlu alanları TAŞIR (actionId · risk · onay · capability · scope · motion)', () => {
    const rows = buildAaActionRows(readActionAuthoritySnapshot());
    expect(rows).not.toBeNull();
    for (const r of rows!) {
      expect(typeof r.actionId).toBe('string');
      expect(['low', 'medium', 'high']).toContain(r.risk);
      expect(typeof r.requiresConfirmation).toBe('boolean');
      expect(r.capability === null || typeof r.capability === 'string').toBe(true);
      expect(r.vehicleScope === null || typeof r.vehicleScope === 'string').toBe(true);
      expect(['any', 'requires_stopped']).toContain(r.motionPolicy);
    }
  });

  it('gerçek markup defterdeki her actionId\'yi BASAR', () => {
    const html = renderToStaticMarkup(<ActionAuthorityScreen />);
    for (const def of Object.values(VEHICLE_ACTIONS)) {
      expect(html, `${def!.actionId} render edilmedi`).toContain(def!.actionId);
    }
  });

  it('defter sırası DETERMİNİSTİK (risk yüksek→düşük, sonra actionId)', () => {
    const a = (readActionAuthoritySnapshot().actions ?? []).map((x) => x.actionId);
    const b = (readActionAuthoritySnapshot().actions ?? []).map((x) => x.actionId);
    expect(a).toEqual(b);
    const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const risks = (readActionAuthoritySnapshot().actions ?? []).map((x) => RANK[x.risk] ?? 9);
    expect([...risks].sort((x, y) => x - y)).toEqual(risks);
  });

  it('kaynak okunamazsa `null` → ekran KAYNAK YOK der (sahte boş liste YOK)', () => {
    expect(buildAaActionRows(snapshot({ actions: null }))).toBeNull();
    const html = renderToStaticMarkup(<ActionAuthorityScreen />);
    expect(html).toContain('Eylem Defteri');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 — Son kararlar doğru sırada
 * ════════════════════════════════════════════════════════════════════════ */

/* ⚠️ P0-GÖREV-3: altı donanım eylemi artık AÇIK ONAY ister. Bu dosya LAB gözlem
 * yüzeyini (sıra · ton · sayaç) ölçer, onay kapısını DEĞİL → donanım çağrılarına
 * `confirmed: true` verilir. Onay kapısının kendi kilitleri
 * `hardwareConfirmationGate.test.ts` ve `maviActionAuthority.test.ts` içindedir. */
describe('MAVI-M4-LAB · 2. kararlar EN YENİ → EN ESKİ', () => {
  it('otorite halkası en yeni kararı BAŞA koyar', () => {
    evaluateVehicleAction({ intent: 'HARDWARE_FLASH', vehicleCtx: motion('stopped'), ports: {} });
    evaluateVehicleAction({ intent: 'HARDWARE_UNLOCK', vehicleCtx: motion('moving'), ports: {} });
    const d = getActionAuthorityDiagnostics().decisions;
    expect(d[0]?.actionId).toBe('vehicle.doors.unlock');   // en son değerlendirilen
    expect(d[1]?.actionId).toBe('vehicle.lights.flash');
  });

  it('model kaynaktan gelen sırayı YENİDEN SIRALAMAZ', () => {
    const rows = buildAaDecisionRows(snapshot());
    expect(rows!.map((r) => r.actionId)).toEqual(['vehicle.doors.unlock', 'vehicle.lights.flash']);
  });

  it('karar statüsü doğru tona eşlenir', () => {
    const rows = buildAaDecisionRows(snapshot())!;
    expect(rows[0].tone).toBe('BLOCKED');   // denied
    expect(rows[1].tone).toBe('ALLOWED');
  });

  it('halka GERÇEKTEN boşsa "boş" der; okunamazsa "KAYNAK YOK" der (ayrı durumlar)', () => {
    expect(buildAaDecisionRows(snapshot({ decisions: [] }))).toEqual([]);
    expect(buildAaDecisionRows(snapshot({ decisions: null }))).toBeNull();
  });

  it('damga yoksa "şimdi" UYDURULMAZ', () => {
    const rows = buildAaDecisionRows(snapshot({
      decisions: [{ intent: 'HARDWARE_HORN', actionId: 'vehicle.horn.sound', status: 'allowed', reason: 'x', atMs: null }],
    }))!;
    expect(rows[0].atMs).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 — Pending confirmation YALNIZ VAR/YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 3. bekleyen onay yalnız VAR/YOK', () => {
  it('bekleyen yokken VAR/YOK = YOK ve kimlik KAYNAK YOK', () => {
    const fields = buildAaSections(readActionAuthoritySnapshot())[0].fields;
    expect(fields.find((f) => f.id === 'pending-flag')?.value).toBe('YOK');
    expect(fields.find((f) => f.id === 'pending-action')?.klass).toBe('UNAVAILABLE');
  });

  it('bekleyen VARKEN yalnız bayrak + SABİT actionId + süre gösterilir', () => {
    setPendingAction({ intent: piiIntent(), actionId: 'phone.call.start', turnId: 3, atMs: Date.now() });
    const fields = buildAaSections(readActionAuthoritySnapshot())[0].fields;
    expect(fields.find((f) => f.id === 'pending-flag')?.value).toBe('VAR');
    expect(fields.find((f) => f.id === 'pending-action')?.value).toBe('phone.call.start');
    // Bölümün TAMAMINDA kişi adı/ham metin YOK.
    const all = JSON.stringify(fields);
    expect(all).not.toContain(SECRET_CONTACT);
    expect(all).not.toContain(SECRET_UTTERANCE);
  });

  it('TTL dolmuş istek "YOK" sayılır ve slot MUTASYONA UĞRAMAZ (salt-okunur)', () => {
    const at = Date.now();
    setPendingAction({ intent: piiIntent(), actionId: 'phone.call.start', turnId: 3, atMs: at });
    const d = getPendingActionDiagnostics(at + PENDING_ACTION_TTL_MS + 1);
    expect(d.pending).toBe(false);
    // Gözlem SİLMEDİ: üretim yolu (`peek`) hâlâ kendi TTL kararını verebilir.
    expect(peekPendingAction(at + 1)).not.toBeNull();
  });

  it('onaylama/iptal/çalıştırma butonu YOKTUR — yalnız 2 okuma kontrolü vardır', () => {
    setPendingAction({ intent: piiIntent(), actionId: 'phone.call.start', turnId: 3, atMs: Date.now() });
    const html = renderToStaticMarkup(<ActionAuthorityScreen />);
    /* Etkileşimli öğe SAYISI kilitlenir: yalnız YENİLE + OTOMATİK.
       (Metin taraması yapılmaz — ekranın kendi açıklama cümlesi "iptal etmez"
       gibi ifadeler içerir ve bu bir buton DEĞİLDİR.) */
    expect((html.match(/<button/g) ?? []).length).toBe(2);
    expect(html).toContain('aa-refresh');
    expect(html).toContain('aa-auto-toggle');
    expect(html).not.toMatch(/<input|<form|<select/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 — PII alanları snapshot'ta BULUNMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 4. PII yapısal olarak sızamaz', () => {
  it('bekleyen onay PII taşısa BİLE snapshot metninde görünmez', () => {
    setPendingAction({ intent: piiIntent(), actionId: 'phone.call.start', turnId: 3, atMs: Date.now() });
    const raw = JSON.stringify(readActionAuthoritySnapshot());
    expect(raw).not.toContain(SECRET_CONTACT);
    expect(raw).not.toContain(SECRET_PHONE);
    expect(raw).not.toContain(SECRET_UTTERANCE);
  });

  it('render edilen markup PII İÇERMEZ', () => {
    setPendingAction({ intent: piiIntent(), actionId: 'phone.call.start', turnId: 3, atMs: Date.now() });
    evaluateVehicleAction({ intent: 'OPEN_PHONE', vehicleCtx: motion('stopped'), ports: {}, confirmed: false });
    const html = renderToStaticMarkup(<ActionAuthorityScreen />);
    expect(html).not.toContain(SECRET_CONTACT);
    expect(html).not.toContain(SECRET_PHONE);
    expect(html).not.toContain(SECRET_UTTERANCE);
  });

  it('karar kaydı TİP OLARAK yalnız enum/kimlik/kod/damga taşır', () => {
    evaluateVehicleAction({ intent: 'OPEN_PHONE', vehicleCtx: motion('stopped'), ports: {}, confirmed: false });
    const rec = getActionAuthorityDiagnostics().decisions[0];
    expect(Object.keys(rec).sort()).toEqual(['actionId', 'atMs', 'intent', 'reason', 'status']);
  });

  it('bekleyen onay tanı sözleşmesinde payload alanı YOKTUR', () => {
    setPendingAction({ intent: piiIntent(), actionId: 'phone.call.start', turnId: 3, atMs: Date.now() });
    const d = getPendingActionDiagnostics();
    expect(Object.keys(d).sort()).toEqual(['actionId', 'ageMs', 'expiresInMs', 'pending']);
  });

  it('kaynak modülü onay deposunun MUTASYON yapan API\'lerini ÇAĞIRMAZ', () => {
    const src = stripComments(
      readFileSync(join(process.cwd(), 'src', 'platform', 'devtools', 'actionAuthoritySources.ts'), 'utf8'));
    for (const forbidden of ['consumePendingAction', 'clearPendingAction', 'setPendingAction', 'evaluateVehicleAction']) {
      expect(src, `${forbidden} gözlem katmanında olamaz`).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 — Ekran executor/bridge/OBD çağıramaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 5. salt-okunur (yürütücü çağrısı imkânsız)', () => {
  /* Kaynak kilitleri YALNIZ gerçek koda bakar — belge metni suç değildir
     (bu dosyaların yorumları bilinçli olarak yasak API adlarını ANLATIR). */
  const SCREEN = stripComments(readFileSync(
    join(process.cwd(), 'src', 'components', 'devtools', 'screens', 'ActionAuthorityScreen.tsx'), 'utf8'));
  const MODEL = stripComments(readFileSync(
    join(process.cwd(), 'src', 'platform', 'devtools', 'actionAuthorityModel.ts'), 'utf8'));
  const SOURCES = stripComments(readFileSync(
    join(process.cwd(), 'src', 'platform', 'devtools', 'actionAuthoritySources.ts'), 'utf8'));

  it('ekran yürütücü/köprü/OBD/native modüllerini import ETMEZ', () => {
    for (const forbidden of [
      'commandExecutor', 'intentEngine', 'bridge', 'nativePlugin', 'obdService',
      'dtcService', 'ttsService', 'navigationService', 'remoteCommandService',
    ]) {
      expect(SCREEN, `ekran ${forbidden} import edemez`).not.toMatch(new RegExp(`from '[^']*${forbidden}'`));
    }
  });

  it('ekran hiçbir eylem/onay fonksiyonu ÇAĞIRMAZ', () => {
    for (const forbidden of [
      'executeIntent', 'dispatchIntent', 'routeIntent', 'evaluateVehicleAction',
      'consumePendingAction', 'clearPendingAction', 'setPendingAction',
      'hwLockDoors', 'hwUnlockDoors', 'hwHonkHorn', 'callNumber', 'clearDTCCodes',
    ]) {
      expect(SCREEN, `${forbidden} çağrısı YASAK`).not.toMatch(new RegExp(`${forbidden}\\s*\\(`));
    }
  });

  it('model SAFTIR: I/O · timer · Date.now · React importu YOK', () => {
    expect(MODEL).not.toMatch(/Date\.now\(/);
    expect(MODEL).not.toMatch(/setTimeout\(|setInterval\(/);
    expect(MODEL).not.toMatch(/from 'react'/);
    expect(MODEL).not.toMatch(/localStorage/);
  });

  it('kaynak katmanı senkron ve yan etkisizdir (await YOK)', () => {
    expect(SOURCES).not.toMatch(/\bawait\b/);
    expect(SOURCES).not.toMatch(/setInterval\(|setTimeout\(/);
    expect(SOURCES).not.toMatch(/addEventListener\(/);
  });

  it('okuma otoritenin SAYAÇLARINI kirletmez (gözlem karar üretmez)', () => {
    readActionAuthoritySnapshot();
    readActionAuthoritySnapshot();
    readActionAuthoritySnapshot();
    expect(getActionAuthorityDiagnostics().counters.evaluated).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6/7 — Polling yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 6/7. polling ve temizlik', () => {
  /* ⚠️ DÜRÜST SINIR: bu repoda `@testing-library/react` YOK ve jsdom'da
   * `react-dom/client` createRoot ÇALIŞMIYOR (bkz. carosLab.test.tsx notu) →
   * `renderToStaticMarkup` EFFECT ÇALIŞTIRMAZ. Bu yüzden "timer kuruldu mu"
   * RUNTIME'da ölçülemez; buradaki kilitler YAPISALDIR (varsayılan durum +
   * effect gövdesi + cleanup). Timer'ın cihazda gerçekten kurulmadığı/temizlendiği
   * saha doğrulama kütüğüne 🔴 madde olarak yazılmıştır — burada "ölçüldü" DENMEZ. */
  it('6. otomatik yenileme VARSAYILAN KAPALI (yapısal: başlangıç durumu false)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'devtools', 'screens', 'ActionAuthorityScreen.tsx'), 'utf8');
    expect(src).toMatch(/useState\(false\)/);
    // Açılışta okuma TEK seferliktir (lazy initializer) — render başına okuma YOK.
    expect(src).toMatch(/useState<AaRawSnapshot>\(\(\) => readActionAuthoritySnapshot\(\)\)/);
    // İlk markup "KAPALI" durumunu gösterir → kullanıcıya da yalan söylenmez.
    expect(renderToStaticMarkup(<ActionAuthorityScreen />)).toContain('KAPALI');
  });

  it('6b. ekran KAPALIYKEN host bileşeni hiç render etmez → polling yapısal olarak imkânsız', () => {
    // `{open && <X/>}` deseni: kapalıyken ağaçta bileşen YOKTUR.
    expect(shouldRenderCarosLab('none', true)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', true)).toBe(true);
  });

  it('7. timer YALNIZ `auto` açıkken kurulur ve cleanup MUTLAKA temizler', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'devtools', 'screens', 'ActionAuthorityScreen.tsx'), 'utf8');
    const block = src.slice(src.indexOf('if (!auto) return;'), src.indexOf('const sections'));
    expect(block).toMatch(/setInterval\(/);
    expect(block).toMatch(/clearInterval\(/);
    // `auto` kapalıyken effect erken döner → timer hiç kurulmaz.
    expect(block.indexOf('if (!auto) return;')).toBeLessThan(block.indexOf('setInterval('));
  });

  it('7b. unmount sonrası setState YASAK (mountedRef kapısı var)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'devtools', 'screens', 'ActionAuthorityScreen.tsx'), 'utf8');
    expect(src).toMatch(/mountedRef\.current = false/);
    expect(src).toMatch(/if \(!mountedRef\.current\) return/);
  });

  it('7c. yenileme periyodu DÜŞÜK frekanstır (≥ 2 sn)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'devtools', 'screens', 'ActionAuthorityScreen.tsx'), 'utf8');
    const m = src.match(/AUTO_REFRESH_MS\s*=\s*([\d_]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ''))).toBeGreaterThanOrEqual(2_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 — Bounded kayıt sınırı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 8. bounded halka', () => {
  it('kapasite aşılsa bile kayıt sayısı SABİT kalır (bellek büyümez)', () => {
    for (let i = 0; i < MAX_ACTION_DECISIONS * 3; i++) {
      evaluateVehicleAction({ intent: 'HARDWARE_FLASH', vehicleCtx: motion('stopped'), ports: {} });
    }
    const d = getActionAuthorityDiagnostics();
    expect(d.decisions.length).toBe(MAX_ACTION_DECISIONS);
    expect(d.counters.evaluated).toBe(MAX_ACTION_DECISIONS * 3);   // sayaç sayar, halka taşmaz
  });

  it('en ESKİ kayıt düşer, en YENİ kalır (dairesel tampon)', () => {
    evaluateVehicleAction({ intent: 'HARDWARE_HORN', vehicleCtx: motion('stopped'), ports: {} });
    for (let i = 0; i < MAX_ACTION_DECISIONS; i++) {
      evaluateVehicleAction({ intent: 'HARDWARE_FLASH', vehicleCtx: motion('stopped'), ports: {} });
    }
    const ids = getActionAuthorityDiagnostics().decisions.map((d) => d.actionId);
    expect(ids).not.toContain('vehicle.horn.sound');   // taştı
    expect(ids.length).toBe(MAX_ACTION_DECISIONS);
  });

  it('model satır tavanı da bounded (render bütçesi)', () => {
    const many = Array.from({ length: MAX_AA_DECISION_ROWS + 25 }, (_, i) => ({
      intent: 'HARDWARE_FLASH', actionId: 'vehicle.lights.flash',
      status: 'allowed', reason: 'gate_passed', atMs: NOW - i,
    }));
    expect(buildAaDecisionRows(snapshot({ decisions: many }))!.length).toBe(MAX_AA_DECISION_ROWS);
  });

  it('sayaçlar doyar — taşma yok (tavan sözleşmesi)', () => {
    expect(getActionAuthorityDiagnostics().countersSaturated).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 — Developer gate + katalog/ekran bütünlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 9. developer gate korunur', () => {
  it('LAB kapısı build bayrağına bağlı kalır (yeni bypass YOK)', () => {
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: true })).toBe(true);
    expect(isCarosLabAllowed(null)).toBe(false);
    // Kapı kapalıyken route de kapalıdır (fail-closed) → ekran hiç mount olmaz.
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
  });

  it('katalog girdisi AVAILABLE ve gizlilik notu TAŞIR', () => {
    const tool = getCarosLabTool('action-registry');
    expect(tool?.status).toBe('AVAILABLE');
    expect(tool?.category).toBe('ai');
    expect(tool?.note ?? '').toMatch(/GİZLİLİK/);
  });

  it('ekran haritası katalogla AYRIŞMAZ (AVAILABLE → gerçek ekran)', () => {
    expect(renderAvailableTool('action-registry')).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 — M4 authority davranışı DEĞİŞMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB · 10. gözlem kararı ETKİLEMEZ', () => {
  it('kapı kararları gözlem eklendikten sonra AYNEN korunur', () => {
    const moving = evaluateVehicleAction({ intent: 'HARDWARE_UNLOCK', vehicleCtx: motion('moving'), ports: {} });
    expect(moving.allow).toBe(false);
    expect(moving.allow === false && moving.result.reason).toBe('vehicle_moving');

    const unconfirmed = evaluateVehicleAction({ intent: 'CLEAR_DTC_CODES', vehicleCtx: motion('stopped'), ports: {} });
    expect(unconfirmed.allow === false && unconfirmed.result.status).toBe('needs_confirmation');

    /* P0-GÖREV-3: korna artık AÇIK ONAY ister → port kapısını ölçmek için
       onay VERİLİR (bu test kapı SIRASINI ölçer, onay politikasını değil). */
    const noPort = evaluateVehicleAction({ intent: 'HARDWARE_HORN', vehicleCtx: motion('stopped'), ports: {}, confirmed: true });
    expect(noPort.allow === false && noPort.result.reason).toBe('no_port');

    const ok = evaluateVehicleAction({
      intent: 'HARDWARE_HORN', vehicleCtx: motion('stopped'), ports: { hwHonkHorn: () => {} }, confirmed: true,
    });
    expect(ok.allow).toBe(true);
  });

  it('defter DIŞI intent sayaçları KİRLETMEZ', () => {
    evaluateVehicleAction({ intent: 'OPEN_MUSIC', vehicleCtx: motion('stopped'), ports: {} });
    expect(getActionAuthorityDiagnostics().counters.evaluated).toBe(0);
  });

  it('sayaçlar gerçek karar dağılımını yansıtır', () => {
    evaluateVehicleAction({ intent: 'HARDWARE_UNLOCK', vehicleCtx: motion('moving'), ports: {} });
    evaluateVehicleAction({ intent: 'CLEAR_DTC_CODES', vehicleCtx: motion('stopped'), ports: {} });
    evaluateVehicleAction({ intent: 'HARDWARE_HORN', vehicleCtx: motion('stopped'), ports: {}, confirmed: true });
    evaluateVehicleAction({ intent: 'HARDWARE_HORN', vehicleCtx: motion('stopped'), ports: { hwHonkHorn: () => {} }, confirmed: true });
    const c = getActionAuthorityDiagnostics().counters;
    expect(c).toEqual({
      evaluated: 4, allowed: 1, denied: 1, confirmationRequired: 1, unsupported: 1, failed: 0,
    });
  });

  it('gözlem sınıflandırması Session Inspector sözleşmesini KULLANIR (paralel sistem YOK)', () => {
    const counts = countByAaClass(buildAaSections(readActionAuthoritySnapshot()));
    expect(Object.keys(counts).sort()).toEqual(['DERIVED', 'OBSERVED', 'STALE', 'UNAVAILABLE']);
  });
});
