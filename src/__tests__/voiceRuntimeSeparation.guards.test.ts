/**
 * voiceRuntimeSeparation.guards.test.ts — **MAVI-F13/2 · AYRIŞTIRMA KİLİTLERİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * F13/2 `voiceService`ten üç sorumluluğu çıkardı (saf politika · algı runtime'ı ·
 * sohbet oturumu runtime'ı). Bir ayrıştırmanın en büyük iki riski şudur:
 *   1. **Yetki dağılması** — çıkarılan modül kendi tur/konuşma/eylem gerçeğini
 *      üretmeye başlar ve İKİNCİ bir otorite doğar.
 *   2. **Durum çoğaltması** — aynı olgu hem kökte hem modülde tutulur ve ikisi
 *      sessizce ayrışır.
 * Bu dosya ikisini de YAPISAL olarak yasaklar.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 *  · Her kilit ÖNCE çapasının varlığını doğrular (kör guard yasağı).
 *  · Kaynak taramaları yorumları ATAR: bir kararı ANLATAN yorum ihlal sayılamaz.
 *  · ZAYIFLATMA/SİLME YASAK (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(SRC, ...seg), 'utf8');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ROOT       = stripComments(read('platform', 'voiceService.ts'));
const POLICY     = stripComments(read('platform', 'voice', 'voiceCommandPolicy.ts'));
const PERCEPTION = stripComments(read('platform', 'voice', 'voicePerceptionRuntime.ts'));
const CONVERSE   = stripComments(read('platform', 'voice', 'voiceConversationRuntime.ts'));

/** Çıkarılan üç modül — hiçbiri otorite olamaz. */
const EXTRACTED: readonly (readonly [string, string])[] = [
  ['voiceCommandPolicy', POLICY],
  ['voicePerceptionRuntime', PERCEPTION],
  ['voiceConversationRuntime', CONVERSE],
];

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · ÇIKARILAN MODÜLLER OTORİTE DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/2-1 · yardımcı runtime\'lar ikinci otorite OLAMAZ', () => {
  it('çapa: üç modül de gerçekten okundu ve dolu', () => {
    for (const [name, src] of EXTRACTED) {
      expect(src.length, `${name} okunamadı — kilit körleşti`).toBeGreaterThan(800);
    }
  });

  it('hiçbiri TUR otoritesini üretmez/çağırmaz (`maviTurn` tek otorite)', () => {
    for (const [name, src] of EXTRACTED) {
      for (const forbidden of [
        'beginMaviTurn', 'completeMaviTurn', 'supersedeActiveMaviTurn',
        'getActiveMaviTurn', 'assistant/maviTurn',
      ]) {
        expect(src, `${name}: tur otoritesine dokundu (${forbidden})`).not.toContain(forbidden);
      }
    }
    // Çapa: kök GERÇEKTEN tur otoritesini kullanıyor (tarama doğru dosyalara bakıyor).
    expect(ROOT).toContain('beginMaviTurn(');
  });

  it('hiçbiri KONUŞMA otoritesini çağırmaz (`maviSpeech` tek otorite)', () => {
    for (const [name, src] of EXTRACTED) {
      for (const forbidden of [
        'speakMaviAnswer', 'assistant/maviSpeech', 'ttsSpeak', 'speakFeedback',
      ]) {
        expect(src, `${name}: konuşma otoritesine dokundu (${forbidden})`).not.toContain(forbidden);
      }
    }
    expect(ROOT).toContain('speakMaviAnswer(');
  });

  it('hiçbiri EYLEM yürütmez (capability / authority / executor yolu kökte)', () => {
    for (const [name, src] of EXTRACTED) {
      for (const forbidden of [
        'commandExecutor', 'dispatchIntent', 'executeIntent', 'processTextCommand',
        'capabilityFabric', 'maviActionAuthority', 'runCapabilityPlan', 'intentEngine',
      ]) {
        expect(src, `${name}: eylem yoluna dokundu (${forbidden})`).not.toContain(forbidden);
      }
    }
    /* Çapa: eylem yolu GERÇEKTEN kökte. MAVI-F13/3'te plan MEKANİĞİ ayrıldı
       ama KAPI (capability değerlendirmesi) ve YÜRÜTME kökte kaldı — kilit
       artık bunu doğrular. */
    expect(ROOT).toMatch(/runMaviCompoundPlan[<(]/);
    expect(ROOT).toContain('evaluateLegacyIntent(');
    expect(ROOT).toContain('takeLastCapabilityObservation()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1b · MAVI-F13/3 · BİLEŞİK PLAN MEKANİĞİ DE OTORİTE DEĞİLDİR
 *
 * Plan mekaniği diğer üçünden AYRI tutulur çünkü tek meşru bağımlılığı vardır:
 * kanonik plan katmanı (`capability/fabric/capabilityPlan*`). Bu bir istisna
 * DEĞİL, sözleşmedir — ve kilit o sözleşmenin sınırını tam olarak çizer.
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/3-1 · plan mekaniği otorite OLAMAZ', () => {
  const PLAN_RT = stripComments(read('platform', 'voice', 'maviCompoundPlanRuntime.ts'));

  it('çapa: mekanik gerçekten okundu ve plan zincirini içeriyor', () => {
    expect(PLAN_RT.length, 'plan mekaniği okunamadı — kilit körleşti').toBeGreaterThan(800);
    expect(PLAN_RT).toContain('export async function runMaviCompoundPlan');
    expect(PLAN_RT).toContain('runCapabilityPlan(');
  });

  it('YALNIZ kanonik plan katmanını import eder — başka hiçbir şeyi', () => {
    const imports = PLAN_RT.match(/^import .*from '([^']+)';$/gm) ?? [];
    expect(imports.length, 'import bulunamadı — kilit körleşti').toBeGreaterThan(0);
    const sources = imports.map((l) => /from '([^']+)'/.exec(l)![1]);
    for (const src of sources) {
      expect(src, `plan mekaniği izinsiz modül import etti: ${src}`)
        .toMatch(/^\.\.\/capability\/fabric\//);
    }
  });

  it('konuşmaz · tur açmaz · yürütmez · kapı kurmaz · telemetri yazmaz', () => {
    for (const forbidden of [
      'speakMaviAnswer', 'maviSpeech', 'ttsService',
      'maviTurn', 'beginMaviTurn', 'completeMaviTurn',
      'commandExecutor', 'dispatchIntent', 'executeIntent', 'intentEngine',
      'evaluateLegacyIntent', 'capabilityFabric', 'maviActionAuthority',
      'setMaviLatencyPlan', 'recordCapabilityPlan', 'maviLatencyTrace',
      'takeLastCapabilityObservation',
    ]) {
      expect(PLAN_RT, `plan mekaniği otoriteye dokundu: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('cevap slotunu TUTMAZ/BIRAKMAZ — tek-cevap sözleşmesi kökte', () => {
    for (const forbidden of ['claimMaviAnswerStream', 'releaseMaviAnswerStream',
                             'releaseMaviAnswerSlot']) {
      expect(PLAN_RT, `plan mekaniği cevap slotuna dokundu: ${forbidden}`)
        .not.toContain(forbidden);
    }
    // Çapa: slot sahipliği GERÇEKTEN kökte.
    expect(ROOT).toContain('claimMaviAnswerStream(');
    expect(ROOT).toContain('releaseMaviAnswerSlot()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · KATMAN SINIRLARI (perception ≠ conversation ≠ policy)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/2-2 · katman sınırları', () => {
  it('SAF politika katmanı gerçekten SAFTIR (durum · timer · I/O YOK)', () => {
    for (const forbidden of [
      'setTimeout(', 'setInterval(', 'localStorage', 'Date.now(', 'addListener(',
      'let _', 'window.', 'document.',
    ]) {
      expect(POLICY, `voiceCommandPolicy saf değil: ${forbidden}`).not.toContain(forbidden);
    }
    // Çapa: dosya gerçekten sınıflandırma yapıyor.
    expect(POLICY).toContain('export function isResultAckCommand(');
    expect(POLICY).toContain('export function bestLocalParse(');
  });

  it('ALGI katmanı sohbet oturumunu YÖNETMEZ (yalnız port ile SORAR)', () => {
    expect(PERCEPTION).toContain('isFollowUpEngaged');           // çapa: port var
    for (const forbidden of [
      'voiceConversationRuntime', 'armFollowUp', 'startListening(', '_convSession',
    ]) {
      expect(PERCEPTION, `algı katmanı sohbet oturumuna girdi: ${forbidden}`)
        .not.toContain(forbidden);
    }
  });

  it('SOHBET katmanı hiçbir platform modülü import ETMEZ (tamamı port)', () => {
    // Çapa: port arabirimi gerçekten tanımlı.
    expect(CONVERSE).toContain('export interface VoiceConversationPorts');
    const imports = CONVERSE.match(/^import .*$/gm) ?? [];
    expect(imports, 'sohbet runtime\'ı bir modül import etti — port sözleşmesi delindi')
      .toEqual([]);
  });

  it('ALGI katmanı kısmi transkriptten EYLEM tetikleyemez (F3 sözleşmesi)', () => {
    // Tek "komut" mikrofonu kapatmaktır; başka hiçbir yan etki yoktur.
    expect(PERCEPTION).toContain('finalizeSpeechRecognition');
    for (const forbidden of ['navigationService', 'mediaService.play', 'obdService']) {
      expect(PERCEPTION, `F3 kısmi yolu eylem tetikledi: ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · DURUM SAHİPLİĞİ — AYNI OLGU İKİ YERDE TUTULMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/2-3 · tek sahip kuralı', () => {
  it('sohbet oturumu durumu YALNIZ sohbet runtime\'ında yaşar', () => {
    // Çapa: durum gerçekten runtime'da.
    expect(CONVERSE).toMatch(/let _convSession = false;/);
    expect(CONVERSE).toMatch(/let _followUpArmed = false;/);
    expect(CONVERSE).toMatch(/let _convIdleOnTtsEnd = false;/);
    // Kökte İKİNCİ kopya YOK.
    for (const dup of ['_convSession', '_followUpArmed', '_convIdleOnTtsEnd',
                       '_followUpFallbackTimer', '_convIdleFallbackTimer']) {
      expect(ROOT, `kökte ikinci kopya: ${dup}`).not.toContain(dup);
    }
  });

  it('algı kaynakları YALNIZ algı runtime\'ında yaşar', () => {
    expect(PERCEPTION).toMatch(/let _audioCtx: AudioContext \| null = null;/);
    expect(PERCEPTION).toMatch(/let _volumeSimTimer/);
    expect(PERCEPTION).toMatch(/let _rmsListenerHandle/);
    expect(PERCEPTION).toMatch(/let _f3SessionId = 0;/);
    for (const dup of ['_audioCtx', '_volumeSimTimer', '_rmsListenerHandle',
                       '_f3SessionId', '_partialListenerHandle', '_assistantDuckedMusic']) {
      expect(ROOT, `kökte ikinci kopya: ${dup}`).not.toContain(dup);
    }
  });

  it('UI durumu (`VoiceState`) TEK sahiptedir: kök', () => {
    expect(ROOT).toContain('let _current: VoiceState');
    for (const [name, src] of EXTRACTED) {
      expect(src, `${name}: UI durumunun kopyasını tutuyor`).not.toContain('VoiceState');
      expect(src, `${name}: UI durumunu doğrudan yazıyor`).not.toMatch(/\bpush\(\{/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · ZERO-LEAK — kuran ile söken AYNI modülde
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/2-4 · timer/listener sahipliği ve söküm', () => {
  it('her runtime kendi sökümünü DIŞA VERİR ve kök onu çağırır', () => {
    expect(PERCEPTION).toContain('export function disposeVoicePerception(');
    expect(CONVERSE).toContain('export function disposeConversationRuntime(');
    expect(ROOT).toContain('disposeVoicePerception()');
    expect(ROOT).toContain('disposeConversationRuntime()');
  });

  it('algı sökümü AÇTIĞI HER kaynağı kapatır', () => {
    const i = PERCEPTION.indexOf('export function disposeVoicePerception');
    const body = PERCEPTION.slice(i, i + 500);
    expect(body).toContain('closePartialTranscriptSession');
    expect(body).toContain('stopVolumeSimulation');
    expect(body).toContain('stopNativeVolumeListener');
    expect(body).toContain('stopVolumeMeter');
  });

  it('sohbet sökümü ÜÇ zamanlayıcının hepsini iptal eder', () => {
    // `disarmFollowUp` iki timer'ı, `clearConvIdle` üçüncüyü temizler.
    const i = CONVERSE.indexOf('export function disarmFollowUp');
    const body = CONVERSE.slice(i, i + 500);
    expect(body).toContain('_followUpFallbackTimer');
    expect(body).toContain('_followUpRelistenTimer');   // F13/2: eskiden SAHİPSİZDİ
    const j = CONVERSE.indexOf('export function endConversationSession');
    const end = CONVERSE.slice(j, j + 300);
    expect(end).toContain('disarmFollowUp()');
    expect(end).toContain('clearConvIdle()');
  });

  it('TTS-bitiş aboneliği TEKTİR ve bileşim kökündedir', () => {
    const roots = ROOT.match(/registerTtsEndListener\(/g) ?? [];
    expect(roots.length, 'kökte tam bir TTS-bitiş aboneliği olmalı').toBe(1);
    for (const [name, src] of EXTRACTED) {
      expect(src, `${name}: ikinci TTS-bitiş aboneliği kurdu`)
        .not.toContain('registerTtsEndListener');
    }
    // Kök kararı sahibine devreder (kendi ikinci sohbet mantığını kurmaz).
    expect(ROOT).toContain('onConversationTtsEnd()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · PORT BAĞLAMASI GERÇEK OLMALI (boş closure kabul edilmez)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/2-5 · port bağlamaları gerçek motorlara bağlı', () => {
  it('algı portları kökün GERÇEK durumuna/servisine bağlı', () => {
    const i = ROOT.indexOf('configureVoicePerception({');
    expect(i, 'algı port bağlaması bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    const body = ROOT.slice(i, i + 700);
    expect(body).toContain('push({ volumeLevel:');
    /* ⚠️ BİLİNÇLİ GÜNCELLEME — SAHA #1258. Port eskiden
       `isFollowUpArmed() || _current.followUp === true` idi: sahibin gerçeği
       UI ROZETİYLE OR'lanıyordu. Rozet sahibinden ayrışabildiği için (ölçüldü:
       döngü ölü, rozet açık) bu OR ayrışmayı GİZLİYORDU. Kilidin amacı aynı —
       port kökün GERÇEK durumuna bağlı olmalı — ama kaynak artık TEK: sohbet
       runtime'ının kendi hükmü. */
    expect(body).toContain('isConvFollowUpEngaged()');
    expect(body, 'algı portu yine UI rozetini OR-luyor').not.toMatch(/_current\.followUp/);
    expect(body).toContain('webkitSpeechRecognition');
  });

  it('sohbet portları kökün GERÇEK dinleme/UI yoluna bağlı', () => {
    const i = ROOT.indexOf('configureVoiceConversation({');
    expect(i, 'sohbet port bağlaması bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    const body = ROOT.slice(i, i + 1200);
    expect(body).toContain('startListening(o)');
    expect(body).toContain('_current.status');
    expect(body).toContain('push({ followUp:');
    expect(body).toContain('isTtsSpeaking()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · MAVI-F13/3 · PLAN MEKANİĞİ — DAVRANIŞ KİLİTLERİ
 *
 * Yukarıdaki F13/3-1 kilitleri KAYNAK tarar: "otoriteyi import etmemiş" der.
 * Ama bir modül hiçbir şey import etmeden de sözleşmeyi bozabilir: adımları
 * yanlış sırada çalıştırabilir, iptal edilmiş turda yan etki başlatabilir,
 * ya da gözlem yokken cümle UYDURABİLİR. Bu bölüm o üçünü GERÇEK ÇAĞRIYLA
 * ölçer — kaynak metni değil, davranışı kilitler.
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/3-6 · plan mekaniği davranış sözleşmesi', () => {
  const proposal = (intent: string) => ({
    capabilityId: `legacy.${intent}`,
    operation: 'run',
    parameters: { slot: intent } as Readonly<Record<string, string>>,
    legacyIntent: intent.toUpperCase(),
    requiresConfirmation: false,
  });

  it('adımları ÖNERİ SIRASINDA ve tam bir kez yürütür', async () => {
    const { runMaviCompoundPlan, _resetMaviCompoundPlanForTest } =
      await import('../platform/voice/maviCompoundPlanRuntime');
    _resetMaviCompoundPlanForTest();
    const seen: string[] = [];
    const run = await runMaviCompoundPlan<string>({
      steps: ['a', 'b', 'c'].map((p) => ({ proposal: proposal(p), payload: p })),
      planIdPrefix: 't',
      turnId: 1,
      isTurnCurrent: () => true,
      execute: async (p) => { seen.push(p); return 'EXECUTED'; },
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(run.summary.itemCount).toBe(3);
  });

  it('tur eskiyince KALAN adımlar yan etki BAŞLATMADAN düşer', async () => {
    const { runMaviCompoundPlan, _resetMaviCompoundPlanForTest } =
      await import('../platform/voice/maviCompoundPlanRuntime');
    _resetMaviCompoundPlanForTest();
    const seen: string[] = [];
    let alive = true;
    await runMaviCompoundPlan<string>({
      steps: ['a', 'b', 'c'].map((p) => ({ proposal: proposal(p), payload: p })),
      planIdPrefix: 't',
      turnId: 2,
      isTurnCurrent: () => alive,
      execute: async (p) => { seen.push(p); alive = false; return 'EXECUTED'; },
    });
    expect(seen, 'ilk adımdan sonra tur devralındı — kalanlar çalışmamalı').toEqual(['a']);
  });

  it('gözlem hiç yoksa cümle UYDURMAZ (boş dize döner)', async () => {
    const { runMaviCompoundPlan, _resetMaviCompoundPlanForTest } =
      await import('../platform/voice/maviCompoundPlanRuntime');
    _resetMaviCompoundPlanForTest();
    const run = await runMaviCompoundPlan<string>({
      steps: ['a', 'b'].map((p) => ({ proposal: proposal(p), payload: p })),
      planIdPrefix: 't',
      turnId: 3,
      isTurnCurrent: () => true,
      execute: async () => null,
    });
    expect(run.outcomeText, 'kanıtsız başarı cümlesi üretildi').toBe('');
  });

  it('plan kimliği her çağrıda ARTAR (iki yol LAB gözleminde karışmaz)', async () => {
    const { nextPlanId, _resetMaviCompoundPlanForTest } =
      await import('../platform/voice/maviCompoundPlanRuntime');
    _resetMaviCompoundPlanForTest();
    expect([nextPlanId('p'), nextPlanId('c'), nextPlanId('p')]).toEqual(['p1', 'c2', 'p3']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · MAVI-F13/3 · `companionChatProvider` DEEP ROLE İNDİRGEME KİLİTLERİ
 *
 * F13/3 sağlayıcıdan İKİ alt sistem çıkardı:
 *   · `companionProviderHealth`  — 429 kota pencereleri · kimlik/kredi işaretleri
 *   · `companionOfflineReplies`  — deterministik smalltalk sınıflaması + yedek
 * İkisi de **yaprak** olmak zorundadır: ağa çıkmaz, konuşmaz, rota seçmez,
 * telemetri yazmaz. Aksi hâlde "DEEP sağlayıcı" iddiası, sorumluluğu bir
 * dosyadan diğerine taşıyan bir isim değişikliğinden ibaret kalır.
 * ════════════════════════════════════════════════════════════════════════ */

const HEALTH  = stripComments(read('platform', 'companion', 'companionProviderHealth.ts'));
const OFFLINE = stripComments(read('platform', 'companion', 'companionOfflineReplies.ts'));
const CHAT_PROVIDER = stripComments(read('platform', 'companion', 'companionChatProvider.ts'));

describe('F13/3-7 · çıkarılan companion alt sistemleri yaprak KALIR', () => {
  it('çapa: iki modül de gerçekten okundu ve dolu', () => {
    expect(HEALTH.length, 'sağlık defteri okunamadı — kilit körleşti').toBeGreaterThan(800);
    expect(OFFLINE.length, 'offline yedek okunamadı — kilit körleşti').toBeGreaterThan(800);
    expect(HEALTH).toContain('export function resolveProviderFailureAnswer');
    expect(OFFLINE).toContain('export function classifySmalltalk');
  });

  it('offline yedek HİÇBİR modül import etmez (tam yaprak)', () => {
    expect(OFFLINE.match(/^import .*$/gm) ?? []).toEqual([]);
  });

  it('sağlık defteri HİÇBİR modül import etmez (tam yaprak)', () => {
    expect(HEALTH.match(/^import .*$/gm) ?? []).toEqual([]);
  });

  it('ikisi de ağa ÇIKMAZ · konuşmaz · rota seçmez · telemetri yazmaz', () => {
    for (const [name, src] of [['providerHealth', HEALTH], ['offlineReplies', OFFLINE]] as const) {
      for (const forbidden of [
        'fetch(', 'aiPostJson', 'XMLHttpRequest',
        'speakMavi', 'maviSpeech', 'ttsService',
        'pushTrail', 'reportVoiceDiag', 'recordAiNet',
        'CompanionChatRoute', 'runCompanionBrain', 'askCompanion',
        'localStorage', 'useStore',
      ]) {
        expect(src, `${name}: sözleşmeyi deldi (${forbidden})`).not.toContain(forbidden);
      }
    }
  });

  it('soğuma/tazelik hesabı MONOTONİK saattir (`Date.now` YASAK)', () => {
    // Saat sıçraması (batarya kopması) pencereleri geçmişe atardı.
    expect(HEALTH, 'sağlık defteri Date.now kullandı').not.toContain('Date.now(');
    expect(HEALTH).toContain('performance.now()');
    expect(OFFLINE, 'offline yedek zamana bağlandı').not.toContain('Date.now(');
  });

  it('offline rotasyon DETERMİNİSTİK (Math.random YASAK)', () => {
    expect(OFFLINE).not.toContain('Math.random');
  });

  it('sağlayıcı kökte İKİNCİ kopya durum TUTMAZ', () => {
    for (const dup of [
      '_rateLimitedUntil', '_groqRateLimitedUntil', '_haikuRateLimitedUntil',
      '_groundingCooldownUntil', '_geminiKeyInvalidAtMs', '_noCreditAtMs',
      '_offlineCounter', 'OFFLINE_REPLIES',
    ]) {
      expect(CHAT_PROVIDER, `sağlayıcıda ikinci kopya: ${dup}`).not.toContain(dup);
    }
  });

  it('DIŞ YÜZEY DEĞİŞMEDİ: LAB/tanı tüketicileri sağlayıcıdan okumaya devam eder', () => {
    // maviConsoleSources · diagnosticSections bu adları sağlayıcıdan import ediyor.
    expect(CHAT_PROVIDER)
      .toMatch(/export \{ RATE_LIMIT_COOLDOWN_MS, getProviderQuotaSnapshot \} from '\.\/companionProviderHealth'/);
    expect(CHAT_PROVIDER)
      .toMatch(/export \{ classifySmalltalk \} from '\.\/companionOfflineReplies'/);
  });
});

describe('F13/3-8 · sağlık defteri DAVRANIŞ sözleşmesi', () => {
  it('bir sağlayıcının kotası ÖTEKİNİ susturmaz (SAHA 2026-07-04 dersi)', async () => {
    const h = await import('../platform/companion/companionProviderHealth');
    h._resetProviderHealthForTest();
    h.noteProviderRateLimited('groq');
    expect(h.isProviderCoolingDown('groq')).toBe(true);
    expect(h.isProviderCoolingDown('gemini'), 'çapraz kirlenme geri geldi').toBe(false);
    expect(h.isProviderCoolingDown('haiku'), 'çapraz kirlenme geri geldi').toBe(false);
    h._resetProviderHealthForTest();
  });

  it('grounding penceresi BEYİN penceresinden ayrıdır', async () => {
    const h = await import('../platform/companion/companionProviderHealth');
    h._resetProviderHealthForTest();
    h.noteGroundingRateLimited();
    expect(h.isGroundingCoolingDown()).toBe(true);
    expect(h.isProviderCoolingDown('gemini'), 'grounding 429 beyni öldürdü').toBe(false);
    h._resetProviderHealthForTest();
  });

  it('KREDİ bitişi anahtar geçersizliğinden ÖNCE konuşur (#698 sırası)', async () => {
    const h = await import('../platform/companion/companionProviderHealth');
    h._resetProviderHealthForTest();
    h.noteProviderAuthFailure('groq', 401);
    h.noteProviderAuthFailure('gateway', 402);
    expect(h.resolveProviderFailureAnswer()?.kind).toBe('no_credit');
    h._resetProviderHealthForTest();
  });

  it('kimlik reddi künyesi SAĞLAYICI ADI taşır — anahtar/PII asla', async () => {
    const h = await import('../platform/companion/companionProviderHealth');
    h._resetProviderHealthForTest();
    h.noteProviderAuthFailure('haiku', 403);
    const a = h.resolveProviderFailureAnswer();
    expect(a?.kind).toBe('key_invalid');
    expect(a?.provider).toBe('haiku');
    h._resetProviderHealthForTest();
  });

  it('200 dönen sağlayıcı kimlik işaretini TEMİZLER', async () => {
    const h = await import('../platform/companion/companionProviderHealth');
    h._resetProviderHealthForTest();
    h.noteProviderAuthFailure('gemini', 401);
    expect(h.resolveProviderFailureAnswer()).not.toBeNull();
    h.clearAuthFailure();
    expect(h.resolveProviderFailureAnswer()).toBeNull();
    h._resetProviderHealthForTest();
  });

  it('kota anlık görüntüsü PII taşımaz — yalnız kalan süre (ms)', async () => {
    const h = await import('../platform/companion/companionProviderHealth');
    h._resetProviderHealthForTest();
    expect(h.getProviderQuotaSnapshot())
      .toEqual({ geminiCooldownMs: 0, groqCooldownMs: 0, haikuCooldownMs: 0 });
    h.noteProviderRateLimited('haiku');
    const snap = h.getProviderQuotaSnapshot();
    expect(Object.keys(snap).sort())
      .toEqual(['geminiCooldownMs', 'groqCooldownMs', 'haikuCooldownMs']);
    expect(snap.haikuCooldownMs).toBeGreaterThan(0);
    h._resetProviderHealthForTest();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · MAVI-F13/4 · BEYİN AYRIŞTIRICISI + PERSONA ŞEKİLLENDİRME YAPRAK KALIR
 *
 * F13/4 sağlayıcıdan iki saf sorumluluk daha çıkardı:
 *   · `companionBrainParser`   — model JSON'u → kanonik `SemanticResult` önerisi
 *   · `companionAnswerShaping` — persona'ya bağlı deterministik metinler
 * Ayrıştırıcı en riskli çıkarımdır: ürettiği şey bir EYLEM ÖNERİSİDİR. Bu
 * yüzden "öneri üretir ama yetkisi yoktur" sınırı YAPISAL olarak kilitlenir.
 * ════════════════════════════════════════════════════════════════════════ */

const BRAIN_PARSER = stripComments(read('platform', 'companion', 'companionBrainParser.ts'));
const SHAPING      = stripComments(read('platform', 'companion', 'companionAnswerShaping.ts'));
const PROVIDER_SRC = stripComments(read('platform', 'companion', 'companionChatProvider.ts'));

describe('F13/4-1 · beyin ayrıştırıcısı ÖNERİ üretir, YETKİ taşımaz', () => {
  it('çapa: modül okundu ve gerçekten ayrıştırıyor', () => {
    expect(BRAIN_PARSER.length, 'ayrıştırıcı okunamadı — kilit körleşti').toBeGreaterThan(800);
    expect(BRAIN_PARSER).toContain('export function parseBrainJson');
    expect(BRAIN_PARSER).toContain('export function semanticFromBrainAction');
  });

  it('konuşmaz · tur açmaz · yürütmez · kapı kurmaz · ağa çıkmaz', () => {
    for (const forbidden of [
      'speakMavi', 'maviSpeech', 'ttsService',
      'maviTurn', 'beginMaviTurn', 'completeMaviTurn',
      'commandExecutor', 'dispatchIntent', 'executeIntent', 'intentEngine',
      'capabilityFabric', 'maviActionAuthority', 'evaluateLegacyIntent',
      'fetch(', 'aiPostJson', 'useStore', 'localStorage',
      'pushTrail', 'reportVoiceDiag',
    ]) {
      expect(BRAIN_PARSER, `ayrıştırıcı otoriteye dokundu: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('SAF: modül seviyesinde mutable durum · timer · zaman · rastgelelik YOK', () => {
    for (const forbidden of ['Date.now(', 'performance.now(', 'Math.random',
                             'setTimeout(', 'setInterval(']) {
      expect(BRAIN_PARSER, `ayrıştırıcı saf değil: ${forbidden}`).not.toContain(forbidden);
    }
    expect(BRAIN_PARSER.match(/^let /gm) ?? [], 'ayrıştırıcı durum tutuyor').toEqual([]);
  });

  it('SAĞLAYICIYA yalnız `import type` ile bağlıdır (çalışma zamanı kenarı YOK)', () => {
    const lines = BRAIN_PARSER.match(/^import .*companionChatProvider.*$/gm) ?? [];
    expect(lines.length, 'sağlayıcı bağı bulunamadı — kilit körleşti').toBe(1);
    expect(lines[0], 'ayrıştırıcı sağlayıcıyı DEĞER olarak import etti (döngü riski)')
      .toMatch(/^import type /);
  });

  it('izinli intent kümesi KATALOGDAN gelir — elle liste YASAK (F5)', () => {
    expect(BRAIN_PARSER).toContain('brainIntentAllowlist()');
    // Elle yazılmış bir intent dizisi ikinci bir gerçeklik olurdu.
    expect(BRAIN_PARSER, 'ayrıştırıcıda elle intent listesi belirdi')
      .not.toMatch(/\[\s*'(OPEN_APP|SET_SETTING|NAVIGATE)'/);
  });

  it('filler kapısı PARSE SINIRINDA kaldı (F2 · I11)', () => {
    expect(BRAIN_PARSER).toContain('isGenericFiller(');
    expect(PROVIDER_SRC, 'filler kapısı sağlayıcıda İKİNCİ kez kuruldu')
      .not.toContain('isGenericFiller(');
  });

  it('sağlayıcıda ayrıştırıcının İKİNCİ kopyası KALMADI', () => {
    for (const dup of ['interface BrainJson', 'function parseBrainJson',
                       '_semanticFromBrainAction', 'BRAIN_PERSONA_ROLE',
                       'REASK_BY_PERSONALITY', 'NET_DOWN_BY_PERSONALITY']) {
      expect(PROVIDER_SRC, `sağlayıcıda ikinci kopya: ${dup}`).not.toContain(dup);
    }
    // Çapa: sağlayıcı GERÇEKTEN ayrıştırıcıyı kullanıyor (boş tarama değil).
    expect(PROVIDER_SRC).toContain("from './companionBrainParser'");
    expect(PROVIDER_SRC).toContain('parseBrainJson(');
  });

  it('persona şekillendirme SAF kaldı ve bilinmeyen kişilik fail-soft', () => {
    for (const forbidden of ['fetch(', 'Date.now(', 'Math.random', 'useStore',
                             'localStorage', 'speakMavi']) {
      expect(SHAPING, `şekillendirme saf değil: ${forbidden}`).not.toContain(forbidden);
    }
    expect(SHAPING).toContain('export function brainPersonaRole');
    expect(SHAPING).toContain('export function reaskReply');
    expect(SHAPING).toContain('export function netDownReply');
  });
});

describe('F13/4-2 · ayrıştırıcı DAVRANIŞ sözleşmesi', () => {
  it('bozuk JSON · tanınmayan intent → null (uydurma yapı YOK)', async () => {
    const { parseBrainJson } = await import('../platform/companion/companionBrainParser');
    expect(parseBrainJson('bu json değil')).toBeNull();
    expect(parseBrainJson(JSON.stringify({ type: 'action', intent: 'UYDURMA_INTENT' }))).toBeNull();
    expect(parseBrainJson(JSON.stringify({ type: 'action', actions: [] }))).toBeNull();
  });

  it('bileşik adım tavanı BOUNDED — bozuk çıktı sınırsız iş üretemez', async () => {
    const { parseBrainJson, MAX_PLAN_ITEMS } =
      await import('../platform/companion/companionBrainParser');
    const { brainIntentAllowlist } =
      await import('../platform/capability/fabric/carosCapabilityCatalog');
    const intent = brainIntentAllowlist()[0];
    expect(intent, 'katalog boş — kilit körleşti').toBeTruthy();
    const actions = Array.from({ length: MAX_PLAN_ITEMS + 7 }, () => ({ intent }));
    const out = parseBrainJson(JSON.stringify({ type: 'action', actions }));
    expect(out?.kind).toBe('action');
    if (out?.kind === 'action') {
      expect(out.semantics.length).toBeLessThanOrEqual(MAX_PLAN_ITEMS);
    }
  });

  it('sohbet cevabı SÜRÜŞTE kırpılır, PARKTA kırpılmaz (dikkat bütçesi)', async () => {
    const { parseBrainJson } = await import('../platform/companion/companionBrainParser');
    const say = 'Uzun bir anlatım. '.repeat(60);          // ~1080 karakter
    const drv = parseBrainJson(JSON.stringify({ type: 'chat', say }), true);
    const prk = parseBrainJson(JSON.stringify({ type: 'chat', say }), false);
    expect(drv?.kind).toBe('chat');
    if (drv?.kind === 'chat' && prk?.kind === 'chat') {
      expect(drv.response.length).toBeLessThanOrEqual(300);
      expect(prk.response.length).toBeGreaterThan(drv.response.length);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · MAVI-F13/4 · PLAN KİMLİĞİ ÖNEK SÖZLEŞMESİ (QA F13/3 bulgusu)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13/4-3 · plan öneki ayrıştırılabilirliği FAIL-CLOSED korur', () => {
  it('geçerli önekler kimlik üretir', async () => {
    const { nextPlanId, _resetMaviCompoundPlanForTest } =
      await import('../platform/voice/maviCompoundPlanRuntime');
    _resetMaviCompoundPlanForTest();
    expect(nextPlanId('p')).toBe('p1');
    expect(nextPlanId('c')).toBe('c2');
  });

  it('ayırıcı (`:`) içeren önek REDDEDİLİR — yanlış adım yürütülemez', async () => {
    const { nextPlanId } = await import('../platform/voice/maviCompoundPlanRuntime');
    /* `itemId` = `${planId}:${indeks}` ve yürütücü `split(':')[1]` ile yükü
       eşliyor. Önekte iki nokta olursa YANLIŞ komut çalışırdı. */
    const bad = nextPlanId as unknown as (p: string) => string;
    expect(() => bad('p:x')).toThrow();
    expect(() => bad('')).toThrow();
  });

  it('kaynakta önek tipi KAPALI KÜME (serbest `string` değil)', () => {
    const PLAN_RT_SRC = stripComments(read('platform', 'voice', 'maviCompoundPlanRuntime.ts'));
    expect(PLAN_RT_SRC).toContain("export type MaviPlanIdPrefix = 'p' | 'c'");
    expect(PLAN_RT_SRC, 'önek yeniden serbest string oldu')
      .not.toMatch(/nextPlanId\(prefix: string\)/);
    expect(PLAN_RT_SRC, 'istek sözleşmesinde önek serbest string')
      .not.toMatch(/planIdPrefix: string/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · MAVI-F13 · HAYALET UZAK BAYRAK YASAĞI — KAYNAKTAN TÜRETİLİR
 *
 * ÖLÇÜLDÜ (iki kez, iki ayrı turda):
 *   · F13/4 öncesi — `mavi_semantic_endpoint` (F3) ve `mavi_streaming_response`
 *     (F4) setter'ları tanımlıydı ama üretimde HİÇ çağrılmıyordu (#1039).
 *   · F13/4 sonrası — aynı kusur `setCapabilityFabricEnforceRemoteFlag`te
 *     HAYATTA KALDI, çünkü o turun kilidi ÜÇ SABİT ADA bağlıydı ve yeni/kaçan
 *     bir setter'ı göremiyordu. **Sabit listeli kilit, listeyi güncellemeyi
 *     unutan geliştiriciyi yakalayamaz — yani asıl korunması gereken hâli.**
 *
 * Bu yüzden kilit ARTIK LİSTE TAŞIMAZ: sözleşmeyi üretim kaynağından TÜRETİR.
 * Her `export function set<X>RemoteFlag(...)` için şunlar ZORUNLUDUR:
 *   1. gerçek bir üretim BESLEYİCİSİ — `set<X>RemoteFlag(getFlag(<KEY>) === true)`
 *   2. bir SÖKÜM/RESET yolu — `set<X>RemoteFlag(false)`
 * Biri eksikse o bayrak bir HAYALETTİR: belgede rollout sözü verilir, kodda
 * karşılığı yoktur.
 *
 * BOŞ KÜME PASS VEREMEZ: setter bulunamazsa kilit körleşmiş demektir ve DÜŞER.
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-GHOST · her uzak bayrak setter\'ının gerçek besleyicisi vardır', () => {
  /** `src/platform` altındaki tüm `.ts` dosyaları (testler hariç). */
  function collectPlatformSources(): { path: string; text: string }[] {
    const out: { path: string; text: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
        out.push({ path: full, text: readFileSync(full, 'utf8') });
      }
    };
    walk(join(SRC, 'platform'));
    return out;
  }

  const SOURCES = collectPlatformSources();
  const ALL_TEXT = SOURCES.map((f) => stripComments(f.text)).join('\n');

  /** Sözleşmeyi taşıyan setter adları — ELLE YAZILMAZ, kaynaktan türetilir. */
  const SETTERS = [...new Set(
    (ALL_TEXT.match(/export function (set\w*RemoteFlag)\s*\(/g) ?? [])
      .map((m) => (/export function (set\w*RemoteFlag)/.exec(m) as RegExpExecArray)[1]),
  )].sort();

  it('çapa: kaynak taraması GERÇEKTEN çalıştı (boş küme PASS veremez)', () => {
    expect(SOURCES.length, 'platform kaynakları okunamadı — kilit körleşti')
      .toBeGreaterThan(100);
    expect(SETTERS.length, 'hiç uzak bayrak setter\'ı bulunamadı — kilit körleşti')
      .toBeGreaterThanOrEqual(4);
  });

  it('HER setter\'ın üretim BESLEYİCİSİ vardır (hayalet bayrak yasağı)', () => {
    const ghosts: string[] = [];
    for (const setter of SETTERS) {
      // Besleyici deseni: `setX(getFlag(ANAHTAR) === true)` — kanonik tek yol.
      const fed = new RegExp(`${setter}\\(\\s*getFlag\\(`).test(ALL_TEXT);
      if (!fed) ghosts.push(setter);
    }
    expect(ghosts, `hayalet uzak bayrak: besleyicisi olmayan setter(lar) — ${ghosts.join(', ')}`)
      .toEqual([]);
  });

  it('HER setter\'ın SÖKÜM/RESET yolu vardır (zero-leak · fail-closed)', () => {
    const leaking: string[] = [];
    for (const setter of SETTERS) {
      if (!new RegExp(`${setter}\\(\\s*false\\s*\\)`).test(ALL_TEXT)) leaking.push(setter);
    }
    expect(leaking, `söküm yolunda kapatılmayan setter(lar) — ${leaking.join(', ')}`)
      .toEqual([]);
  });

  it('besleyici okuduğu anahtar SABİTTİR (satır içi dize YASAK)', () => {
    /* `getFlag('mavi_x')` biçimi anahtarı iki yerde kopyalar; sabit kullanmak
       LAB etiketi ile gerçek anahtarın ayrışmasını önler. */
    const inline = ALL_TEXT.match(/set\w*RemoteFlag\(\s*getFlag\(\s*['"]/g) ?? [];
    expect(inline, 'uzak bayrak anahtarı satır içi dize olarak yazılmış').toEqual([]);
  });

  it('bilinen dört Mavi bayrağı bu sözleşmeye DAHİLDİR (kapsam çapası)', () => {
    for (const expected of [
      'setMaviLatencyTraceRemoteFlag',            // F0
      'setMaviSemanticEndpointRemoteFlag',        // F3
      'setMaviStreamingResponseRemoteFlag',       // F4
      'setCapabilityFabricEnforceRemoteFlag',     // F5 — F13 final dar düzeltme
    ]) {
      expect(SETTERS, `${expected} sözleşmeden düşmüş — kilit kapsamı daraldı`)
        .toContain(expected);
    }
  });
});

describe('F13-GHOST · F5 zorlayıcı kip DAVRANIŞ sözleşmesi', () => {
  it('varsayılan GÖLGE: besleyici false verince hiçbir eylem engellenmez', async () => {
    const fabric = await import('../platform/capability/fabric/capabilityFabric');
    fabric._resetCapabilityFabricForTest();
    fabric.setCapabilityFabricEnforceRemoteFlag(false);
    expect(fabric.isCapabilityFabricEnforcing()).toBe(false);
  });

  it('filo şalteri AÇILIR ve KAPANIR (rollback tek şalter)', async () => {
    const fabric = await import('../platform/capability/fabric/capabilityFabric');
    fabric._resetCapabilityFabricForTest();
    fabric.setCapabilityFabricEnforceRemoteFlag(true);
    expect(fabric.isCapabilityFabricEnforcing()).toBe(true);
    fabric.setCapabilityFabricEnforceRemoteFlag(false);
    expect(fabric.isCapabilityFabricEnforcing(), 'rollback çalışmıyor').toBe(false);
    fabric._resetCapabilityFabricForTest();
  });

  it('LAB etiketi GERÇEK uzak anahtarla aynıdır (uydurma ad yok)', () => {
    const fabricSrc = stripComments(read('platform', 'capability', 'fabric', 'capabilityFabric.ts'));
    const labSrc    = stripComments(read('platform', 'devtools', 'maviConsoleSources.ts'));
    const key = /MAVI_F5_ENFORCE_REMOTE_FLAG = '([^']+)'/.exec(fabricSrc);
    expect(key, 'F5 uzak anahtar sabiti bulunamadı — kilit körleşti').toBeTruthy();
    expect(labSrc, `LAB, gerçek uzak anahtardan (${key![1]}) FARKLI bir ad bildiriyor`)
      .toContain(`'${key![1]}'`);
  });
});
