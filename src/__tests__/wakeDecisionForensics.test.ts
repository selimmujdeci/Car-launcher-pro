/**
 * wakeDecisionForensics.test.ts — WAKE KARAR DEFTERİ kilitleri.
 *
 * BU PR'IN AMACI: wake davranışını İYİLEŞTİRMEK DEĞİL, nedenlerini
 * ÖLÇÜLEBİLİR kılmaktır. Bu yüzden kilitlerin çoğu "karar akışı DEĞİŞMEDİ"
 * invaryantını korur.
 *
 * KİLİTLENEN BOŞLUK: `onWakeWordDetected` içindeki dört kapı sessizce
 * `return` ediyordu → "hiç duyulmadı" ile "duyuldu ama bastırıldı" AYIRT
 * EDİLEMİYORDU. Kabul edilenler zaten sayılıyordu (kütük #460); reddedilen
 * ve bastırılanlar HİÇ sayılmıyordu.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptyWakeForensics, recordWakeDecision, noteIntentReached, projectWakeForensics,
  deriveTokenShape, WAKE_RING_CAP, WAKE_INTENT_TIMEOUT_MS, WAKE_DECISION_REASONS,
  type WakeForensicsState,
} from '../platform/voice/core/wakeDecisionModel';
import {
  recordWake, markWakeIntentReached, getWakeForensics, _resetWakeForensicsForTest,
} from '../platform/voice/wakeForensics';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const codeOf = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const modelSrc  = read('src/platform/voice/core/wakeDecisionModel.ts');
const gateSrc   = read('src/platform/voice/wakeForensics.ts');
const svcSrc    = read('src/platform/wakeWordService.ts');
const identSrc  = read('src/platform/companion/companionIdentity.ts');

/** `HEY_EQUIVALENTS` — ürünün KENDİ listesi (kopya sabit yazılmaz). */
const HEY = ['hey', 'ey', 'hay', 'hei'];

const T0 = 1_000_000;

function st(): WakeForensicsState { return emptyWakeForensics(); }

/* ══════════════ 1) TAKSONOMİ + KAYIT ══════════════ */

describe('Wake karar defteri — kayıt ve taksonomi', () => {
  it('KABUL kaydedilir ve sayaç artar', () => {
    const s = recordWakeDecision(st(), { atMs: T0, reason: 'ACCEPTED', path: 'GRAMMAR' });
    expect(s.counts.ACCEPTED).toBe(1);
    expect(s.records[0]?.path).toBe('GRAMMAR');
  });

  it('Her BASTIRMA gerekçesi AYRI sayılır', () => {
    let s = st();
    for (const r of ['SUPPRESSED_PAUSED', 'SUPPRESSED_VOICE_ACTIVE',
                     'SUPPRESSED_FOLLOWUP', 'SUPPRESSED_DEBOUNCE'] as const) {
      s = recordWakeDecision(s, { atMs: T0, reason: r });
    }
    expect(s.counts.SUPPRESSED_PAUSED).toBe(1);
    expect(s.counts.SUPPRESSED_VOICE_ACTIVE).toBe(1);
    expect(s.counts.SUPPRESSED_FOLLOWUP).toBe(1);
    expect(s.counts.SUPPRESSED_DEBOUNCE).toBe(1);
  });

  it('BİLİNMEYEN gerekçe kayda GİRMEZ (taksonomi kapalı küme)', () => {
    const before = st();
    const after = recordWakeDecision(before, {
      atMs: T0, reason: 'SUPPRESSED_INTERACTION' as never,
    });
    expect(after).toBe(before);
  });

  it('Ölçülemeyen zaman kayda GİRMEZ', () => {
    const before = st();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(recordWakeDecision(before, { atMs: bad, reason: 'ACCEPTED' })).toBe(before);
    }
  });

  it('🔒 SUPPRESSED_INTERACTION taksonomide YOKTUR (JS\'te karar noktası yok)', () => {
    /* `pauseWakeWordForInteraction()` motoru TAMAMEN durdurur
       (`stopGrammarMode()` + `_stopWatchdog()`) → bastırılacak wake olayı JS'e
       HİÇ ULAŞMAZ. Karar değil DURUM olduğu için gerekçe üretilmez. */
    expect(WAKE_DECISION_REASONS).not.toContain('SUPPRESSED_INTERACTION');
    expect(codeOf(svcSrc)).toContain('void stopGrammarMode();');
  });

  it('🔒 Yalnız JAVA\'da olan kararlar JS taksonomisine EKLENMEDİ', () => {
    /* VAD · TTS half-duplex · native `matchesWakePhrase` reddi JS'ten
       GÖRÜLEMEZ; JS'te gerekçe üretmek uydurma olurdu (native dilim işi). */
    for (const absent of ['NOT_EVALUATED_VAD', 'NOT_EVALUATED_TTS_HALF_DUPLEX',
                          'REJECTED_NATIVE_NO_MATCH']) {
      expect(WAKE_DECISION_REASONS as readonly string[]).not.toContain(absent);
    }
  });
});

