/**
 * runtimeModeGates.test.ts — V-17 çalışma zamanı mod kapılarının KİLİTLERİ.
 *
 * ── KAPATILAN BOŞLUK ───────────────────────────────────────────────────────
 * `_detectCapabilities()` yalnız SONUCU (BASIC_JS) dönüyordu; HANGİ kapının
 * indirdiği kayboluyordu. Vizyon planı bu boşluğu tahminle doldurdu ve YANLIŞ
 * doldurdu: nedeni "COEP kapalı → SAB yok" sandı ve pahalı bir çözüm önerdi
 * (medya iframe'lerini ayrı origin'e taşımak). Oysa kapılar SIRALIDIR ve SAB
 * SONUNCUDUR — hedef donanımda `deviceTier`/`weakGpu` çok daha önce tetikler.
 *
 * Kilitler dört şeyi korur:
 *  (A) Kapı tablosunun TEK OTORİTE olduğu (üretim yolu mantığı KOPYALAMAZ)
 *  (B) Üretim yolunun KISA DEVRE kaldığı (düşük tier'da fazladan probe YOK)
 *  (C) "Tek suçlu" yanılsamasının modelde ENGELLENDİĞİ
 *  (D) LAB ekranının salt-okunur olduğu
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import {
  buildGateRows, deriveModeVerdict, softwareFixWouldUnlock, buildModeFields,
  GATE_FIXABLE, type GateViewRow,
} from '../platform/devtools/runtimeModeModel';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MGR = 'src/core/runtime/AdaptiveRuntimeManager.ts';

const rows = (spec: ReadonlyArray<[GateViewRow['id'], boolean]>): readonly GateViewRow[] =>
  buildGateRows(spec.map(([id, blocking]) => ({ id, blocking, observed: 'x' })), null);

/* ══════════════════════════════════════════════════════════════════════════
 * A) TEK OTORİTE
 * ═════════════════════════════════════════════════════════════════════════ */
