/**
 * carosLabSpeechCounters.test.tsx — CAROS LAB · F bölümü KİLİTLERİ
 * (MAVI-M6-LAB-SPEECH-COUNTERS).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `getMaviSpeechDiagnostics()` ve `getMaviTurnDiagnostics()` ÜRETİLİYOR ama
 * hiçbir LAB ekranı OKUMUYORDU → "gözlemlenemeyen özellik tamamlanmış değildir"
 * kuralına göre açık borçtu. Özellikle MAVI-M6-LATE-SPEECH-GATE'in eklediği
 * `staleLateSpeechSuppressed`, geç konuşma kapısının sahada çalıştığını
 * gösteren TEK kanıttır — görünmezse cihaz doğrulaması yapılamaz.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. F bölümü M6 konuşma defterini ve M5 tur kapılarını GÖSTERİR.
 *  2. `staleLateSpeechSuppressed` ekranda GÖRÜNÜR ve GERÇEK değeri yansıtır.
 *  3. Kaynak yoksa SAHTE 0 basılmaz → KAYNAK YOK.
 *  4. Sayaç doyduysa DÜRÜSTÇE bildirilir (sayılar artık adet değildir).
 *  5. Seslendirilen metin · transcript · kullanıcı içeriği bu bölüme SIZMAZ.
 *  6. Ekran salt-okunur kalır (müdahale butonu YOK).
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(), speakAssistant: vi.fn(), speakAlert: vi.fn(),
  speakSafetyAlert: vi.fn(), ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));

import {
  buildMaviSections, MAVI_SECTION_TITLE, MAX_FIELDS_PER_MAVI_SECTION,
  type MaviRawSnapshot, type MaviSection,
} from '../platform/devtools/maviConsoleModel';
import { readMaviConsoleSnapshot } from '../platform/devtools/maviConsoleSources';
import { MaviConsoleScreen } from '../components/devtools/screens/MaviConsoleScreen';
import {
  speakMaviAnswer, _resetMaviSpeechForTest,
} from '../platform/assistant/maviSpeech';
import {
  beginMaviTurn, continueIfTurnCurrent, supersedeActiveMaviTurn,
  _resetMaviTurnsForTest,
} from '../platform/assistant/maviTurn';

const NOW = 1_700_000_000_000;

/** Bu metin HİÇBİR alanda/markup'ta görünmemelidir. */
const SECRET_UTTERANCE = 'Ayşe Yıldırım için klimayı yirmi iki dereceye ayarla';

function snapshot(over: Partial<MaviRawSnapshot> = {}): MaviRawSnapshot {
  return {
    readAt: NOW,
    voice: null, diag: null, aiHealth: null, quota: null, proactive: null,
    speech: {
      turnId: 7, answeredThisTurn: true, progressedThisTurn: false,
      spoken: 12, suppressedDuplicate: 3, staleLateSpeechSuppressed: 5,
    },
    turn: {
      activeTurnId: 7, activeState: 'completed',
      turnsStarted: 9, turnsCompleted: 8, turnsSuperseded: 2,
      staleProviderResultsDropped: 1, staleActionsPrevented: 4, staleFeedbackSuppressed: 6,
      countersSaturated: false,
    },
    ...over,
  } as MaviRawSnapshot;
}

const speechSection = (s: MaviRawSnapshot): MaviSection =>
  buildMaviSections(s).find((x) => x.id === 'speech')!;

const fieldOf = (s: MaviRawSnapshot, id: string) =>
  speechSection(s).fields.find((f) => f.id === id);