/* ══════════════ 2) HALKA ══════════════ */

describe('Wake karar defteri — bounded halka', () => {
  it(`En fazla ${WAKE_RING_CAP} kayıt tutulur`, () => {
    let s = st();
    for (let i = 0; i < WAKE_RING_CAP + 25; i++) {
      s = recordWakeDecision(s, { atMs: T0 + i, reason: 'REJECTED_TOKEN' });
    }
    expect(s.records.length).toBe(WAKE_RING_CAP);
  });

  it('FIFO: en ESKİ düşer, en YENİ kalır', () => {
    let s = st();
    for (let i = 0; i < WAKE_RING_CAP + 3; i++) {
      s = recordWakeDecision(s, { atMs: T0 + i, reason: 'REJECTED_TOKEN' });
    }
    expect(s.records[0]?.atMs).toBe(T0 + 3);
    expect(s.records[s.records.length - 1]?.atMs).toBe(T0 + WAKE_RING_CAP + 2);
  });

  it('Düşen kayıt SAYILIR (kayıp görünür olsun)', () => {
    let s = st();
    for (let i = 0; i < WAKE_RING_CAP + 5; i++) {
      s = recordWakeDecision(s, { atMs: T0 + i, reason: 'REJECTED_TOKEN' });
    }
    expect(s.evicted).toBe(5);
    expect(projectWakeForensics(s, T0).total).toBe(WAKE_RING_CAP + 5);
  });

  it('Sayaçlar halkadan BAĞIMSIZ (taşan kayıtlar sayımdan düşmez)', () => {
    let s = st();
    for (let i = 0; i < WAKE_RING_CAP + 10; i++) {
      s = recordWakeDecision(s, { atMs: T0 + i, reason: 'SUPPRESSED_DEBOUNCE' });
    }
    expect(s.counts.SUPPRESSED_DEBOUNCE).toBe(WAKE_RING_CAP + 10);
  });
});

/* ══════════════ 3) KABUL → KOMUT KORELASYONU ══════════════ */

describe('Wake karar defteri — kabul → komut', () => {
  it('Komut oluşursa bekleyiş KAPANIR', () => {
    let s = recordWakeDecision(st(), { atMs: T0, reason: 'ACCEPTED', sessionId: 7 });
    expect(s.pendingAccept).not.toBeNull();
    s = noteIntentReached(s, 7);
    expect(s.pendingAccept).toBeNull();
    expect(s.intentReached).toBe(1);
  });

  it('BAŞKA oturumun sonucu bekleyişi kapatmaz', () => {
    let s = recordWakeDecision(st(), { atMs: T0, reason: 'ACCEPTED', sessionId: 7 });
    s = noteIntentReached(s, 9);
    expect(s.pendingAccept).not.toBeNull();
    expect(s.intentReached).toBe(0);
  });

  it('Zaman aşımı OKUMA ANINDA ACCEPTED_NO_INTENT sayılır (yeni timer YOK)', () => {
    const s = recordWakeDecision(st(), { atMs: T0, reason: 'ACCEPTED', sessionId: 1 });
    expect(projectWakeForensics(s, T0 + 1_000).acceptedNoIntent).toBe(0);
    expect(projectWakeForensics(s, T0 + WAKE_INTENT_TIMEOUT_MS).acceptedNoIntent).toBe(1);
  });

  it('Zaman aşımına uğrayan bekleyiş SONRAKİ kararda deftere yazılır', () => {
    let s = recordWakeDecision(st(), { atMs: T0, reason: 'ACCEPTED', sessionId: 1 });
    s = recordWakeDecision(s, {
      atMs: T0 + WAKE_INTENT_TIMEOUT_MS + 5_000, reason: 'ACCEPTED', sessionId: 2,
    });
    expect(s.counts.ACCEPTED_NO_INTENT).toBe(1);
    expect(s.counts.ACCEPTED).toBe(2);
  });

  it('Bekleyen kabulün YAŞI okunabilir', () => {
    const s = recordWakeDecision(st(), { atMs: T0, reason: 'ACCEPTED' });
    expect(projectWakeForensics(s, T0 + 3_000).pendingAcceptAgeMs).toBe(3_000);
    expect(projectWakeForensics(st(), T0).pendingAcceptAgeMs).toBeNull();
  });
});