describe('mod kapıları › tek otorite', () => {
  const src = stripComments(read(MGR));

  it('üretim yolu kapı mantığını KOPYALAMAZ — tabloyu kullanır', () => {
    const fn = src.slice(src.indexOf('private _detectCapabilities'), src.indexOf('setMode(newMode'));
    expect(fn).toMatch(/firstBlockingModeGate\(\)/);
    /* Kapı koşulları burada TEKRAR yazılmamalı — yazılırsa iki otorite doğar
       ve LAB ile üretim sessizce ayrışır. */
    expect(fn).not.toMatch(/getDeviceTier\(\)/);
    expect(fn).not.toMatch(/hasWeakGpu\(\)/);
    expect(fn).not.toMatch(/crossOriginIsolated/);
  });

  it('dört kapı da tabloda tanımlı ve sıra korunuyor', () => {
    const table = src.slice(src.indexOf('const MODE_GATES'), src.indexOf('function firstBlockingModeGate'));
    const ids = [...table.matchAll(/id: '(deviceTier|weakGpu|worker|sab)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['deviceTier', 'weakGpu', 'worker', 'sab']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) ÜRETİM YOLU KISA DEVRE
 * ═════════════════════════════════════════════════════════════════════════ */
describe('mod kapıları › üretim yolu', () => {
  const src = stripComments(read(MGR));

  it('ilk engelleyen kapıda DURUR — sonrakileri çalıştırmaz', () => {
    const fn = src.slice(src.indexOf('function firstBlockingModeGate'), src.indexOf('export function traceModeGates'));
    /* `return` döngü İÇİNDE olmalı: `hasWeakGpu()` ilk çağrıda WebGL probe'u
       koşar; düşük tier'da o probe'u açılışta yapmak tam da kaçındığımız iştir. */
    expect(fn).toMatch(/for \(const g of MODE_GATES\)[\s\S]*return g\.id/);
  });

  it('ölçülemeyen kapı ENGELLEMEZ (fail-soft, mevcut davranış)', () => {
    const fn = src.slice(src.indexOf('function firstBlockingModeGate'), src.indexOf('export function traceModeGates'));
    expect(fn).toMatch(/catch/);
  });

  it('LAB izi TÜM kapıları değerlendirir — kısa devre YAPMAZ', () => {
    const fn = src.slice(src.indexOf('export function traceModeGates'), src.indexOf('\n}', src.indexOf('export function traceModeGates')));
    expect(fn).toMatch(/gates\.push/);
    expect(fn).not.toMatch(/return .*decidedBy;/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) "TEK SUÇLU" YANILSAMASI ENGELLİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('mod kapıları › tek suçlu yanılsaması', () => {
  it('donanım kapıları yazılımla AÇILAMAZ işaretli', () => {
    expect(GATE_FIXABLE.deviceTier).toBe(false);
    expect(GATE_FIXABLE.weakGpu).toBe(false);
    expect(GATE_FIXABLE.sab).toBe(true);
  });

  it('SAB tek başına engelliyorsa yazılım çözümü AÇAR', () => {
    const r = rows([['deviceTier', false], ['weakGpu', false], ['worker', false], ['sab', true]]);
    expect(softwareFixWouldUnlock(r)).toBe(true);
    expect(deriveModeVerdict(r)).toBe('SOFTWARE_BOUND');
  });

  it('ASIL KİLİT: donanım da engelliyorsa COEP çözümü AÇMAZ', () => {
    /* Hedef donanım (K24 · Mali-400): weakGpu VE sab birlikte engelliyor.
       Planın önerdiği pahalı COEP çözümü modu DEĞİŞTİRMEZDİ. */
    const r = rows([['deviceTier', false], ['weakGpu', true], ['worker', false], ['sab', true]]);
    expect(softwareFixWouldUnlock(r)).toBe(false);
    expect(deriveModeVerdict(r)).toBe('MIXED_BLOCKED');
  });

  it('yalnız donanım engelliyorsa DONANIM SINIRI', () => {
    const r = rows([['deviceTier', true], ['weakGpu', true], ['worker', false], ['sab', false]]);
    expect(deriveModeVerdict(r)).toBe('HARDWARE_BOUND');
    expect(softwareFixWouldUnlock(r)).toBe(false);
  });

  it('hiçbiri engellemiyorsa ENGEL YOK', () => {
    const r = rows([['deviceTier', false], ['weakGpu', false], ['worker', false], ['sab', false]]);
    expect(deriveModeVerdict(r)).toBe('UNBLOCKED');
    /* Engel yokken "yazılım çözersem açılır" DEMEZ — açılacak bir şey yok. */
    expect(softwareFixWouldUnlock(r)).toBe(false);
  });

  it('okunamadı, "engel yok" ile KARIŞTIRILMAZ', () => {
    expect(deriveModeVerdict(null)).toBe('UNAVAILABLE');
    expect(softwareFixWouldUnlock(null)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) MODEL DÜRÜSTLÜĞÜ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('mod kapıları › model dürüstlüğü', () => {
  const base = {
    activeMode: 'BASIC_JS', detectedMode: 'BASIC_JS',
    rows: rows([['deviceTier', false], ['weakGpu', true], ['worker', false], ['sab', true]]),
    powerCeiling: null, recoveryTarget: null, failedComponents: [],
    lastChange: null, partial: false,
  };

  it('tespit ile yürürlük AYNI ise "otorite devralmamış" der', () => {
    const f = buildModeFields(base);
    expect(f.find((x) => x.id === 'rm-divergence')!.value).toBe('AYNI');
  });

  it('tespit ile yürürlük FARKLI ise sebebin kapılarda OLMADIĞINI söyler', () => {
    const f = buildModeFields({ ...base, activeMode: 'SAFE_MODE' });
    const d = f.find((x) => x.id === 'rm-divergence')!;
    expect(d.value).toMatch(/FARKLI/);
    expect(d.note).toMatch(/kapılarda DEĞİL/);
  });

  it('mod hiç değişmediyse SAHTE bir değişim kaydı üretmez', () => {
    const f = buildModeFields(base);
    const last = f.find((x) => x.id === 'rm-last')!;
    expect(last.value).toBe('değişmedi');
    /* Zaman damgası UYDURULMAZ: değişim olmadığı için damga da YOKTUR. */
    expect(typeof last.updatedAt).not.toBe('number');
  });

  it('güç tavanı YOKSA bu ölçülmüş bir "yok"tur, okunamadı DEĞİL', () => {
    const f = buildModeFields(base);
    expect(f.find((x) => x.id === 'rm-power')!.klass).toBe('OBSERVED');
  });

  it('mod okunamadıysa BASIC_JS ile karıştırılmaz', () => {
    const f = buildModeFields({ ...base, activeMode: null });
    const a = f.find((x) => x.id === 'rm-active')!;
    expect(a.klass).toBe('UNAVAILABLE');
    expect(a.value).not.toBe('BASIC_JS');
  });

  it('kısmi okuma AÇIKÇA bildirilir — tablo tam sanılmaz', () => {
    const f = buildModeFields({ ...base, partial: true });
    expect(f.some((x) => x.id === 'rm-partial')).toBe(true);
  });

  it('birden çok kapı engelliyorsa HEPSİ listelenir', () => {
    const f = buildModeFields(base);
    const b = f.find((x) => x.id === 'rm-blocking')!;
    expect(String(b.value)).toContain('GPU');
    expect(String(b.value)).toContain('SAB');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E) LAB EKRANI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('mod kapıları › LAB ekranı', () => {
  it('katalog AVAILABLE ve gerçek ekran eşlemesi var', async () => {
    const { getCarosLabTool } = await import('../platform/devtools/carosLabCatalog');
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');
    expect(getCarosLabTool('runtime-mode')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('runtime-mode')).not.toBeNull();
  });

  it('saf model I/O · timer · Date.now İÇERMEZ', () => {
    const m = stripComments(read('src/platform/devtools/runtimeModeModel.ts'));
    expect(m).not.toMatch(/Date\.now\(/);
    expect(m).not.toMatch(/setInterval|setTimeout/);
  });

  it('ekran MOD DEĞİŞTİRMEZ ve timer kurmaz', () => {
    const scr = stripComments(read('src/components/devtools/screens/RuntimeModeScreen.tsx'));
    expect(scr).not.toMatch(/setInterval\(/);
    expect(scr).not.toMatch(/setMode|runtimeOverride|reportFailure/);
    expect(scr).toContain('mountedRef');
  });

  it('okuma katmanının her getter\'ı kendi try/catch\'inde', () => {
    const s = stripComments(read('src/platform/devtools/runtimeModeSources.ts'));
    /* Tek bir kaynağın patlaması diğerlerini götürmemeli. */
    expect((s.match(/try \{/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
