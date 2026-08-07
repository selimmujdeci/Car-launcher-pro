/**
 * maviScenarioRunner.test.ts — CAROS LAB deterministik Mavi senaryo koşucusu (Görev 4).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Determinizm — aynı fixture seti iki koşuda AYNI sonuç.
 *  2-6. Gerçek EventBus / TTS / telefon / navigasyon / storage / ağ / OBD DOKUNULMAZ.
 *  7. Bir senaryo FAIL olsa da kalanlar koşar.
 *  8. Senaryolar arası state SIZMAZ.
 *  9. Developer gate kapalıyken CAROS LAB (dolayısıyla panel) render EDİLMEZ.
 * 10. Sonuç listesi BOUNDED.
 * 11. Active Topic snapshot PII-safe.
 * 12. Diagnostic trail GERÇEK Görev 3 kaynağından okunur.
 * 13. "Simülasyon" etiketi UI'dan kaldırılamaz.
 * 14. Koşu sonucu cihaz/araç doğrulaması olarak SINIFLANDIRILMAZ.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  runMaviScenarios, listMaviScenarioIds,
  SCENARIO_SIMULATION_LABEL, MAX_SCENARIO_RESULTS, MAX_SCENARIO_TEXT,
} from '../platform/devtools/maviScenarioRunner';
import { getActiveTopicSnapshot, _resetCompanionChatForTest } from '../platform/companion/companionChatProvider';
import { _resetAiOfflineReasonForTest } from '../platform/ai/aiOfflineReason';
import { _resetDiagnosticTrailForTest } from '../platform/diagnosticTrail';
import { getOwnTrail } from '../platform/diagnosticTrailCore';
import { shouldRenderCarosLab } from '../platform/devtools/carosLabGate';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf-8');
const RUNNER_SRC = read('src', 'platform', 'devtools', 'maviScenarioRunner.ts');
const SCREEN_SRC = read('src', 'components', 'devtools', 'screens', 'MaviConsoleScreen.tsx');

/** Yorumları sıyır — kural KODU bağlar, açıklama metnini değil. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const RUNNER_CODE = stripComments(RUNNER_SRC);

beforeEach(() => {
  _resetCompanionChatForTest();
  _resetAiOfflineReasonForTest();
  _resetDiagnosticTrailForTest();
});
afterEach(() => { vi.restoreAllMocks(); });

/* ── 1. Determinizm ────────────────────────────────────────── */

describe('1 — determinizm', () => {
  it('iki koşu BİREBİR aynı raporu üretir', () => {
    const a = runMaviScenarios();
    const b = runMaviScenarios();
    expect(a.results.map((r) => [r.id, r.pass, r.expected, r.actual, r.reasonCode, r.confidence]))
      .toEqual(b.results.map((r) => [r.id, r.pass, r.expected, r.actual, r.reasonCode, r.confidence]));
    expect(a.passed).toBe(b.passed);
    expect(a.failed).toBe(b.failed);
  });

  it('14 zorunlu senaryonun HEPSİ koşar ve PASS eder', () => {
    const s = runMaviScenarios();
    expect(s.total).toBe(14);
    expect(s.failed, `FAIL: ${s.results.filter((r) => !r.pass).map((r) => `${r.id}(${r.actual})`).join(', ')}`).toBe(0);
    expect(listMaviScenarioIds()).toHaveLength(14);
  });

  it('sanal süre gerçek saatten BAĞIMSIZ (enjekte clock)', () => {
    const s = runMaviScenarios();
    for (const r of s.results) expect(Number.isFinite(r.virtualElapsedMs)).toBe(true);
    // Debounce senaryosu saati İLERLETİR → gerçek saatte değil sanal saatte.
    expect(s.results.find((r) => r.id === 'proactive-debounce')!.virtualElapsedMs).toBeGreaterThan(0);
    expect(s.results.find((r) => r.id === 'high-risk-needs-confirmation')!.virtualElapsedMs).toBe(0);
  });
});

/* ── 2-6. Üretim yan etkisi YOK ────────────────────────────── */