/* ══════════════ 4) METİN ŞEKLİ (metin TAŞINMADAN) ══════════════ */

describe('deriveTokenShape — ürün eşleşme politikasıyla AYNI okuma', () => {
  const heyMavi = HEY.map((h) => [h, 'mavi']);
  const bare = [['mavi']];

  it('"hey mavi" → eşleşme indeks 0, çıplak DEĞİL', () => {
    const s = deriveTokenShape(['hey', 'mavi'], heyMavi);
    expect(s.matchedAtIndex).toBe(0);
    expect(s.bareNameCandidate).toBe(false);
    expect(s.tokenCount).toBe(2);
  });

  it('Dört HEY eşdeğerinin hepsi eşleşir', () => {
    for (const h of HEY) {
      expect(deriveTokenShape([h, 'mavi'], heyMavi).matchedAtIndex, h).toBe(0);
    }
  });

  it('Çok kelimeli söz cümlenin ORTASINDA da eşleşir (mevcut politika)', () => {
    const s = deriveTokenShape(['arabanin', 'rengi', 'hey', 'mavi'], heyMavi);
    expect(s.matchedAtIndex).toBe(2);
  });

  it('ÇIPLAK ad yalnız cümle BAŞINDA eşleşir (mevcut politika)', () => {
    expect(deriveTokenShape(['mavi', 'saat', 'kac'], bare).matchedAtIndex).toBe(0);
    const mid = deriveTokenShape(['bu', 'mavi', 'araba'], bare);
    expect(mid.matchedAtIndex, 'cümle ortasındaki çıplak ad eşleşmiş').toBe(-1);
    expect(mid.bareNameCandidate, 'çıplak ad adaylığı görünür olmalı').toBe(true);
  });

  it('Eşleşme yoksa -1 döner, kelime sayısı yine ölçülür', () => {
    const s = deriveTokenShape(['bugun', 'hava', 'guzel'], heyMavi);
    expect(s.matchedAtIndex).toBe(-1);
    expect(s.tokenCount).toBe(3);
  });

  it('Bozuk girdi çökmez', () => {
    expect(deriveTokenShape(null as never, heyMavi).tokenCount).toBe(0);
    expect(deriveTokenShape(['mavi'], [[]]).matchedAtIndex).toBe(-1);
  });

  it('🔒 Ürünün HEY listesiyle hizalı (kopya sabit sürüklenmesin)', () => {
    for (const h of HEY) expect(identSrc).toContain(`'${h}'`);
  });
});

/* ══════════════ 5) RUNTIME KAPISI ══════════════ */

describe('wakeForensics kapısı', () => {
  beforeEach(() => { _resetWakeForensicsForTest(); });

  it('Kayıt + okuma uçtan uca çalışır', () => {
    recordWake({ reason: 'SUPPRESSED_PAUSED', path: 'GRAMMAR' });
    const p = getWakeForensics(5);
    expect(p.counts.SUPPRESSED_PAUSED).toBe(1);
    expect(p.recent[0]?.reason).toBe('SUPPRESSED_PAUSED');
  });

  it('Okuma EN YENİ önce sıralar ve limiti uygular', () => {
    for (let i = 0; i < 5; i++) recordWake({ reason: 'REJECTED_TOKEN', atMs: T0 + i });
    const p = getWakeForensics(2);
    expect(p.recent.length).toBe(2);
    expect(p.recent[0]?.atMs).toBe(T0 + 4);
  });

  it('Bozuk girdi kapıyı ÇÖKERTMEZ', () => {
    expect(() => recordWake({ reason: 'YOK' as never })).not.toThrow();
    expect(() => markWakeIntentReached(undefined)).not.toThrow();
    expect(getWakeForensics().counts.ACCEPTED).toBe(0);
  });
});

