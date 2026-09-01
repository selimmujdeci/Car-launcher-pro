/**
 * carosLabMaviConsole.test.tsx — CAROS LAB Faz A7 KİLİTLERİ.
 *
 * ANA İLKELER:
 *  1. GİZLİLİK YAPISALDIR: transcript · lastCommand · history · öneri metni ve hata
 *     MESAJI ne modele girer ne render'a çıkar. Kilitler bunu HEM tip yüzeyinden
 *     HEM gerçek markup'tan doğrular.
 *  2. Kaynak yoksa UNAVAILABLE — sahte sağlıklı / sahte 0 / sahte tarih YOK.
 *  3. Hüküm FAIL-CLOSED ve sıralıdır; bilinmeyen durum TAHMİN EDİLMEZ.
 *  4. Timer/abonelik/polling YOK; açılışta tek okuma + elle YENİLE.
 *  5. A4 / A5 / A6 / UX-F1 kilitleri zayıflatılmaz.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  buildMaviSections, buildMaviDiagRows, deriveMaviVerdict, countByMaviClass,
  MAVI_VERDICT_LABEL, MAVI_ACTIVE_VOICE_STATUS, MAVI_WAITING_VOICE_STATUS,
  MAVI_KNOWN_VOICE_STATUS, MAX_MAVI_DIAG_ROWS, MAX_FIELDS_PER_MAVI_SECTION,
  type MaviRawSnapshot, type MaviSection, type MaviDiagRaw,
} from '../platform/devtools/maviConsoleModel';
import { readMaviConsoleSnapshot } from '../platform/devtools/maviConsoleSources';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { MaviConsoleScreen } from '../components/devtools/screens/MaviConsoleScreen';
import { CarosLabShell } from '../components/devtools/CarosLabShell';
import { VOICE_DIAG_STAGES } from '../platform/voiceDiagService';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture — SIZDIRILMASI YASAK metinler burada tanımlıdır
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

/** Bu diziler markup'ta veya model çıktısında GÖRÜNMEMELİDİR. */
const SECRET_TRANSCRIPT = 'klimayi yirmi iki dereceye ayarla';
const SECRET_COMMAND    = 'set_climate_temperature';
const SECRET_HISTORY    = 'eve gidelim mi';

function snapshot(over: Partial<MaviRawSnapshot> = {}): MaviRawSnapshot {
  return {
    readAt: NOW,
    voice: {
      status: 'idle', micAvailable: true, volumeLevel: 0,
      followUp: false, suggestionCount: 2, historyCount: 3,
      hasLastCommand: true, hasTranscript: true, hasError: false,
    },
    diag: [
      { at: NOW - 1_000, stage: 'voice_success', transcriptLength: 31, errorCode: null, route: 'companion_gemini', intent: 'climate' },
      { at: NOW - 5_000, stage: 'voice_intent',  transcriptLength: 31, errorCode: null, route: null, intent: 'climate' },
      { at: null,        stage: 'voice_start',   transcriptLength: null, errorCode: null, route: null, intent: null },
    ],
    aiHealth: { healthy: true, consecFails: 0, consecTimeouts: 0, blockedForMs: 0 },
    quota: { geminiCooldownMs: 0, groqCooldownMs: 0, haikuCooldownMs: 0 },
    proactive: {
      spokenCount: 0, suppressedCount: 0, lastAlertKey: null,
      debounceRemainingMs: 0, lastSuppressReason: null,
    },
    ...over,
  };
}

function findField(sections: readonly MaviSection[], id: string) {
  for (const s of sections) for (const f of s.fields) if (f.id === id) return f;
  return null;
}