describe('2-6 — gerçek sisteme yan etki YOK', () => {
  it('ağ çağrısı YAPILMAZ (fetch hiç çağrılmaz)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    runMaviScenarios();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('storage YAZILMAZ (localStorage.setItem hiç çağrılmaz)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    runMaviScenarios();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('KAYNAK KİLİDİ: EventBus · TTS · OBD · navigasyon · storage · timer import EDİLMEZ', () => {
    for (const forbidden of [
      'platformEventBus', 'EventBusWiring', '.publish(',
      'ttsService', 'speakAlert', 'speakSafetyAlert',
      'obdService', 'navigationService', 'resolveAndNavigate',
      'safeStorage', 'safeSetRaw', 'localStorage',
      'setInterval', 'setTimeout', 'requestAnimationFrame',
    ]) {
      expect(RUNNER_CODE, `runner '${forbidden}' kullanmamalı`).not.toContain(forbidden);
    }
  });

  it('KAYNAK KİLİDİ: üretim tekilleri MONKEY PATCH edilmez (fabrika kullanılır)', () => {
    // Tekil ÖRNEKLER (küçük harfle başlayan singleton'lar) ne import edilir ne
    // de üyelerine erişilir; yerlerine sınıf/fabrika kullanılır.
    // (Dosya YOLLARINDA aynı ad geçebilir — kural BAĞLAYICI ADI hedefler.)
    expect(RUNNER_CODE).not.toMatch(/\bdeepScanRuntimeService\s*\./);
    expect(RUNNER_CODE).not.toMatch(/\bdeepScanIgnitionSource\s*\./);
    expect(RUNNER_CODE).not.toMatch(/import\s*\{[^}]*\bdeepScanRuntimeService\b[^}]*\}/);
    expect(RUNNER_CODE).not.toMatch(/import\s*\{[^}]*\bdeepScanIgnitionSource\b[^}]*\}/);
    expect(RUNNER_CODE).toContain('new DeepScanRuntimeService(');
    expect(RUNNER_CODE).toContain('createDeepScanIgnitionSource(');
  });

  it('telefon/navigasyon portları ÇAĞRILMAZ — handler bunlara dokunmadan reddeder', () => {
    const s = runMaviScenarios();
    const notConnected = s.results.find((r) => r.id === 'phone-not-connected')!;
    const noTransport = s.results.find((r) => r.id === 'phone-transport-missing')!;
    expect(notConnected.pass).toBe(true);
    expect(notConnected.actual).toContain('PHONE_NOT_CONNECTED');
    expect(noTransport.actual).toContain('PHONE_TRANSPORT_MISSING');
  });
});

/* ── 7 + 8. Fail izolasyonu ve state sızıntısı ─────────────── */

describe('7/8 — izolasyon', () => {
  it('bir senaryo FAIL olsa bile kalanlar koşar (throw koşuyu DURDURMAZ)', () => {
    // Debounce senaryosunun bağımlı olduğu modül durumunu bozmadan, GERÇEK
    // fail-soft yolunu doğrulamak için raporun kendi sözleşmesini kullanırız:
    // runner her senaryoyu try/catch içinde koşar ve errorCode ile FAIL raporlar.
    expect(RUNNER_CODE).toMatch(/try \{[\s\S]*?s\.run\(clock\)[\s\S]*?\} catch/);
    expect(RUNNER_CODE).toContain('errorCode');
    // Ve koşu her hâlükârda TÜM senaryoları kapsar.
    expect(runMaviScenarios().total).toBe(listMaviScenarioIds().length);
  });

  it('proaktif debounce durumu senaryolar arasında SIZMAZ', () => {
    // 1. senaryo konuşur (debounce anahtarı yazar); 12. senaryo aynı anahtarla
    // YENİDEN konuşabilmeli → izolasyon çalışıyor demektir.
    const s = runMaviScenarios();
    expect(s.results.find((r) => r.id === 'critical-dtc-speaks')!.pass).toBe(true);
    expect(s.results.find((r) => r.id === 'proactive-debounce')!.pass).toBe(true);
    expect(RUNNER_CODE).toContain('_resetCompanionChatForTest');
  });

  it('koşu sonrası üretim modül durumu TEMİZ bırakılır', () => {
    runMaviScenarios();
    expect(getActiveTopicSnapshot().topic).toBeNull();
  });
});

/* ── 9. Developer gate ─────────────────────────────────────── */

describe('9 — developer gate kapalıyken UI yok', () => {
  it('gate kapalıyken CAROS LAB (ve içindeki panel) RENDER EDİLMEZ', () => {
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', true)).toBe(true);
    // Panel ayrı bir kapı KURMAZ; Mavi Konsolu ekranının içindedir.
    expect(SCREEN_SRC).toContain('mavi-scenario-panel');
  });
});

/* ── 10. Bounded rapor ─────────────────────────────────────── */

