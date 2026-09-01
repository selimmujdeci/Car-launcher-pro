/**
 * maviCanonicalRuntime.guards.test.ts — **MAVI-F13 · TEK MAVİ RUNTIME KİLİTLERİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Denetim (2026-08-29) repoda ÜÇ Mavi hattı ölçtü: canlı `voiceService`,
 * SHADOW `maviCore`, bayraklı `ai/`. F13 bunları TEK kanonik runtime altında
 * birleştirir. Bu dosya birleşmenin **sessizce geri dönmesini** yasaklar.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 *  · Her kilit ÖNCE **çapasının var olduğunu** doğrular. Çapa kaybolursa kilit
 *    "0 eşleşme buldum, geçtim" demez — AÇIKÇA DÜŞER (kör guard yasağı).
 *  · Kaynak taramaları yorumları ATAR: bir mimari kararı ANLATAN yorum,
 *    o kararın İHLALİ sayılamaz.
 *  · Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası). Davranış
 *    bilinçli değişirse kilit YENİ DOĞRU DAVRANIŞA GÜNCELLENİR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(SRC, ...seg), 'utf8');

/** Yorumları çıkarır — kaynak kilitleri YALNIZ gerçek koda bakar. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const VOICE      = stripComments(read('platform', 'voiceService.ts'));
const EXECUTOR   = stripComments(read('platform', 'commandExecutor.ts'));
const HANDLER    = stripComments(read('hooks', 'useVoiceCommandHandler.ts'));
const ORCH_CHAT  = stripComments(read('platform', 'ai', 'orchestrator', 'concrete', 'maviOrchestratedChat.ts'));
const CHAT_PROV  = stripComments(read('platform', 'companion', 'companionChatProvider.ts'));
const WIRING     = stripComments(read('platform', 'system', 'platformCoreMaviVoiceWiring.ts'));
const MAVI_WIRE  = stripComments(read('platform', 'maviCore', 'wiring', 'maviWiring.ts'));
const PARSER     = stripComments(read('platform', 'commandParser.ts'));
const TOOL_ROUTER = stripComments(read('platform', 'ai', 'tools', 'concrete', 'maviToolRouter.ts'));
/** MAVI-F13/3 · bileşik plan MEKANİĞİ (kökten çıkarıldı, otorite DEĞİL). */
const PLAN_RT    = stripComments(read('platform', 'voice', 'maviCompoundPlanRuntime.ts'));