function section(sections: readonly MaviSection[], id: string) {
  return sections.find((s) => s.id === id)!;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

afterEach(() => { vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 1 — kaynak katmanı DOĞRU kaynaklardan okur
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — kaynak katmanı gerçek getter\'ları kullanır', () => {
  // KİLİT GÜNCELLENDİ (4→5): proaktif kritik arıza uyarısı motoru gözlem yüzeyi
  // eklendi (ZORUNLU GÖZLEMLENEBİLİRLİK kuralı). Kilit KALDIRILMADI, genişletildi.
  it('beş kaynak da doğru modülden import edilir', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/platform/devtools/maviConsoleSources.ts', 'utf8');
    expect(src).toContain("import { getVoiceSnapshot } from '../voiceService'");
    expect(src).toContain("import { getRecentVoiceDiag } from '../voiceDiagService'");
    expect(src).toContain("import { getAiHealthSnapshot } from '../aiHealth'");
    expect(src).toContain("import { getProviderQuotaSnapshot, getProactiveAlertDiagnostics } from '../companion/companionChatProvider'");
    expect(src).toContain("import { getProactiveSuppressionHistory } from '../ai/aiOfflineReason'");
  });

  it('gerçek üretim yolu çalışır ve MaviRawSnapshot sözleşmesini döndürür', () => {
    const s = readMaviConsoleSnapshot();
    expect(typeof s.readAt).toBe('number');
    expect(s.readAt).toBeGreaterThan(0);
    // Her alan ya null (okunamadı) ya da beklenen şekilde
    if (s.voice) expect(typeof s.voice.status).toBe('string');
    if (s.aiHealth) expect(typeof s.aiHealth.blockedForMs).toBe('number');
    if (s.quota) expect(typeof s.quota.geminiCooldownMs).toBe('number');
    expect(s.diag === null || Array.isArray(s.diag)).toBe(true);
  });

  it('kaynak katmanı SENKRON ve müdahalesizdir (await / start / stop / retry YOK)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/maviConsoleSources.ts', 'utf8'));
    for (const f of [
      'await ', 'async ', 'startListening', 'stopListening', 'speak(', 'retry',
      'fetch(', 'setInterval', 'setTimeout', 'addListener', 'subscribe',
      'dispatchCommand', 'recordAiNet', 'reset',
    ]) expect(src).not.toContain(f);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 2 — UI doğrudan voice/AI servisi import ETMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — ekran tek kaynak katmanını kullanır', () => {
  it('ekran voice/AI/companion servislerini DOĞRUDAN import etmez', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/MaviConsoleScreen.tsx', 'utf8'));
    for (const f of [
      'voiceService', 'voiceDiagService', 'aiHealth', 'companionChatProvider',
      'getVoiceSnapshot', 'getRecentVoiceDiag', 'getAiHealthSnapshot', 'getProviderQuotaSnapshot',
    ]) expect(src).not.toContain(f);
    expect(src).toContain('maviConsoleSources');
  });

  /* Yorumlar SIYRILIR: kural KODU bağlar, açıklama metnini değil — model
     yorumlarında `Date.now` kelimesinin geçmesi (kaynağın damgayı nereden aldığını
     anlatmak için) bir ihlal değildir. */
  it('model servis import ETMEZ ve SAF kalır (Date.now / React / I/O yok)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/maviConsoleModel.ts', 'utf8'));
    for (const f of [
      'Date.now', 'performance.now', 'from \'react\'', 'setInterval', 'setTimeout',
      'localStorage', 'fetch(', '../voiceService', '../aiHealth',
    ]) expect(src).not.toContain(f);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 3 — getter hataları ekranı ÇÖKERTMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — fail-soft: kaynak patlarsa ekran ayakta kalır', () => {
  it('her kaynak AYRI try/catch içinde okunur', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/platform/devtools/maviConsoleSources.ts', 'utf8');
    expect(src).toContain('_safe(() => getVoiceSnapshot())');
    expect(src).toContain('_safe(() => getRecentVoiceDiag())');
    expect(src).toContain('_safe(() => getAiHealthSnapshot())');
    expect(src).toContain('_safe(() => getProviderQuotaSnapshot())');
    expect(src).toContain('_safe(() => getProactiveAlertDiagnostics())');
    expect(src).toContain('_safe(() => getProactiveSuppressionHistory())');
    expect(src).toMatch(/function _safe[\s\S]*?try \{[\s\S]*?catch \{/);
  });

  it('TÜM kaynaklar null iken model çökmez ve BİLİNMİYOR der', () => {
    const empty: MaviRawSnapshot = {
      readAt: NOW, voice: null, diag: null, aiHealth: null, quota: null, proactive: null,
    };
    const sections = buildMaviSections(empty);
    /* Bölüm sayısı fazlarla BÜYÜR ve bu sayı bilinçli olarak kilitlidir:
       A-F (M6 konuşma + M5 tur kapıları) · G (MAVI-F8 sürüş iş yükü) ·
       H (MAVI-F9 proaktif politika) · I (MAVI-F11 görünen durum) ·
       J (MAVI-F12 barge-in / duplex) · K (MAVI-F13 kanonik runtime).
       Yeni bölüm eklendiğinde bu sayı GÜNCELLENİR — kaldırılmaz (yoksa bölüm
       enflasyonu sessizce büyür). */
    expect(sections).toHaveLength(11);
    for (const s of sections) {
      expect(s.fields.length).toBeGreaterThan(0);
      for (const f of s.fields) expect(f.klass).toBe('UNAVAILABLE');
    }
    expect(buildMaviDiagRows(empty)).toBeNull();
    const v = deriveMaviVerdict(empty);
    expect(v.status).toBe('UNKNOWN');
    expect(v.reasons.join(' ')).toContain('okunamadı');
  });

  it('kaynak yokken SAHTE 0 / SAHTE sağlıklı / SAHTE tarih üretilmez', () => {
    const empty: MaviRawSnapshot = { readAt: NOW, voice: null, diag: null, aiHealth: null, quota: null };
    const sections = buildMaviSections(empty);
    for (const s of sections) for (const f of s.fields) {
      expect(f.value).toBe('—');
      expect(f.value).not.toBe('0');
      expect(f.value).not.toBe('true');
      expect(f.updatedAt).toBeNull();
    }
    expect(findField(sections, 'mvAi')!.note).toContain('VARSAYILMAZ');
    expect(findField(sections, 'mvQuota')!.note).toContain('VARSAYILMAZ');
  });

  it('halka BOŞ ile OKUNAMADI ayrı tutulur', () => {
    const emptyRing = buildMaviSections(snapshot({ diag: [] }));
    const cnt = findField(emptyRing, 'mvDiagCount')!;
    expect(cnt.klass).toBe('OBSERVED');
    expect(cnt.value).toBe('0');
    expect(buildMaviDiagRows(snapshot({ diag: [] }))).toEqual([]);

    const unread = buildMaviSections(snapshot({ diag: null }));
    expect(findField(unread, 'mvDiagCount')!.klass).toBe('UNAVAILABLE');
    expect(buildMaviDiagRows(snapshot({ diag: null }))).toBeNull();
  });

  it('ekran gerçek servislerle render olur (üretim yolu patlamıyor)', () => {
    const html = renderToStaticMarkup(<MaviConsoleScreen />);
    expect(html).toContain('mavi-console');
    expect(html).toMatch(/data-verdict="(UNKNOWN|AI_BLOCKED|ERROR|MIC_UNAVAILABLE|RUNNING|READY)"/);
  });

  /* DAVRANIŞSAL kilit: "try/catch var" demek yetmez — getter'lar GERÇEKTEN
     fırlatırken ekranın ayakta kaldığı ölçülür. */
  it('TÜM kaynaklar FIRLATIRKEN snapshot üretilir ve ekran çökmez', async () => {
    vi.resetModules();
    const boom = (): never => { throw new Error('kaynak patladı'); };
    vi.doMock('../platform/voiceService', () => ({ getVoiceSnapshot: boom }));
    vi.doMock('../platform/voiceDiagService', () => ({ getRecentVoiceDiag: boom }));
    vi.doMock('../platform/aiHealth', () => ({ getAiHealthSnapshot: boom }));
    vi.doMock('../platform/companion/companionChatProvider', () => ({ getProviderQuotaSnapshot: boom }));
    /* MAVI-M6-LAB-SPEECH-COUNTERS: F bölümünün iki kaynağı da aynı sözleşmeye tabi —
       biri patlarsa diğerleri okunur, alan KAYNAK YOK olur. */
    vi.doMock('../platform/assistant/maviSpeech', () => ({ getMaviSpeechDiagnostics: boom }));
    vi.doMock('../platform/assistant/maviTurn', () => ({ getMaviTurnDiagnostics: boom }));
    /* MAVI-F8 (G) ve MAVI-F9 (H) bölümlerinin kaynakları da AYNI sözleşmeye
       tabidir: fırlatırsa alan KAYNAK YOK olur, ekran ayakta kalır. */
    vi.doMock('../platform/assistant/maviWorkload', () => ({ getMaviWorkloadDiagnostics: boom }));
    vi.doMock('../platform/assistant/proactivePolicyEngine', () => ({
      getProactivePolicyDiagnostics: boom,
    }));
    /* MAVI-F11 (I) bölümünün kaynağı da AYNI sözleşmeye tabidir. */
    vi.doMock('../platform/assistant/maviSurfaceState', () => ({
      getMaviSurfaceDiagnostics: boom,
    }));
    /* MAVI-F12 (J) bölümünün kaynağı da AYNI sözleşmeye tabidir. */
    vi.doMock('../platform/assistant/maviBargeIn', () => ({
      getMaviBargeInDiagnostics: boom,
    }));
    /* MAVI-F13 (K) bölümünün kaynağı da AYNI sözleşmeye tabidir: kanıt defteri
       patlarsa "gölge çalışmadı" DENMEZ, alan UNAVAILABLE olur. Bayrak okuması
       da aynı sözleşmededir — patlarsa "hepsi kapalı" UYDURULMAZ. */
    vi.doMock('../platform/maviCore/wiring/maviEvidence', () => ({
      getMaviRuntimeConsolidationDiagnostics: boom,
    }));

    const sources = await import('../platform/devtools/maviConsoleSources');
    const model   = await import('../platform/devtools/maviConsoleModel');

    const s = sources.readMaviConsoleSnapshot();          // FIRLATMAMALI
    expect(s.voice).toBeNull();
    expect(s.diag).toBeNull();
    expect(s.aiHealth).toBeNull();
    expect(s.quota).toBeNull();
    expect(s.speech).toBeNull();
    expect(s.turn).toBeNull();
    expect(s.workload).toBeNull();
    expect(s.proactivePolicy).toBeNull();
    expect(s.surface).toBeNull();
    expect(s.bargeIn).toBeNull();       // MAVI-F12: kaynak patlarsa "kanıt yok"
    expect(s.runtime).toBeNull();       // MAVI-F13: defter patlarsa "kanıt yok"
    expect(s.readAt).toBeGreaterThan(0);

    const v = model.deriveMaviVerdict(s);
    expect(v.status).toBe('UNKNOWN');
    for (const sec of model.buildMaviSections(s)) {
      for (const f of sec.fields) expect(f.klass).toBe('UNAVAILABLE');
    }

    const screen = await import('../components/devtools/screens/MaviConsoleScreen');
    const html = renderToStaticMarkup(<screen.MaviConsoleScreen />);
    expect(html).toContain('data-verdict="UNKNOWN"');

    vi.doUnmock('../platform/assistant/maviBargeIn');
    vi.doUnmock('../platform/voiceService');
    vi.doUnmock('../platform/voiceDiagService');
    vi.doUnmock('../platform/aiHealth');
    vi.doUnmock('../platform/companion/companionChatProvider');
    vi.resetModules();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 4 — GİZLİLİK: transcript / lastCommand / history SIZMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — kullanıcı içeriği model ve render çıktısına SIZMAZ', () => {
  it('ham snapshot tipi metin taşıyan alan İÇERMEZ (yapısal kilit)', () => {
    const s = snapshot();
    const keys = Object.keys(s.voice!);
    for (const banned of ['transcript', 'lastCommand', 'history', 'suggestions', 'error']) {
      expect(keys).not.toContain(banned);
    }
    expect(keys).toContain('hasTranscript');
    expect(keys).toContain('hasLastCommand');
    expect(keys).toContain('historyCount');
    expect(keys).toContain('suggestionCount');
    expect(keys).toContain('hasError');
  });

  it('kaynak katmanı canlı VoiceState nesnesini DIŞARI VERMEZ (yalnız bayrak/adet)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/maviConsoleSources.ts', 'utf8'));
    // Metin alanları YALNIZ bayrağa indirgenerek kullanılır — asla taşınmaz
    expect(src).toContain('hasTranscript:');
    expect(src).toContain('hasLastCommand:');
    expect(src).not.toMatch(/transcript:\s*voice\.transcript/);
    expect(src).not.toMatch(/lastCommand:\s*voice\.lastCommand/);
    expect(src).not.toMatch(/history:\s*voice\.history/);
    expect(src).not.toMatch(/suggestions:\s*voice\.suggestions/);
    expect(src).not.toMatch(/error:\s*voice\.error/);
  });

  it('model çıktısında gizli metinlerin HİÇBİRİ bulunmaz', () => {
    const s = snapshot();
    const dump = JSON.stringify({
      sections: buildMaviSections(s),
      rows: buildMaviDiagRows(s),
      verdict: deriveMaviVerdict(s),
    });
    for (const secret of [SECRET_TRANSCRIPT, SECRET_COMMAND, SECRET_HISTORY]) {
      expect(dump).not.toContain(secret);
    }
  });

  it('render çıktısında yalnız VAR/YOK ve ADET görünür', () => {
    const html = renderToStaticMarkup(<MaviConsoleScreen />);
    for (const secret of [SECRET_TRANSCRIPT, SECRET_COMMAND, SECRET_HISTORY]) {
      expect(html).not.toContain(secret);
    }
    const sections = buildMaviSections(snapshot());
    expect(findField(sections, 'mvLastCommand')!.value).toBe('VAR');
    expect(findField(sections, 'mvTranscript')!.value).toBe('VAR');
    expect(findField(sections, 'mvHistory')!.value).toBe('3');       // ADET, içerik değil
    expect(findField(sections, 'mvSuggestions')!.value).toBe('2');
  });

  it('hata MESAJI değil yalnız varlığı taşınır', () => {
    const withErr = buildMaviSections(snapshot({
      voice: { ...snapshot().voice!, hasError: true },
    }));
    const f = findField(withErr, 'mvError')!;
    expect(f.value).toBe('VAR');
    expect(f.note).toContain('GİZLİLİK');
  });

  it('ekranda KOPYALA / PANO / dışa aktar butonu YOKTUR', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/devtools/screens/MaviConsoleScreen.tsx', 'utf8');
    for (const f of ['Clipboard', 'clipboard', 'navigator.clipboard', 'KOPYALA', 'PANOYA', 'İNDİR']) {
      expect(src).not.toContain(f);
    }
    const html = renderToStaticMarkup(<MaviConsoleScreen />);
    expect(html).not.toContain('KOPYALA');
    expect(html).not.toMatch(/<form/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 5 — tanı sırası EN YENİDEN ESKİYE
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — tanı satırları en yeniden eskiye sıralanır', () => {
  it('kaynak katmanı repo halkasını (en eski→en yeni) TERS çevirir', () => {
    const rows = buildMaviDiagRows(snapshot())!;
    expect(rows[0].stage).toBe('voice_success');       // en yeni
    expect(rows[rows.length - 1].stage).toBe('voice_start');
    expect(rows[0].index).toBe(0);
    // Damgalar azalan sırada (null'lar hariç)
    const stamped = rows.filter((r) => r.at !== null).map((r) => r.at!);
    for (let i = 1; i < stamped.length; i++) expect(stamped[i]).toBeLessThanOrEqual(stamped[i - 1]);
  });

  it('kaynak katmanının ters çevirme döngüsü koddadır', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/maviConsoleSources.ts', 'utf8'));
    expect(src).toContain('for (let i = diag.length - 1; i >= 0; i--)');
  });

  it('damgasız kayıt için "şimdi" UYDURULMAZ', () => {
    const rows = buildMaviDiagRows(snapshot())!;
    const noStamp = rows.find((r) => r.stage === 'voice_start')!;
    expect(noStamp.at).toBeNull();
    expect(noStamp.atLabel).toBe('—');
  });

  it('satır listesi BOUNDED ve EN YENİLERİ tutar', () => {
    const many: MaviDiagRaw[] = Array.from({ length: MAX_MAVI_DIAG_ROWS + 25 }, (_, i) => ({
      at: NOW - i * 100, stage: `s${i}`, transcriptLength: null,
      errorCode: null, route: null, intent: null,
    }));
    const rows = buildMaviDiagRows(snapshot({ diag: many }))!;
    expect(rows).toHaveLength(MAX_MAVI_DIAG_ROWS);
    expect(rows[0].stage).toBe('s0');                  // en yeni korunur
  });

  it('aşama adları repo VOICE_DIAG_STAGES sözleşmesinden gelir', () => {
    expect(VOICE_DIAG_STAGES).toContain('voice_success');
    expect(VOICE_DIAG_STAGES).toContain('voice_error');
    const rows = buildMaviDiagRows(snapshot())!;
    for (const r of rows) expect(typeof r.stage).toBe('string');
  });

  it('transcriptLength SAYIDIR (metin değil) ve yoksa null kalır', () => {
    const rows = buildMaviDiagRows(snapshot())!;
    expect(rows[0].transcriptLength).toBe(31);
    expect(rows[rows.length - 1].transcriptLength).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 6 — sağlayıcı cooldown'ları AYRI kalır
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — provider soğumaları TOPLANMAZ', () => {
  it('üç sağlayıcı AYRI alanlarda ve doğru değerlerle görünür', () => {
    const sections = buildMaviSections(snapshot({
      quota: { geminiCooldownMs: 42_000, groqCooldownMs: 0, haikuCooldownMs: 7_000 },
    }));
    expect(findField(sections, 'mvQuotaGemini')!.value).toBe('42000');
    expect(findField(sections, 'mvQuotaGroq')!.value).toBe('0');
    expect(findField(sections, 'mvQuotaHaiku')!.value).toBe('7000');
    // Toplam (49000) HİÇBİR alanda görünmemeli
    for (const f of section(sections, 'quota').fields) expect(f.value).not.toBe('49000');
  });

  it('"herhangi biri soğumada mı" bir TOPLAM değil, TÜRETİLMİŞ bayraktır', () => {
    const sections = buildMaviSections(snapshot({
      quota: { geminiCooldownMs: 0, groqCooldownMs: 500, haikuCooldownMs: 0 },
    }));
    const f = findField(sections, 'mvQuotaAnyCooling')!;
    expect(f.klass).toBe('DERIVED');
    expect(f.value).toBe('EVET');
    expect(f.note).toContain('TOPLAM DEĞİLDİR');
  });

  it('AI sağlığı ile sağlayıcı kotası AYRI bölümlerdir', () => {
    const sections = buildMaviSections(snapshot());
    expect(section(sections, 'ai-health')).toBeTruthy();
    expect(section(sections, 'quota')).toBeTruthy();
    expect(findField(sections, 'mvAiBlockedFor')).toBeTruthy();
    expect(findField(sections, 'mvQuotaGemini')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 7 — HÜKÜM KURALLARI (sıralı, fail-closed)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — hüküm kuralları ilk eşleşen kazanır', () => {
  it('1) tüm ana kaynaklar okunamadı → BİLİNMİYOR', () => {
    expect(deriveMaviVerdict({
      readAt: NOW, voice: null, diag: null, aiHealth: null, quota: null,
    }).status).toBe('UNKNOWN');
  });

  it('2) blockedForMs > 0 → AI GEÇİCİ BLOKE (mic ve hata durumunu EZER)', () => {
    const r = deriveMaviVerdict(snapshot({
      aiHealth: { healthy: false, consecFails: 2, consecTimeouts: 0, blockedForMs: 45_000 },
      voice: { ...snapshot().voice!, micAvailable: false, hasError: true },
    }));
    expect(r.status).toBe('AI_BLOCKED');
    expect(MAVI_VERDICT_LABEL[r.status]).toBe('AI GEÇİCİ BLOKE');
    expect(r.reasons.join(' ')).toContain('45000');
  });

  it('blockedForMs = 0 iken AI_BLOCKED verilmez', () => {
    expect(deriveMaviVerdict(snapshot()).status).not.toBe('AI_BLOCKED');
  });

  it('3) ses hatası veya EN YENİ diag errorCode → HATA', () => {
    const byVoice = deriveMaviVerdict(snapshot({
      voice: { ...snapshot().voice!, hasError: true },
    }));
    expect(byVoice.status).toBe('ERROR');

    const byStatus = deriveMaviVerdict(snapshot({
      voice: { ...snapshot().voice!, status: 'error' },
    }));
    expect(byStatus.status).toBe('ERROR');

    const byDiag = deriveMaviVerdict(snapshot({
      diag: [
        { at: NOW, stage: 'voice_error', transcriptLength: null, errorCode: 'STT_TIMEOUT', route: null, intent: null },
        ...snapshot().diag!,
      ],
    }));
    expect(byDiag.status).toBe('ERROR');
    expect(byDiag.reasons.join(' ')).toContain('STT_TIMEOUT');
  });

  it('ESKİ bir kayıttaki errorCode tek başına HATA üretmez (yalnız EN YENİ)', () => {
    const r = deriveMaviVerdict(snapshot({
      diag: [
        { at: NOW, stage: 'voice_success', transcriptLength: 10, errorCode: null, route: null, intent: null },
        { at: NOW - 9_000, stage: 'voice_error', transcriptLength: null, errorCode: 'OLD_FAIL', route: null, intent: null },
      ],
    }));
    expect(r.status).not.toBe('ERROR');
  });

  it('4) micAvailable = false → MİKROFON KULLANILAMIYOR', () => {
    const r = deriveMaviVerdict(snapshot({
      voice: { ...snapshot().voice!, micAvailable: false },
    }));
    expect(r.status).toBe('MIC_UNAVAILABLE');
    expect(MAVI_VERDICT_LABEL[r.status]).toBe('MİKROFON KULLANILAMIYOR');
  });

  it('5) aktif durumlar → ÇALIŞIYOR', () => {
    for (const status of MAVI_ACTIVE_VOICE_STATUS) {
      const r = deriveMaviVerdict(snapshot({ voice: { ...snapshot().voice!, status } }));
      expect(r.status).toBe('RUNNING');
    }
    expect([...MAVI_ACTIVE_VOICE_STATUS]).toEqual(['listening', 'processing']);
  });

  it('6) mikrofon VAR + bekleme durumu → HAZIR', () => {
    for (const status of MAVI_WAITING_VOICE_STATUS) {
      const r = deriveMaviVerdict(snapshot({ voice: { ...snapshot().voice!, status } }));
      expect(r.status).toBe('READY');
    }
    expect([...MAVI_WAITING_VOICE_STATUS]).toEqual(['idle', 'success']);
  });

  it('7) BİLİNMEYEN durum tahmin edilmez → BİLİNMİYOR (fail-soft)', () => {
    const r = deriveMaviVerdict(snapshot({
      voice: { ...snapshot().voice!, status: 'quantum_dinleme' },
    }));
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.join(' ')).toContain('TANIMSIZ');
  });

  it('repoda TANIMLI ama haritalanmamış "throttled" da HAZIR ilan EDİLMEZ', () => {
    expect(MAVI_KNOWN_VOICE_STATUS).toContain('throttled');
    const r = deriveMaviVerdict(snapshot({
      voice: { ...snapshot().voice!, status: 'throttled' },
    }));
    expect(r.status).toBe('UNKNOWN');
    expect(r.status).not.toBe('READY');
  });

  it('ses kaynağı okunamazsa HAZIR VARSAYILMAZ', () => {
    const r = deriveMaviVerdict(snapshot({ voice: null }));
    expect(r.status).not.toBe('READY');
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.join(' ')).toContain('VARSAYILMAZ');
  });

  it('durum bilinmese bile hüküm etiketi her zaman tanımlıdır', () => {
    for (const k of Object.keys(MAVI_VERDICT_LABEL)) {
      expect(MAVI_VERDICT_LABEL[k as keyof typeof MAVI_VERDICT_LABEL].length).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 8 — timer/listener/abonelik YOK; tek okuma + elle yenile
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — zamanlayıcı yok, tek okuma + elle YENİLE', () => {
  it('ekran kaynağında timer/abonelik/imperative DOM YOK', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/MaviConsoleScreen.tsx', 'utf8'));
    for (const f of [
      'setInterval', 'setTimeout', 'requestAnimationFrame', 'subscribe', 'addListener',
      'addEventListener', 'document.', 'querySelector', 'scrollIntoView',
    ]) expect(src).not.toContain(f);
  });

  it('açılışta TEK okuma; yenileme YALNIZ butondan', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/MaviConsoleScreen.tsx', 'utf8'));
    expect(src).toContain('useState<MaviRawSnapshot>(() => readMaviConsoleSnapshot())');
    expect(src).toContain('onClick={refresh}');
    // Zero-leak: unmount sonrası setState yok
    expect(src).toContain('mountedRef.current = false');
    expect(src).toMatch(/if \(mountedRef\.current\) setSnap/);
    // KİLİT GÜNCELLENDİ (2→3): senaryo koşucusu paneli eklendi; koşu SONRASI
    // snapshot tazelenir ki kararlar "E" bölümünde görünsün. Üçü de KULLANICI
    // TETİKLİ: ilk state · YENİLE butonu · SENARYOLARI ÇALIŞTIR butonu.
    expect((src.match(/readMaviConsoleSnapshot\(\)/g) ?? []).length).toBe(3);
    expect(src).toContain('onClick={runScenarios}');
    // ASIL GÜVENCE AYNEN DURUYOR: ekranda periyodik yenileme YOK.
    for (const timer of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
      expect(src, `ekran '${timer}' kurmamalı`).not.toContain(timer);
    }
  });

  it('saf model hiçbir zamanlayıcı kurmaz', () => {
    const iv = vi.spyOn(globalThis, 'setInterval');
    const to = vi.spyOn(globalThis, 'setTimeout');
    const s = snapshot();
    buildMaviSections(s); buildMaviDiagRows(s); deriveMaviVerdict(s);
    expect(iv).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });

  it('ekranda müdahale butonu YOK (yalnız YENİLE)', () => {
    const html = renderToStaticMarkup(<MaviConsoleScreen />);
    expect(html).toContain('mavi-refresh');
    for (const banned of [
      'DİNLE', 'BAŞLAT', 'DURDUR', 'KONUŞ', 'GÖNDER', 'SIFIRLA', 'YENİDEN DENE', 'TEST ET',
    ]) expect(html).not.toContain(banned);
  });

  it('shell katalog görünümünde ekran mount OLMAZ (lazy korunur)', () => {
    const html = renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(html).not.toContain('mavi-console"');
    expect(html).not.toContain('MAVİ DURUMU');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 9 — katalog + ekran eşlemesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — katalog AVAILABLE ve eşleme doğru', () => {
  it('mavi-console AVAILABLE, id DEĞİŞMEDİ, ai kategorisinde', () => {
    const t = getCarosLabTool('mavi-console')!;
    expect(t.id).toBe('mavi-console');
    expect(t.status).toBe('AVAILABLE');
    expect(t.category).toBe('ai');
    expect(t.note ?? '').toContain('GİZLİLİK');
    // "Ekran yok" mazereti kalkmalı
    expect(t.note ?? '').not.toContain('Ekran yok');
  });

  it('ekran eşlemesi lazy chunk döndürür', () => {
    const el = renderAvailableTool('mavi-console');
    expect(el).not.toBeNull();
    const type = (el as unknown as { type?: { $$typeof?: symbol } }).type;
    expect(type?.$$typeof).toBe(Symbol.for('react.lazy'));
  });

  it('katalog metni doğrulanmamış iddia içermez', () => {
    const t = getCarosLabTool('mavi-console')!;
    const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
    for (const banned of ['yakında', 'coming soon', 'sorunsuz', 'doğrulandı', 'sahada']) {
      expect(text).not.toContain(banned);
    }
  });

  it('bölümler ve alanlar BOUNDED', () => {
    const sections = buildMaviSections(snapshot());
    expect(sections).toHaveLength(11);  // A-F + G (F8) + H (F9) + I (F11) + J (F12) + K (F13)
    for (const s of sections) {
      expect(s.fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_MAVI_SECTION);
      for (const f of s.fields) expect(f.value.length).toBeLessThan(200);
    }
    const counts = countByMaviClass(sections);
    expect(counts.OBSERVED).toBeGreaterThan(0);
    expect(counts.DERIVED).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 10 — A4 / A5 / A6 / UX-F1 kilitleri zayıflatılmadı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — önceki fazlar bozulmadı', () => {
  it('A4/A5/A6 araçları hâlâ AVAILABLE ve kendi ekranlarına eşlenir', () => {
    for (const id of ['kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics'] as const) {
      expect(getCarosLabTool(id)!.status).toBe('AVAILABLE');
      expect(renderAvailableTool(id)).not.toBeNull();
    }
  });

  it('UX-F1 giriş odağı korunur (ortak ekran + farklı focus prop)', () => {
    const q = renderAvailableTool('queue-monitor') as unknown as { type: unknown; props: { focus?: string } };
    const p = renderAvailableTool('poll-scheduler') as unknown as { type: unknown; props: { focus?: string } };
    expect(q.type).toBe(p.type);
    expect(q.props.focus).toBe('queue-monitor');
    expect(p.props.focus).toBe('poll-scheduler');
  });

  it('Mavi Konsolu bu ekranların HİÇBİRİYLE karışmaz', () => {
    const mavi = renderAvailableTool('mavi-console') as unknown as { type: unknown };
    for (const id of ['kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics', 'queue-monitor'] as const) {
      expect((renderAvailableTool(id) as unknown as { type: unknown }).type).not.toBe(mavi.type);
    }
  });

  it('A7 ortak gözlemlenebilirlik dilini kullanır — paralel sistem kurmaz', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/platform/devtools/maviConsoleModel.ts', 'utf8');
    expect(src).toContain("from './sessionInspectorModel'");
    // Kendi Observability birliğini YENİDEN TANIMLAMAZ
    expect(src).not.toContain("export type MaviObservability");
  });
});