/* ══════════════ 6) GİZLİLİK ══════════════ */

describe('🔒 GİZLİLİK — ham veri taşınmıyor', () => {
  it('Kayıt tipinde metin/ses/konum/kimlik ALANI YOKTUR (yapısal)', () => {
    recordWake({ reason: 'ACCEPTED', path: 'GRAMMAR', tokenCount: 2, matchedAtIndex: 0 });
    const rec = getWakeForensics(1).recent[0] as unknown as Record<string, unknown>;
    for (const banned of ['transcript', 'text', 'alternatives', 'nBest', 'audio',
                          'pcm', 'lat', 'lon', 'latitude', 'longitude',
                          'userId', 'token', 'secret', 'phrase', 'wakeWord']) {
      expect(Object.prototype.hasOwnProperty.call(rec, banned), `${banned} alanı var`).toBe(false);
    }
  });

  it('Saf model ve kapı METİN ALANI TANIMLAMAZ', () => {
    for (const [src, name] of [[modelSrc, 'model'], [gateSrc, 'kapı']] as const) {
      const code = codeOf(src);
      expect(code, `${name}: metin alanı tanımlanmış`)
        .not.toMatch(/readonly\s+(transcript|text|utterance|phrase|alternatives)\b/);
      expect(code, `${name}: ses/konum alanı tanımlanmış`)
        .not.toMatch(/\b(pcm|audioWav|latitude|longitude)\b/);
    }
  });

  it('Defter serileştirmesinde gizli dizi SIZMAZ', () => {
    recordWake({ reason: 'REJECTED_TOKEN', path: 'JS_POLLING', tokenCount: 4, matchedAtIndex: -1 });
    const json = JSON.stringify(getWakeForensics(10));
    for (const secret of ['hey mavi', 'mavi', 'merhaba nasilsin']) {
      expect(json.toLowerCase()).not.toContain(secret);
    }
  });

  it('Saf model HİÇBİR ŞEY import etmez (I/O · ağ · saat yok)', () => {
    const code = codeOf(modelSrc);
    expect(code, 'saf model dışarıya bağımlı hâle gelmiş').not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|setInterval|setTimeout|Date\.now\(/);
  });

  it('Kapı AĞ kullanmaz ve YENİ TIMER kurmaz', () => {
    const code = codeOf(gateSrc);
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
    expect(code).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame\(/);
  });
});

/* ══════════════ 7) KARAR AKIŞI DEĞİŞMEDİ ══════════════ */

/* ══════════════ 8) NATIVE ÖLÇÜM (Faz 4 — davranışa dokunmaz) ══════════════ */