/** `src/` altındaki TÜM üretim dosyaları (testler hariç). */
function productionFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue;
      productionFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · TEK BİLEŞİK YÜRÜTÜCÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-1 · bileşik komutun TEK yürütücüsü vardır', () => {
  it('yerel ayrıştırıcı zinciri KANONİK plandan geçer (ayrı yürütme döngüsü YOK)', () => {
    const start = VOICE.indexOf('async function dispatchChain');
    const end   = VOICE.indexOf('async function tryHandleChain');
    expect(start, 'dispatchChain bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(end, 'tryHandleChain bulunamadı — kilit körleşti').toBeGreaterThan(start);
    const body = VOICE.slice(start, end);

    /* MAVI-F13/3'te YENİDEN BAĞLANDI (zayıflatma DEĞİL): plan MEKANİĞİ
       `voice/maviCompoundPlanRuntime`e taşındı; kök artık ona DELEGE eder.
       Kilit ARTIK İKİ ucu birden doğrular — kökün delegasyonu ve mekaniğin
       kanonik zinciri. Eskiden yalnız kökü tarıyordu ve mekanik başka bir
       dosyaya kopyalansa fark etmezdi. */
    expect(body).toMatch(/runMaviCompoundPlan[<(]/);
    // Gözlem yuvası KÖKTE kalır — "yaptım" iddiası oradan doğar.
    expect(body).toContain('takeLastCapabilityObservation()');
    // Kanonik plan zinciri mekaniğin İÇİNDE eksiksiz olmalı.
    expect(PLAN_RT).toContain('buildCapabilityPlan(');
    expect(PLAN_RT).toContain('runCapabilityPlan(');
    expect(PLAN_RT).toContain('renderPlanOutcome(');
  });

  it('beyin yolu ve ayrıştırıcı yolu AYNI plan mekaniğini kullanır', () => {
    // İki çağıran da tek mekaniğe bağlı → ikinci bileşik motor yok.
    const callers = VOICE.match(/runMaviCompoundPlan[<(]/g) ?? [];
    expect(callers.length, 'plan mekaniği çağrısı bulunamadı — kilit körleşti')
      .toBeGreaterThanOrEqual(2);
    /* MAVI-F13/3 GÜÇLENDİRMESİ: kanonik `runCapabilityPlan` çağrısı ÜRETİMDE
       tam BİR yerde olmalı — mekaniğin kendisinde. İkinci bir çağıran belirirse
       (kökte ya da başka bir modülde) ikinci bileşik motor doğmuş demektir. */
    const prodCallers = productionFiles(SRC).filter((f) => {
      const rel = f.split(sep).join('/');
      if (rel.includes('/capability/fabric/')) return false;   // katmanın kendisi
      return /runCapabilityPlan\(/.test(stripComments(readFileSync(f, 'utf8')));
    });
    expect(prodCallers.map((f) => f.split(sep).join('/').replace(/^.*\/src\//, 'src/')))
      .toEqual(['src/platform/voice/maviCompoundPlanRuntime.ts']);
    // Ve `voiceService` başka bir bileşik yürütücü İMPORT ETMEZ.
    expect(VOICE).not.toContain('executeSequence');
  });

  it('ÜÇÜNCÜ bileşik yürütücü (`executeSequence`) üretim kodunda YOKTUR', () => {
    // Çapa: yürütücünün kendisi hâlâ duruyor (dosyayı yanlış okumuyoruz).
    expect(EXECUTOR).toContain('export async function executeIntent');
    expect(EXECUTOR).not.toContain('export async function executeSequence');
    // Paralel `Promise.all(... dispatchIntent ...)` deseni geri gelemez.
    expect(EXECUTOR).not.toMatch(/Promise\.all\([^)]*dispatchIntent/);
  });

  it('zincir metni YÜRÜTMEDEN ÖNCE seslendirilmez (sahte ön-ACK yasağı)', () => {
    const start = VOICE.indexOf('async function dispatchChain');
    const end   = VOICE.indexOf('async function tryHandleChain');
    const body  = VOICE.slice(start, end);
    const speakIdx = body.indexOf('speakMaviAnswerChunk(');
    const runIdx   = body.search(/runMaviCompoundPlan[<(]/);
    expect(speakIdx, 'zincirde cevap çağrısı bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(runIdx, 'plan mekaniği çağrısı bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    // Konuşma YÜRÜTMEDEN SONRA gelir.
    expect(speakIdx).toBeGreaterThan(runIdx);
    /* MAVI-F13/3: mekanik KONUŞAMAZ — cümleyi yalnız DÖNER, söyleyen köktür. */
    expect(PLAN_RT, 'plan mekaniği konuşma otoritesine dokundu')
      .not.toMatch(/speakMaviAnswer|maviSpeech/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · TEK KONUŞMA OTORİTESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-2 · Mavi cevapları TEK konuşma otoritesinden geçer', () => {
  const MAVI_FILES: readonly (readonly [string, string])[] = [
    ['voiceService', VOICE],
    ['commandExecutor', EXECUTOR],
    ['useVoiceCommandHandler', HANDLER],
    ['companionChatProvider', CHAT_PROV],
  ];

  it('Mavi yolunda doğrudan TTS çağrısı YOKTUR', () => {
    for (const [name, src] of MAVI_FILES) {
      // Çapa: dosya gerçekten Mavi cevabı üreten hatta ait.
      expect(src.length, `${name} okunamadı — kilit körleşti`).toBeGreaterThan(500);
      expect(src, `${name}: doğrudan ttsSpeak çağrısı`).not.toMatch(/\bttsSpeak\s*\(/);
      expect(src, `${name}: doğrudan speakNow çağrısı`).not.toMatch(/\bspeakNow\s*\(/);
    }
  });

  /* MAVI-F13/3: proaktif uyarı `companionChatProvider`dan AYRI bir alt sisteme
     taşındı. Taşımadan önce F13-2 kapsamındaydı; kapsamı KAYBETMEMESİ için
     kilit yeni dosyaya GENİŞLETİLDİ. Sözleşme: tek çıkış `opts.onSpeak`
     PORTUDUR — modül konuşma otoritesini KENDİ çağıramaz. */
  it('proaktif uyarı alt sistemi konuşma otoritesini ÇAĞIRAMAZ (yalnız onSpeak portu)', () => {
    const PROACTIVE = stripComments(
      read('platform', 'companion', 'companionProactiveAlert.ts'));
    // Çapa: doğru dosyaya bakıyoruz ve port gerçekten orada.
    expect(PROACTIVE).toContain('export function triggerProactiveDiagnosticAlert');
    expect(PROACTIVE).toContain('opts.onSpeak');
    for (const forbidden of [
      'speakMaviAnswer', 'maviSpeech', 'ttsService', 'ttsSpeak', 'speakAlert',
      'maviTurn', 'beginMaviTurn', 'commandExecutor', 'dispatchIntent',
    ]) {
      expect(PROACTIVE, `proaktif alt sistem otoriteye dokundu: ${forbidden}`)
        .not.toContain(forbidden);
    }
  });

  it('konuşma otoritesinin kendisi TEK giriş noktasını dışa verir', () => {
    const SPEECH = stripComments(read('platform', 'assistant', 'maviSpeech.ts'));
    expect(SPEECH).toContain('export function speakMaviAnswer(');
    expect(SPEECH).toContain('export function speakMaviAnswerChunk(');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · TEK HAFIZA / BAĞLAM İZDÜŞÜMÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-3 · prompt’a İKİNCİ hafıza/bağlam bloğu enjekte edilmez', () => {
  it('orkestratör kanonik izdüşüm varken kendi bloğunu EKLEMEZ', () => {
    // Çapa: iki enjeksiyon fonksiyonu hâlâ var (kilit doğru dosyaya bakıyor).
    expect(ORCH_CHAT).toContain('function withMemory(');
    expect(ORCH_CHAT).toContain('function withVehicleContext(');
    // Kapı: her ikisi de `canonicalUpstream` ile erken döner.
    expect(ORCH_CHAT).toMatch(/if \(canonicalUpstream\)[^\n]*record\('canonical_upstream'\)[^\n]*return system;/);
    const gates = ORCH_CHAT.match(/if \(canonicalUpstream\)/g) ?? [];
    expect(gates.length, 'iki enjeksiyonun ikisinde de kapı olmalı').toBe(2);
  });

  it('kanonik kapı, şalter/izin kapılarından ÖNCE gelir', () => {
    // Aksi hâlde "şalter açık + izin var" durumunda çift enjeksiyon geri gelirdi.
    for (const fn of ['function withVehicleContext(', 'function withMemory(']) {
      const i = ORCH_CHAT.indexOf(fn);
      expect(i, `${fn} bulunamadı — kilit körleşti`).toBeGreaterThan(-1);
      const body = ORCH_CHAT.slice(i, i + 2500);
      const canonical = body.indexOf('if (canonicalUpstream)');
      const enabled   = body.indexOf("record('disabled')");
      expect(canonical).toBeGreaterThan(-1);
      expect(enabled).toBeGreaterThan(-1);
      expect(canonical, `${fn}: kanonik kapı şalterden sonra`).toBeLessThan(enabled);
    }
  });

  it('canlı sohbet sağlayıcısı kanonik izdüşümü BEYAN eder', () => {
    expect(CHAT_PROV).toContain('askOrchestratedChat(');
    expect(CHAT_PROV).toContain('systemCarriesCanonicalProjection: true');
  });

  it('kanonik uzun-vadeli hafızanın TEK cephesi vardır', () => {
    const MEM_SRC = stripComments(
      read('platform', 'ai', 'memory', 'concrete', 'maviMemorySources.ts'),
    );
    // F10 kararı: açık tercihler YALNIZ kanonik cepheden okunur.
    expect(MEM_SRC).toContain("from '../../../assistant/maviMemory'");
    expect(MEM_SRC).not.toMatch(/companionMemory[^\n]*getFacts/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · GÖLGE RUNTIME ÜRETİMDE YÜRÜTME OTORİTESİ DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-4 · `maviCore` gölge hattı üretimde yürütme yetkisi ALMAZ', () => {
  it('varsayılan mod SHADOW’dur ve takeover bayrağı fail-safe kapalıdır', () => {
    expect(MAVI_WIRE).toMatch(/deps\.mode === 'takeover' \? 'takeover' : 'shadow'/);
    // Bayrak okuması: bilinmeyen/bozuk her değer KAPALI demektir.
    expect(WIRING).toContain("export const MAVI_TAKEOVER_FLAG = 'mavi.mediaNextTakeover.enabled'");
    expect(WIRING).toMatch(/function readTakeoverFlag\(\)[\s\S]{0,700}return false;/);
    expect(WIRING).toMatch(/getItem\(MAVI_TAKEOVER_FLAG\) === 'true'/);
  });

  it('gölge hattaki bir eylem GERÇEK handler almadan plan çalıştıramaz', () => {
    // Sahiplik alınamayan turda gerçek servis çağrılamaz (çifte yürütme yasağı).
    expect(MAVI_WIRE).toMatch(/isRealHandler:\s*\(actionId\)\s*=>/);
    expect(MAVI_WIRE).toContain("handlerKindFor(actionId, policy) === 'real'");
  });

  it('eski hat, Mavi’nin sahiplendiği komutu YÜRÜTMEZ (tek sahiplik kararı)', () => {
    expect(HANDLER).toContain('isCommandOwnedByMavi(cmd)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · AYRIŞTIRICI VE LLM YÜRÜTME OTORİTESİ DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-5 · öneri üreticileri doğrudan alt sisteme dokunamaz', () => {
  it('yerel ayrıştırıcı hiçbir yürütücüyü/servisi import ETMEZ', () => {
    // Çapa: ayrıştırıcı gerçekten komut üretiyor.
    expect(PARSER).toMatch(/export function parseCommandFull/);
    for (const forbidden of [
      "from './commandExecutor'", "from './intentEngine'", "from './navigationService'",
      "from './mediaService'", "from './ttsService'", "from './obdService'",
    ]) {
      expect(PARSER, `commandParser yürütücü import etti: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('LLM araç yönlendiricisi araç-etkili yürütücüye doğrudan bağlanmaz', () => {
    expect(TOOL_ROUTER.length, 'maviToolRouter okunamadı — kilit körleşti').toBeGreaterThan(200);
    for (const forbidden of ['commandExecutor', 'dispatchIntent', 'executeIntent']) {
      expect(TOOL_ROUTER, `maviToolRouter doğrudan yürütücüye bağlandı: ${forbidden}`)
        .not.toContain(forbidden);
    }
  });

  it('zincir önerileri capability kapısından geçer (yetki ayrıştırıcıdan doğmaz)', () => {
    const start = VOICE.indexOf('async function dispatchChain');
    const end   = VOICE.indexOf('async function tryHandleChain');
    const body  = VOICE.slice(start, end);
    expect(body).toContain('evaluateLegacyIntent(');
    // Köken TİP DÜZEYİNDE taşınır: LLM önerisi gibi gösterilemez.
    expect(body).toContain("'local_parser'");
  });

  it('plan katmanı ÜÇÜNCÜ bir onay politikası KURMAZ', () => {
    /* Onay yetkisi iki kanonik otoritededir: SIRA düzeyinde
       `classifySequenceConfirmationPolicy` (P1), EYLEM düzeyinde
       `maviActionAuthority` → `needs_confirmation` → bekleyen eylem.
       Plan adımını `requiresConfirmation` işaretlemek adımı hiç dağıtmaz ve
       kanonik onay sorusunu SUSTURUR (regresyon kilidi #15 bunu yakalamıştı). */
    const start = VOICE.indexOf('async function dispatchChain');
    const end   = VOICE.indexOf('async function tryHandleChain');
    const body  = VOICE.slice(start, end);
    const assigns = body.match(/requiresConfirmation:\s*[^,\n]+/g) ?? [];
    expect(assigns.length, 'onay alanı bulunamadı — kilit körleşti').toBe(1);
    expect(assigns[0].replace(/\s+/g, ' ')).toBe('requiresConfirmation: false');

    // P1 SIRA kapısı, plan çalışmadan ÖNCE koşar (fail-closed sıra).
    const tryStart = VOICE.indexOf('async function tryHandleChain');
    const tryBody  = VOICE.slice(tryStart, tryStart + 4000);
    const p1  = tryBody.indexOf('classifySequenceConfirmationPolicy(');
    const run = tryBody.indexOf('await dispatchChain(');
    expect(p1, 'P1 sıra kapısı bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(run, 'zincir çağrısı bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(p1).toBeLessThan(run);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5b · DEPRECATE EDİLEN GÖLGE MODÜLLER ÜRETİME GERİ SIZAMAZ
 *
 * Bu dört modülün ÜRETİMDE HİÇBİR tüketicisi yoktur (2026-08-29 statik tarama);
 * yalnız kendi testleri onları tutar. **SİLİNMEDİLER** — spec §28.2 `maviCore`ı
 * MCX L0/L4/L7'ye taşımayı öngörüyor ve test kapsamını yok etmek F13'ün işi
 * değil. Ama gölge hattın üretime SESSİZCE geri bağlanması yasaktır: yeni bir
 * üretim importu bu kilidi düşürür ve karar bilinçli olarak verilir.
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-5b · gölge-only `maviCore` modüllerinin üretim tüketicisi YOKTUR', () => {
  const DEPRECATED = [
    'maviCore/intentResolver',
    'maviCore/navActions',
    'maviCore/appSafeActions',
    'maviCore/discoveryActions',
  ] as const;

  it('tarama gerçekten çalışıyor (kilit körlüğü kontrolü)', () => {
    const files = productionFiles(SRC);
    expect(files.length, 'üretim dosyası bulunamadı — kilit körleşti').toBeGreaterThan(300);
    // Pozitif kontrol: CANLI bir modülün üretim tüketicisi GERÇEKTEN bulunuyor.
    const live = files.filter((f) => readFileSync(f, 'utf8').includes('maviCore/wiring/maviEvidence'));
    expect(live.length, 'canlı modül taramada görünmedi — tarama bozuk').toBeGreaterThan(0);
  });

  it('deprecate edilen modüllerin üretim importu YOKTUR', () => {
    const files = productionFiles(SRC);
    for (const mod of DEPRECATED) {
      const short = mod.split('/')[1];
      const hits = files.filter((f) => {
        // Modülün KENDİSİ ve maviCore içi komşuları sayılmaz (ada içi bağlar).
        if (f.split(sep).join('/').includes('/platform/maviCore/')) return false;
        const src = stripComments(readFileSync(f, 'utf8'));
        return src.includes(mod) || new RegExp(`from '[^']*/${short}'`).test(src);
      });
      expect(hits, `${mod}: üretim tüketicisi belirdi — F13 kararı bilinçli değişmeli`)
        .toEqual([]);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · LAB İKİNCİ OTORİTE DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13-6 · LAB kanonik runtime bölümü hüküm ÜRETMEZ', () => {
  const MODEL = stripComments(read('platform', 'devtools', 'maviConsoleModel.ts'));

  it('K bölümü defteri OKUR, karar VERMEZ', () => {
    expect(MODEL).toContain("'canonical-runtime'");
    const i = MODEL.indexOf('function _canonicalRuntimeSection');
    expect(i, 'K bölümü bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    const body = MODEL.slice(i, MODEL.indexOf('export function buildMaviSections'));
    // LAB komut göndermez, yürütmez, bayrak çevirmez.
    for (const forbidden of [
      'dispatchIntent', 'executeIntent', 'startListening', 'ttsCancel',
      'beginMaviTurn', 'setAiGatewayEnabled', 'setMaviOrchestratorEnabled',
    ]) {
      expect(body, `LAB K bölümü aktif çağrı içeriyor: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('defter okunamıyorken hiçbir şey İDDİA EDİLMEZ', () => {
    const i = MODEL.indexOf('function _canonicalRuntimeSection');
    const body = MODEL.slice(i, MODEL.indexOf('export function buildMaviSections'));
    const guard = body.indexOf('if (!r) {');
    const claim = body.indexOf("id: 'rtPath'");
    expect(guard, 'null kapısı bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    // Mimari beyanı bile null kapısından SONRA gelir.
    expect(guard).toBeLessThan(claim);
  });

  it('bounded sayaç uyarısı gizlenmez (0 = hiç olmadı çıkarımı yasak)', () => {
    const EVID = stripComments(read('platform', 'maviCore', 'wiring', 'maviEvidence.ts'));
    expect(EVID).toContain('export function getMaviRuntimeConsolidationDiagnostics');
    expect(EVID).toMatch(/bounded:\s*_decisions\.length >= MAX_DECISIONS/);
    const i = MODEL.indexOf('function _canonicalRuntimeSection');
    const body = MODEL.slice(i, MODEL.indexOf('export function buildMaviSections'));
    expect(body).toContain('r.bounded');
  });
});
