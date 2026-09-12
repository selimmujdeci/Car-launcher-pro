/**
 * wakeFollowUpLock.test.ts — **SAHA #1258 · YARIM KALAN TUR WAKE'İ KİLİTLEMEZ.**
 *
 * ── ÖLÇÜLEN ARIZA (2026-09-04, Xiaomi 23090RA98I) ───────────────────────────
 * Kullanıcı: *"bir kere çalışıyor, sonra bir daha uyanmıyor."*
 * LAB → Mavi Konsolu → bölüm L defteri (kütük #1257) şunu verdi:
 *   `ACCEPTED 2 · ACCEPTED_NO_INTENT 2 · SUPPRESSED_FOLLOWUP 3` ·
 *   `kabul → komut: dönen 0`
 * — ama `maviSpeech` defteri "toplam seslendirme 2" diyordu: Mavi GERÇEKTEN
 * cevap vermişti. Yani iki AYRI kusur vardı:
 *
 *  **(1) KİLİT (davranış):** takip döngüsünün UI aynası (`VoiceState.followUp`)
 *      sahibinden (`voiceConversationRuntime`) AYRIŞABİLİYORDU. Döngü öldüğü
 *      hâlde ayna açık kalıyor, wake kapısı `status==='idle'` iken bile her
 *      tetiği `SUPPRESSED_FOLLOWUP` ile düşürüyordu — KALICI olarak.
 *  **(2) SESSİZ KAYIP (ölçüm):** sohbet yolu hiçbir terminal lifecycle fazı
 *      emit etmiyordu → kabul edilen tetik 20 sn sonra sessizce
 *      `ACCEPTED_NO_INTENT` sayılıyordu ve teşhis iki gün yanlış yöne gitti.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md §Regresyon Kasası). Her kilit önce
 * çapasının varlığını doğrular — taradığı yapı değişirse boş küme ile "geçmez".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  configureVoiceConversation, beginConversationSession, endConversationSession,
  armFollowUp, disarmFollowUp, isFollowUpArmed, isFollowUpEngaged, onTtsEnd,
  _resetConversationRuntimeForTest, _pendingConversationTimersForTest,
} from '../platform/voice/voiceConversationRuntime';

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(SRC, ...seg), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* Kaynaktan okunan gerçek süreler — testte SABİT KOPYA tutulmaz. */
const CONV_SRC = read('platform', 'voice', 'voiceConversationRuntime.ts');
const FOLLOWUP_FALLBACK_MS = Number(
  /FOLLOWUP_FALLBACK_MS\s*=\s*([\d_]+)/.exec(CONV_SRC)?.[1].replace(/_/g, ''),
);
const RELISTEN_MS = Number(
  /FOLLOWUP_RELISTEN_DELAY_MS\s*=\s*([\d_]+)/.exec(CONV_SRC)?.[1].replace(/_/g, ''),
);