describe('🔒 NATIVE wake sayaçları — yalnız ÖLÇÜM', () => {
  const javaDiag = read('android/app/src/main/java/com/cockpitos/pro/voice/VoiceMicDiagnostics.java');
  const javaPlug = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');

  it('Şema sürümü ARTTI (alan kayması görünür olsun)', () => {
    expect(javaDiag).toMatch(/SCHEMA_VERSION = 3;/);
  });

  it('GÜVEN ölçümü eklendi ama KARARA GİRMEDİ', () => {
    /* Saha: "hey mercedes"/"hey market" uyandırıyor. Güven skoru wake kararını
       DEĞİŞTİRMEZ — yalnız ayırt edici bir sayının VAR OLUP OLMADIĞINI ölçer. */
    expect(javaPlug).toContain('noteWakeMatchConf(extractVoskMinConf(rawJson))');
    expect(javaPlug).toMatch(/private double extractVoskMinConf\(String json\)/);
    /* Karar hâlâ SAF eşleşmedir: güven bir koşula SOKULMAMALI. */
    expect(javaPlug, 'güven karara sokulmuş')
      .not.toMatch(/if \([^)]*(conf|Conf)[^)]*[<>]/);
    expect(javaPlug).toMatch(/if \(matchesWakePhrase\(heard\)\)/);
  });

  it('setPartialWords FAIL-SOFT — eski Vosk sürümünde çökmez', () => {
    expect(javaPlug).toContain('recognizer.setPartialWords(true);');
    expect(javaPlug).toMatch(/catch \(Throwable ignored\) \{ \/\* 0\.3\.45 öncesi/);
  });

  it('GECİKME çapası GERÇEK sessizlikten sonra kurulur (şema 2 kusuru kapandı)', () => {
    /* Şema 2'de her eşik aşımında kuruluyordu → gürültüde 2929 ms gibi
       anlamsız değer üretiyordu (sahada ölçüldü). Artık yalnız hangover
       kapalıyken, yani gerçek sessizliğin ardından kurulur. */
    expect(javaPlug).toMatch(/if \(hangover <= 0\) \{[\s\S]{0,120}speechOnsetMs = SystemClock\.elapsedRealtime\(\);/);
    expect(javaDiag).toMatch(/public void noteWakeSpeechOnset\(long monotonicMs\)/);
    /* Sessizlik çerçevesi çapayı TEMİZLER. */
    expect(javaDiag).toMatch(/if \(!decoded\) wakeSpeechOnsetMs = 0;/);
  });

  it('YALNIZ EKLEME yapıldı — mevcut alan adları korundu', () => {
    for (const f of ['wakeEngineActive', 'grammarType', 'grammarWordCount',
                     'lastResultCategory', 'lastResultAt', 'noiseFloor']) {
      expect(javaDiag, `mevcut alan kaybolmuş: ${f}`).toContain(f);
    }
  });

  it('Sayaçlar oturum başında SIFIRLANMAZ (oran hesaplanabilsin)', () => {
    /* `noteSessionStart` per-oturum durumu sıfırlar; wake sayaçları KÜMÜLATİF
       olmalı, yoksa saniyede bir açılan oturum yüzünden oran anlamsızlaşır. */
    const reset = javaDiag.slice(
      javaDiag.indexOf('public void noteSessionStart'),
      javaDiag.indexOf('public void noteSessionEnd'),
    );
    for (const c of ['wakeYieldCount', 'wakeVadSkipFrames', 'wakeDecodeFrames',
                     'wakeNoMatchCount', 'wakeTriggerCount']) {
      expect(reset, `${c} oturum başında sıfırlanıyor`).not.toContain(c);
    }
  });

  it('Sayaçlar DOYURULUR — sarmalanma (negatif) yok', () => {
    expect(javaDiag).toMatch(/private static int bump\(int v\)/);
    expect(javaDiag).toMatch(/v >= COUNTER_CAP \? v : v \+ 1/);
  });

  it('Ölçüm noktaları KARAR AKIŞINI değiştirmedi', () => {
    /* Her nokta tek satırlık sayaç çağrısıdır; koşul/return/break EKLENMEDİ. */
    expect(javaPlug).toMatch(/if \(wakeMicMustYield\(\)\) \{\s*\n\s*\/\/[^\n]*\n\s*VoiceMicDiagnostics\.INSTANCE\.noteWakeYield\(\);/);
    // VAD kapısının kendi koşulu aynen duruyor.
    expect(javaPlug).toMatch(/if \(hangover <= 0\) \{/);
    /* Hizalama boşlukları değişebilir; eşiğin DEĞERİ kilitlidir. */
    expect(javaPlug).toMatch(/final double VAD_RMS_ON\s+= 0\.012;/);
    expect(javaPlug).toMatch(/final int\s+VAD_HANGOVER = 12;/);
  });

  it('Tetik yolu DEĞİŞMEDİ — sayaç `notifyListeners`ten ÖNCE, karar sonrası', () => {
    const at = javaPlug.indexOf('if (matchesWakePhrase(heard))');
    expect(at, 'tetik bloğu bulunamadı — kilit anlamsız').toBeGreaterThan(0);
    /* Pencere `break;`i KAPSAMALI (dar pencere yanlış "yok" verir). */
    const blk = javaPlug.slice(at, at + 2_000);
    expect(blk).toContain('triggered = true;');
    expect(blk).toContain('noteWakeTrigger(SystemClock.elapsedRealtime())');
    expect(blk).toContain('notifyListeners("wakeWord", ev);');
    expect(blk).toContain('break;');
  });

  it('🔒 Native ölçüme METİN/SES geçmez', () => {
    /* `noteWake*` imzalarında String parametre OLMAMALI (metin sızıntısı). */
    for (const m of ['noteWakeYield', 'noteWakeNoMatch']) {
      expect(javaDiag).toMatch(new RegExp(`public void ${m}\\(\\)`));
    }
    /* Şema 3: onset ayrı metotla kurulduğu için imza sadeleşti. */
    expect(javaDiag).toMatch(/public void noteWakeFrame\(boolean decoded\)/);
    expect(javaDiag).toMatch(/public void noteWakeMatchConf\(double conf\)/);
    expect(javaDiag).toMatch(/public void noteWakePartialWords\(boolean enabled\)/);
    expect(javaDiag).toMatch(/public void noteWakeTrigger\(long monotonicNowMs\)/);
  });

  it('🔒 Olay fırtınası yok — çerçeve başına JS olayı GÖNDERİLMEZ', () => {
    /* Sayaçlar yalnız bellekte artar; `notifyListeners` YALNIZ tetikte çağrılır. */
    const start = javaPlug.indexOf('private void runVoskGrammar()');
    expect(start, 'wake döngüsü bulunamadı — kilit anlamsız').toBeGreaterThan(0);
    /* Gövde ~150 satırdır; pencere onu KAPSAMALI (dar pencere yanlış "0" verir). */
    const wakeLoop = javaPlug.slice(start, start + 20_000);
    expect(wakeLoop, 'pencere tetik satırını kapsamıyor').toContain('notifyListeners("wakeWord"');
    const notifies = wakeLoop.match(/notifyListeners\("wakeWord"/g) ?? [];
    expect(notifies.length, 'wake döngüsünde birden fazla olay yayını').toBe(1);
    /* Sayaç çağrıları JS'e OLAY göndermez — yalnız bellekte artar. */
    expect(wakeLoop).not.toMatch(/noteWake\w+\([^)]*\);\s*\n\s*notifyListeners\(/);
  });

  it('Ölçüm yoksa SAHTE 0 üretilmez (şema 1 APK)', () => {
    const model = read('src/platform/devtools/sttMicModel.ts');
    expect(model).toMatch(/Ölçüm yok \(eski şema\)/);
    expect(model).toMatch(/lastTriggerLatencyMs < 0[\s\S]{0,160}Henüz tetik ölçülmedi/);
  });

  it('Gecikme ölçümü karar akışında KULLANILMAZ', () => {
    /* `speechOnsetMs` yalnız ölçüme gider; hiçbir koşulda eşik/karar girdisi olmaz. */
    const uses = (javaPlug.match(/speechOnsetMs/g) ?? []).length;
    expect(uses, 'gecikme değişkeni beklenenden fazla yerde kullanılıyor').toBeLessThanOrEqual(4);
    expect(javaPlug, 'gecikme bir koşula sokulmuş')
      .not.toMatch(/if \([^)]*speechOnsetMs[^)]*[<>]/);
  });
});

describe('🔒 YAPISAL — wake davranışı DEĞİŞMEDİ', () => {
  const code = codeOf(svcSrc);

  it('Dört kapının KOŞULLARI aynen duruyor', () => {
    expect(code).toMatch(/if \(isVoicePaused\(\)\) \{/);
    /* ⚠️ BİLİNÇLİ GÜNCELLEME — SAHA #1258 (2026-09-04, telefonda ÖLÇÜLDÜ).
       Bu kilit eskiden `vs.followUp` ROZETİNİ pinliyordu. Rozet, takip
       döngüsünün sahibinden (`voiceConversationRuntime`) ayrışabiliyordu:
       döngü öldüğü hâlde rozet açık kalıyor, `status==='idle'` iken bile her
       tetik `SUPPRESSED_FOLLOWUP` ile düşüyordu (5 denemede 3 bastırma) →
       wake KALICI kilitleniyordu. Kilit KALDIRILMADI; yeni doğru davranışa
       bağlandı: KAPI SAYISI, SIRASI ve gerekçeleri AYNI — yalnız kararın
       KAYNAĞI projeksiyondan sahibe taşındı (CLAUDE.md §14).
       Ayrışmanın kendisi `wakeFollowUpLock.test.ts` ile ayrıca kilitlidir. */
    expect(code).toMatch(/const _followUpLive = isVoiceFollowUpEngaged\(\);/);
    expect(code).toMatch(/if \(vs\.status !== 'idle' \|\| _followUpLive\) \{/);
    expect(code, 'karar yine UI rozetinden okunuyor').not.toMatch(/vs\.followUp/);
    expect(code).toMatch(/if \(now - _lastWakeAcceptedAt < WAKE_REACCEPT_DEBOUNCE_MS\) \{/);
  });

  it('POLİTİKA sabitleri değişmedi', () => {
    expect(code).toContain('const WAKE_REACCEPT_DEBOUNCE_MS = 4_000;');
    expect(code).toContain('const WAKE_WATCHDOG_INTERVAL_MS = 300_000;');
    expect(read('src/platform/voiceTuning.ts')).toMatch(/wakeGainX:\s*3\.2/);
    expect(read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'))
      .toMatch(/VAD_RMS_ON\s*=\s*0\.012/);
  });

  it('Wake POLİTİKASI (eşleşme kuralı) değişmedi', () => {
    /* Çıplak ad yalnız cümle başında; çok kelimeli söz her yerde. */
    expect(codeOf(identSrc)).toMatch(/const maxStart = bareSingleWord \? 0 : tWords\.length - pWords\.length;/);
    expect(codeOf(identSrc)).toContain("const HEY_EQUIVALENTS = ['hey', 'ey', 'hay', 'hei']");
  });

  it('YENİ TIMER eklenmedi — zamanlayıcı sayısı sabit', () => {
    const intervals = code.match(/setInterval\(/g) ?? [];
    expect(intervals.length, 'wakeWordService\'e yeni interval eklenmiş').toBe(1);
  });

  it('Karar defteri wake AKIŞINA karışmaz (yalnız kayıt)', () => {
    /* `recordWake` hiçbir koşulda `return`/`if` üretmemeli — çağrıları
       yalnız ifade satırı olmalı. */
    for (const m of code.matchAll(/recordWake\(/g)) {
      const before = code.slice(Math.max(0, m.index - 40), m.index);
      expect(before, 'recordWake bir koşulun içine alınmış').not.toMatch(/if\s*\([^)]*$/);
    }
  });

  it('Korelasyon YALNIZ terminal fazı dinler (olay fırtınası yok)', () => {
    /* ⚠️ BİLİNÇLİ GÜNCELLEME — SAHA #1258. Eski kilit TEK terminal fazı
       (`execution_result`) pinliyordu; sohbet turu hiçbir terminal faz
       üretmediği için kabul edilen tetik 20 sn sonra sessizce
       `ACCEPTED_NO_INTENT` sayılıyordu — Mavi cevap vermiş olsa BİLE
       (ölçüldü: 2 kabul · dönen 0 · toplam seslendirme 2). Kilidin AMACI
       (olay fırtınası yok = yalnız TERMİNAL fazlar dinlenir) korunur;
       terminal faz kümesi ikiye çıktı. */
    expect(code).toContain(
      "if (e.phase === 'execution_result' || e.phase === 'conversation_result') {",
    );
    expect(code).toContain('markWakeIntentReached(e.sessionId);');
    expect(code, 'her faz dinleniyor').not.toMatch(/e\.phase === 'transcribing'/);
    expect(code, 'ara faz dinleniyor — olay fırtınası').not.toMatch(/e\.phase === 'listening'/);
  });

  it('Yeni KORELASYON KİMLİĞİ sistemi kurulmadı (mevcut oturum kimliği okunur)', () => {
    expect(code).toContain('getVoiceSessionIds()');
    expect(code).not.toMatch(/wakeCorrelationId|generateWakeId|uuid/i);
  });

  it('console.log/warn içine YENİ ham metin EKLENMEDİ', () => {
    /* MEVCUT `[WakeWord] duyuldu:` satırı bu turun kapsamı DIŞINDADIR ve
       AÇIK BORÇ olarak raporlanır; bu kilit YENİ sızıntı eklenmesini önler. */
    const logs = code.match(/console\.(log|warn|error)\([^)]*\)/g) ?? [];
    const withTranscript = logs.filter((l) => /result\.transcript|JSON\.stringify\(result/.test(l));
    expect(withTranscript.length, 'yeni ham metin logu eklenmiş').toBe(1);
  });
});