beforeEach(() => {
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1/2 — Bölüm var ve sayaçlar görünüyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LAB-SC · 1/2. F bölümü ve sayaçlar', () => {
  it('F bölümü buildMaviSections çıktısında VARDIR', () => {
    const sec = speechSection(snapshot());
    expect(sec).toBeDefined();
    expect(sec.title).toBe(MAVI_SECTION_TITLE.speech);
    expect(sec.fields.length).toBeGreaterThan(5);
  });

  it('M6 konuşma defterinin TÜM alanları gösterilir', () => {
    const s = snapshot();
    expect(fieldOf(s, 'msLedgerTurn')?.value).toBe('7');
    expect(fieldOf(s, 'msAnswered')?.value).toBe('VAR');
    expect(fieldOf(s, 'msProgressed')?.value).toBe('YOK');
    expect(fieldOf(s, 'msSpoken')?.value).toBe('12');
    expect(fieldOf(s, 'msDuplicate')?.value).toBe('3');
  });

  it('2. `staleLateSpeechSuppressed` GÖRÜNÜR (geç konuşma kapısının tek kanıtı)', () => {
    const f = fieldOf(snapshot(), 'msStaleLate');
    expect(f, 'geç konuşma sayacı ekrandan kaldırılmış').toBeDefined();
    expect(f?.value).toBe('5');
    expect(f?.klass).toBe('OBSERVED');
  });

  it('M5 tur kapısı sayaçları gösterilir', () => {
    const s = snapshot();
    expect(fieldOf(s, 'msActiveTurn')?.value).toBe('7');
    expect(fieldOf(s, 'msTurnState')?.value).toBe('completed');
    expect(fieldOf(s, 'msTurnsSuperseded')?.value).toBe('2');
    expect(fieldOf(s, 'msStaleProvider')?.value).toBe('1');
    expect(fieldOf(s, 'msStaleAction')?.value).toBe('4');
    expect(fieldOf(s, 'msStaleFeedback')?.value).toBe('6');
  });

  it('defter/aktif tur AYRIŞMASI türetilir (iki GÖZLENEN alandan — tahmin YOK)', () => {
    expect(fieldOf(snapshot(), 'msTurnSync')?.value).toBe('EVET');
    const drifted = snapshot({
      speech: { ...snapshot().speech!, turnId: 6 },
    });
    const f = fieldOf(drifted, 'msTurnSync');
    expect(f?.value).toBe('HAYIR');
    expect(f?.klass).toBe('DERIVED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3/4 — Dürüstlük: sahte 0 yok, doyma bildirilir
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LAB-SC · 3/4. dürüstlük', () => {
  it('3. konuşma kaynağı YOKKEN sahte 0 basılmaz → KAYNAK YOK', () => {
    const s = snapshot({ speech: null });
    const f = speechSection(s).fields.find((x) => x.id === 'msSpeech');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.value).toBe('—');
    // Sayaç alanları HİÇ üretilmez (0 gibi görünen bir şey kalmaz).
    expect(speechSection(s).fields.find((x) => x.id === 'msStaleLate')).toBeUndefined();
  });

  it('3b. tur kaynağı YOKKEN de sahte 0 basılmaz', () => {
    const s = snapshot({ turn: null });
    const f = speechSection(s).fields.find((x) => x.id === 'msTurn');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(speechSection(s).fields.find((x) => x.id === 'msTurnsStarted')).toBeUndefined();
  });

  it('3c. HER İKİ kaynak da yoksa bölüm çökmez ve hepsi KAYNAK YOK olur', () => {
    const sec = speechSection(snapshot({ speech: null, turn: null }));
    expect(sec.fields.length).toBeGreaterThan(0);
    for (const f of sec.fields) expect(f.klass).toBe('UNAVAILABLE');
  });

  it('4. sayaç DOYDUYSA dürüstçe bildirilir (sayılar artık adet değildir)', () => {
    const saturated = snapshot({
      turn: { ...snapshot().turn!, countersSaturated: true },
    });
    const f = fieldOf(saturated, 'msSaturated');
    expect(f?.value).toBe('EVET');
    expect(f?.klass).toBe('DERIVED');
    expect(f?.note ?? '').toMatch(/GERÇEK ADET DEĞİL/i);
  });

  it('4b. doymamışken açıkça HAYIR der (belirsiz bırakılmaz)', () => {
    expect(fieldOf(snapshot(), 'msSaturated')?.value).toBe('HAYIR');
  });

  it('alanlar BOUNDED kalır (Mali-400 render bütçesi)', () => {
    expect(speechSection(snapshot()).fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_MAVI_SECTION);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 — Gizlilik: kullanıcı içeriği sızmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LAB-SC · 5. gizlilik', () => {
  it('seslendirilen METİN ne snapshot\'a ne bölüme ne markup\'a girer', () => {
    beginMaviTurn();
    speakMaviAnswer(SECRET_UTTERANCE);          // gerçekten konuşulur (mock TTS)

    const snap = readMaviConsoleSnapshot();
    expect(JSON.stringify(snap)).not.toContain('Ayşe');
    expect(JSON.stringify(buildMaviSections(snap))).not.toContain('Ayşe');
    expect(renderToStaticMarkup(<MaviConsoleScreen />)).not.toContain('Ayşe');
  });

  it('konuşma sözleşmesi YALNIZ bayrak/adet/kimlik taşır (tip yüzeyi)', () => {
    const snap = readMaviConsoleSnapshot();
    expect(snap.speech).not.toBeNull();
    expect(Object.keys(snap.speech!).sort()).toEqual([
      'answeredThisTurn', 'progressedThisTurn', 'spoken',
      'staleLateSpeechSuppressed', 'suppressedDuplicate', 'turnId',
    ]);
    for (const v of Object.values(snap.speech!)) {
      expect(['number', 'boolean']).toContain(typeof v);   // METİN alanı YOK
    }
  });

  it('tur sözleşmesinde tek metin alanı `activeState` enum\'udur', () => {
    const snap = readMaviConsoleSnapshot();
    expect(['active', 'completed', 'superseded']).toContain(snap.turn!.activeState);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 — Canlı kaynak GERÇEKTEN ölçüyor + ekran salt-okunur
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LAB-SC · 6. canlı ölçüm ve salt-okunurluk', () => {
  it('geç konuşma kapısı tetiklenince sayaç LAB snapshot\'ında ARTAR', () => {
    const before = readMaviConsoleSnapshot().speech!.staleLateSpeechSuppressed;

    const captured = beginMaviTurn();
    beginMaviTurn();                                   // tur eskidi
    speakMaviAnswer('geç cevap', { turn: captured });  // kapı düşürür

    const after = readMaviConsoleSnapshot().speech!.staleLateSpeechSuppressed;
    expect(after).toBe(before + 1);                    // ÖLÇÜLEBİLİR (ölü sayacın aksine)
  });

  it('çağrı-yeri tur kapısı tetiklenince M5 sayacı LAB snapshot\'ında ARTAR', () => {
    const before = readMaviConsoleSnapshot().turn!.staleFeedbackSuppressed;
    const captured = beginMaviTurn();
    beginMaviTurn();
    continueIfTurnCurrent(captured, 'feedback');
    expect(readMaviConsoleSnapshot().turn!.staleFeedbackSuppressed).toBe(before + 1);
  });

  it('devralma sayacı gerçek devralmada ARTAR', () => {
    const before = readMaviConsoleSnapshot().turn!.turnsSuperseded;
    beginMaviTurn();
    supersedeActiveMaviTurn();
    expect(readMaviConsoleSnapshot().turn!.turnsSuperseded).toBe(before + 1);
  });

  it('F bölümü gerçek markup\'ta BASILIR', () => {
    const html = renderToStaticMarkup(<MaviConsoleScreen />);
    expect(html).toContain(MAVI_SECTION_TITLE.speech);
    expect(html).toContain('geç konuşma reddi');
  });

  /* Ekranın MEVCUT sözleşmesi korunur (carosLabMaviConsole.test.tsx ile AYNI liste).
     `ÇALIŞTIR` bilinçli olarak listede DEĞİLDİR: ekranda zaten deterministik
     senaryo koşucusu butonu vardır ve o gerçek araç/ağ/TTS'e DOKUNMAZ (Faz A7).
     Bu kilit yalnız F bölümünün YENİ bir müdahale yüzeyi getirmediğini ölçer. */
  it('ekran SALT-OKUNUR kalır — F bölümü müdahale fiili getirmez', () => {
    const html = renderToStaticMarkup(<MaviConsoleScreen />);
    for (const verb of [
      'DİNLE', 'BAŞLAT', 'DURDUR', 'KONUŞ', 'GÖNDER', 'SIFIRLA', 'YENİDEN DENE', 'TEST ET',
    ]) {
      expect(html, `${verb} müdahale fiili ekrana girmiş`).not.toContain(verb);
    }
  });

  it('F bölümü alanları da salt-okunur METİNDİR — buton/input üretmez', () => {
    const html = renderToStaticMarkup(<MaviConsoleScreen />);
    const at = html.indexOf(MAVI_SECTION_TITLE.speech);
    expect(at).toBeGreaterThan(-1);
    const tail = html.slice(at);
    expect(tail).not.toMatch(/<button|<input|<select|<form/);
  });
});