/* ══════════════════════════════════════════════════════════════════════════
 * A · DAVRANIŞ — döngü ölünce ayna da kapanır
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAHA #1258/A — takip döngüsü öldüğünde UI aynası AÇIK KALMAZ', () => {
  let mirror = false;
  let status = 'idle';
  let speaking = false;
  let paused = false;
  let startCalls = 0;

  const wire = (statusFn: () => string): void => {
    configureVoiceConversation({
      startListening: () => { startCalls++; },
      currentStatus: statusFn,
      setUiFollowUp: (on) => { mirror = on; },
      goIdleFromSuccess: () => { if (status === 'success') status = 'idle'; },
      isTtsSpeaking: () => speaking,
      isVoicePaused: () => paused,
      responseBudgetAllowsFollowUp: () => true,
      noteFollowUpSuppressed: () => {},
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    _resetConversationRuntimeForTest();
    mirror = false; status = 'idle'; speaking = false; paused = false; startCalls = 0;
    wire(() => status);
    beginConversationSession();
  });

  afterEach(() => {
    _resetConversationRuntimeForTest();
    vi.useRealTimers();
  });

  it('çapa: süreler kaynaktan gerçekten okundu', () => {
    expect(FOLLOWUP_FALLBACK_MS).toBeGreaterThan(0);
    expect(RELISTEN_MS).toBeGreaterThan(0);
  });

  it('kurulunca ayna AÇILIR, döngü kapanınca KAPANIR (temel simetri)', () => {
    status = 'success';
    armFollowUp();
    expect(isFollowUpEngaged()).toBe(true);
    expect(mirror).toBe(true);

    disarmFollowUp();
    expect(isFollowUpEngaged()).toBe(false);
    expect(mirror).toBe(false);
  });

  it('KÖK ARIZA: emniyet penceresi uçuştaki tura devrederse ayna KAPANIR', () => {
    status = 'success';
    armFollowUp();
    expect(mirror).toBe(true);

    /* Emniyet penceresi dolarken uçuşta bir tur var (`listening`) → döngü
       BURADA biter; eskiden `_followUpArmed=false` yazılıp `return` ediliyor,
       ayna AÇIK kalıyordu ve wake KALICI olarak kilitleniyordu. */
    status = 'listening';
    vi.advanceTimersByTime(FOLLOWUP_FALLBACK_MS + 1);

    expect(isFollowUpArmed()).toBe(false);
    expect(isFollowUpEngaged()).toBe(false);
    expect(mirror, 'döngü öldü ama UI aynası açık kaldı → wake kalıcı kilit').toBe(false);
    expect(_pendingConversationTimersForTest(), 'ölü döngüden zamanlayıcı kaldı').toBe(0);
  });

  it('KÖK ARIZA: yeniden-dinleme tamponu uçuştaki tura devrederse ayna KAPANIR', () => {
    status = 'success';
    armFollowUp();
    onTtsEnd();                       // → tampon kuruldu
    status = 'processing';            // tampon dolarken tur uçuşta
    vi.advanceTimersByTime(RELISTEN_MS + 1);

    expect(startCalls, 'devri teslim: mikrofon AÇILMAMALIYDI').toBe(0);
    expect(isFollowUpEngaged()).toBe(false);
    expect(mirror).toBe(false);
    expect(_pendingConversationTimersForTest()).toBe(0);
  });

  it('YANLIŞ-POZİTİF KORUMASI: tampon UÇUŞTAYKEN döngü CANLI sayılır', () => {
    status = 'success';
    armFollowUp();
    onTtsEnd();                       // armed=false ama tampon uçuşta
    expect(isFollowUpArmed()).toBe(false);
    expect(isFollowUpEngaged(), 'tampon uçuşta — döngü kopmuş sayılamaz').toBe(true);
    expect(mirror).toBe(true);
  });

  it('NORMAL AKIŞ KORUNUYOR: TTS bitince mikrofon yeniden açılır, ayna tüketilir', () => {
    status = 'success';
    armFollowUp();
    onTtsEnd();
    vi.advanceTimersByTime(RELISTEN_MS + 1);

    expect(startCalls, 'sürekli sohbet döngüsü koptu').toBe(1);
    expect(isFollowUpEngaged()).toBe(false);
    expect(mirror).toBe(false);
  });

  it('oturum kapanınca ayna da kapanır (idempotent)', () => {
    status = 'success';
    armFollowUp();
    endConversationSession();
    expect(mirror).toBe(false);
    endConversationSession();
    expect(mirror).toBe(false);
    expect(_pendingConversationTimersForTest()).toBe(0);
  });

  it('YAPISAL: döngü ölüyken ayna HİÇBİR durumda açık kalamaz', () => {
    for (const st of ['idle', 'listening', 'processing', 'success', 'error']) {
      _resetConversationRuntimeForTest();
      mirror = false; startCalls = 0;
      wire(() => st);
      beginConversationSession();
      armFollowUp();
      onTtsEnd();
      vi.advanceTimersByTime(FOLLOWUP_FALLBACK_MS + RELISTEN_MS + 10);
      if (!isFollowUpEngaged()) {
        expect(mirror, `status=${st}: döngü ölü ama ayna açık`).toBe(false);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · YAPISAL KİLİTLER — karar projeksiyondan okunamaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAHA #1258/B — wake kapısı UI rozetini DEĞİL sahibini okur', () => {
  const WAKE = stripComments(read('platform', 'wakeWordService.ts'));
  const ROOT = stripComments(read('platform', 'voiceService.ts'));
  const CONV = stripComments(CONV_SRC);

  it('çapa: wake kapısı ve gerekçeleri hâlâ yerinde', () => {
    expect(WAKE).toContain(
      "reason: vs.status !== 'idle' ? 'SUPPRESSED_VOICE_ACTIVE' : 'SUPPRESSED_FOLLOWUP'",
    );
  });

  it('wake kapısı `vs.followUp` ROZETİNİ okumaz', () => {
    expect(WAKE, 'karar yine UI projeksiyonundan okunuyor (CLAUDE.md §14)')
      .not.toMatch(/vs\.followUp/);
    expect(WAKE, 'kapı sahibin gerçeğine bağlanmamış').toContain('isVoiceFollowUpEngaged()');
  });

  it('kök, döngü gerçeğini runtime içinden türetir — rozeti OR-lamaz', () => {
    expect(ROOT).toContain('export function isVoiceFollowUpEngaged()');
    expect(ROOT, 'algı portu yine rozeti OR-luyor — ayrışma geri geldi')
      .not.toMatch(/isFollowUpArmed\(\)\s*\|\|\s*_current\.followUp/);
  });

  it('UI aynası TEK yazıcıdan geçer (elle setUiFollowUp yazımı yok)', () => {
    expect(CONV).toContain('function _syncEngagedMirror()');
    const bare = CONV.match(/P\.setUiFollowUp\((?!isFollowUpEngaged)/g) ?? [];
    expect(bare, `ayna ${bare.length} yerde ELLE yazılmış — ayrışma riski geri geldi`)
      .toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C · SESSİZ KAYIP — sohbet turu da defterde KAPANIR
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAHA #1258/C — sohbet cevabı turu KAPATIR (sessiz kayıp yok)', () => {
  const ROOT = stripComments(read('platform', 'voiceService.ts'));
  const WAKE = stripComments(read('platform', 'wakeWordService.ts'));
  const EVID = stripComments(read('platform', 'maviCore', 'wiring', 'maviEvidence.ts'));

  const convFn = (): string => {
    const start = ROOT.indexOf('function _dispatchConversation(');
    return ROOT.slice(start, ROOT.indexOf('\n}', start));
  };

  it('çapa: sohbet dağıtıcısı hâlâ tek giriş', () => {
    expect(ROOT).toContain('function _dispatchConversation(');
    expect(convFn().length).toBeGreaterThan(80);
  });

  it('sohbet yolu TERMİNAL bir lifecycle fazı emit eder', () => {
    expect(convFn(), 'sohbet turu terminal faz üretmiyor → wake defterinde sessiz kayıp')
      .toContain("_emitVoiceEvent('conversation_result')");
  });

  it('sohbet, KOMUT YÜRÜTME kanıtı ÜRETMEZ (sahte yürütme yasağı)', () => {
    expect(convFn(), 'sohbet cevabı execution_result emit ederse sahte yürütme kanıtı doğar')
      .not.toContain("_emitVoiceEvent('execution_result'");
  });

  it('wake korelasyonu sohbet sonucunu da sayar', () => {
    expect(WAKE).toContain(
      "e.phase === 'execution_result' || e.phase === 'conversation_result'",
    );
  });

  it('yeni faz kanıt raporunda BEKLENEN fazlar arasında (kör nokta yok)', () => {
    expect(EVID).toContain("'conversation_result'");
  });
});