describe('10 — sonuçlar bounded ve PII\'siz', () => {
  it('liste ve metin alanları tavanı aşmaz', () => {
    const s = runMaviScenarios();
    expect(s.results.length).toBeLessThanOrEqual(MAX_SCENARIO_RESULTS);
    for (const r of s.results) {
      expect(r.expected.length).toBeLessThanOrEqual(MAX_SCENARIO_TEXT);
      expect(r.actual.length).toBeLessThanOrEqual(MAX_SCENARIO_TEXT);
      if (r.evidenceSummary) expect(r.evidenceSummary.length).toBeLessThanOrEqual(MAX_SCENARIO_TEXT);
    }
  });

  it('ham prompt · chain-of-thought · anahtar · seslendirilen tam metin RAPORA girmez', () => {
    const blob = JSON.stringify(runMaviScenarios());
    for (const leak of [
      'system_instruction', 'chain-of-thought', 'Düşünce:', 'apiKey', 'Bearer ',
      'contents', 'generationConfig', 'AIza',
    ]) {
      expect(blob, `rapor '${leak}' taşımamalı`).not.toContain(leak);
    }
  });

  it('güven KAYNAĞI yoksa alan HİÇ yazılmaz (sahte değer YOK)', () => {
    const s = runMaviScenarios();
    for (const r of s.results) {
      // Değer varsa ölçek de VAR; biri varken diğeri eksik OLAMAZ.
      expect(r.confidence === undefined).toBe(r.confidenceScale === undefined);
    }
    // Güven kaynağı olmayan senaryolarda alan hiç yok.
    expect(s.results.find((r) => r.id === 'phone-not-connected')!.confidence).toBeUndefined();
  });
});

/* ── 11 + 12. Mevcut kaynaklar yeniden kullanılır ──────────── */

describe('11/12 — mevcut gözlem kaynakları (paralel model YOK)', () => {
  it('Active Topic için MEVCUT PII-safe snapshot kullanılır', () => {
    expect(RUNNER_CODE).toContain('getActiveTopicSnapshot');
    const snap = getActiveTopicSnapshot();
    // Yalnız allowlist kimliği + tazelik + tur farkı — serbest metin YOK.
    expect(Object.keys(snap).sort()).toEqual(['freshness', 'topic', 'turnsAgo']);
    const hint = runMaviScenarios().results.find((r) => r.id === 'active-topic-hint')!;
    expect(hint.pass).toBe(true);
    expect(hint.actual).toContain('serbestMetin=RED');   // ham DTC kodu konu OLAMAZ
  });

  it('diagnostic trail GERÇEK Görev 3 kaynağından okunur (kopya depo YOK)', () => {
    // Ağır taraf DEĞİL, YAZMA çekirdeği okunur — kararlar tam oraya yazılır.
    expect(RUNNER_CODE).toContain('getOwnTrail');
    const s = runMaviScenarios();
    // Koşu sırasında konuşulan/susturulan kararlar GERÇEK ize yazılır.
    const realRows = getOwnTrail().filter((e) => e.label.startsWith('mavi proaktif:'));
    expect(s.trailRowCount).toBe(realRows.length);
    expect(s.trailRowCount).toBeGreaterThan(0);
  });
});

/* ── 13 + 14. Simülasyon beyanı ────────────────────────────── */

describe('13/14 — "SİMÜLASYON" beyanı kaldırılamaz', () => {
  it('etiket metni doğrulama iddiası TAŞIMAZ ve rapora gömülüdür', () => {
    expect(SCENARIO_SIMULATION_LABEL).toContain('SİMÜLASYON');
    expect(SCENARIO_SIMULATION_LABEL).toContain('DEĞİLDİR');
    expect(runMaviScenarios().label).toBe(SCENARIO_SIMULATION_LABEL);
  });

  it('UI etiketi ve uyarı metni ekranda ZORUNLU', () => {
    expect(SCREEN_SRC).toContain('SCENARIO_SIMULATION_LABEL');
    expect(SCREEN_SRC).toContain('mavi-scenario-simulation-label');
    expect(SCREEN_SRC).toContain('cihaz veya araç doğrulaması DEĞİLDİR');
  });

  it('koşu sonucu cihaz/araç doğrulaması olarak SINIFLANDIRILMAZ', () => {
    const s = runMaviScenarios();
    const blob = JSON.stringify(s);
    // "DOĞRULANDI"/"SAHADA" gibi saha-kanıtı dili rapora GİRMEZ.
    for (const claim of ['SAHADA DOĞRULANDI', 'cihazda doğrulandı', 'DEVICE VALIDATED']) {
      expect(blob).not.toContain(claim);
    }
    // Runner kütüğü de değiştiremez (storage/dosya yazma yolu YOK — üstteki kilitler).
    expect(s.label).toContain('DEĞİLDİR');
  });
});
