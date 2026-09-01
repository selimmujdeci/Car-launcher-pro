/**
 * companionBrainParser.ts — **MAVI-F13/4 · BEYİN ÇIKTISI AYRIŞTIRMA (SAF).**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * `companionChatProvider` bir DEEP sağlayıcıdır: sağlayıcı seçer, prompt kurar,
 * modeli çağırır. Ama modelin DÖNDÜĞÜ JSON'u okuyup kanonik `SemanticResult`e
 * çevirmek **sağlayıcıya özgü değildir**: aynı ayrıştırıcı Gemini · Groq ·
 * Haiku · gateway çıktısının DÖRDÜNDE de birebir çalışır (dört çağrı yeri de
 * aynı fonksiyonu paylaşıyordu). Bu yüzden ayrıştırma tek ve SAF bir sınıra alındı.
 *
 * ── SÖZLEŞME (PAZARLIKSIZ) — BU MODÜL OTORİTE DEĞİLDİR ──────────────────────
 *  · **SAF.** Modül seviyesinde mutable durum YOK · timer YOK · I/O YOK ·
 *    `fetch` YOK · `Date.now` YOK · `Math.random` YOK. Aynı girdi → aynı çıktı.
 *  · **AĞA ÇIKMAZ, SAĞLAYICI BİLMEZ.** Hangi modelin konuştuğunu bilmez;
 *    yalnız METİN alır, yapı döner.
 *  · **KONUŞMAZ · TUR AÇMAZ · YÜRÜTMEZ.** `maviSpeech` · `maviTurn` ·
 *    `commandExecutor` · `intentEngine` · `capabilityFabric` ·
 *    `maviActionAuthority` bilmez. Ürettiği `SemanticResult` bir **ÖNERİDİR**;
 *    kapı, onay ve yürütme kanonik zincirdedir.
 *  · **KATALOG TEK KAYNAK.** İzinli intent kümesi `carosCapabilityCatalog`tan
 *    gelir — elle liste YASAK (F5'te kapatılan "üç ayrı liste" kusuru).
 *  · **FAIL-CLOSED.** Bozuk JSON · tanınmayan intent · geçersiz adım → `null`
 *    ya da sessiz eleme; uydurma yapı ÜRETİLMEZ.
 *  · **DAVRANIŞ DEĞİŞMEDİ.** Alan çıkarımı, tavanlar, filler kapısı ve rota
 *    ataması `companionChatProvider`dan **birebir** taşındı.
 *
 * ── TEK GERİ BAĞ: `import type` ─────────────────────────────────────────────
 * `CompanionChatRoute` sağlayıcının genel yüzeyine aittir ve buraya YALNIZ
 * `import type` ile girer → derlemede silinir, **çalışma zamanı kenarı YOKTUR**
 * (döngü oluşmaz). Kilit bunu tarar: bu dosyada sağlayıcıya giden bir DEĞER
 * import'u bulunması bir ihlaldir.
 */

import type { SemanticResult } from '../ai/semanticAiService';
import type { CompanionChatRoute } from './companionChatProvider';
// MAVI-F5: beyin intent listesinin TEK KAYNAĞI (elle liste YASAK).
import { brainIntentAllowlist } from '../capability/fabric/carosCapabilityCatalog';
/* MAVI-F2 · I11: modelin ürettiği `feedback` de bir konuşma kaynağıdır — prompt
 * kuralı ihlal edilirse filler PARSE SINIRINDA süzülür. Saf, yaprak modül. */
import { isGenericFiller } from '../assistant/maviAckPolicy';
/* Dikkat bütçesi politikası (SAF): sürüş/park karakter tavanı. */
import { trimForSpeech } from './companionAnswerShaping';

const BRAIN_INTENTS = new Set<string>(brainIntentAllowlist());

/* ══════════════════════════════════════════════════════════════════════════
 * SONUÇ SÖZLEŞMESİ
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionBrainAction {
  kind:     'action';
  semantic: SemanticResult; // fromSemanticResult ile AppIntent'e dönüşür
  /**
   * MAVI-F6: BİLEŞİK komut adımları. Tek cümlede birden fazla iş varsa beyin
   * `actions:[...]` döner ve burada SIRAYLA taşınır.
   *
   * **GERİYE UYUMLU:** tek işli cevaplarda dizi tek elemanlıdır ve `semantic`
   * her zaman ilk adımdır → mevcut tüketiciler DEĞİŞMEDEN çalışır. Bileşik
   * yürütme kararı `voiceService`e aittir; bu katman yalnız TAŞIR.
   */
  semantics: readonly SemanticResult[];
}

export interface CompanionBrainChat {
  kind:     'chat';
  response: string;
  route:    CompanionChatRoute;
}

export type CompanionBrainResult = CompanionBrainAction | CompanionBrainChat;

/**
 * Beynin "internet/grounding" kararı — DIŞA AÇIK DEĞİL. `tryCompanionBrain`
 * bunu ikinci grounded çağrıyla (Google Search) gerçek bir cevaba
 * (`CompanionBrainChat`) çözer; `voiceService` yalnız chat/action görür.
 * `query` = aranacak güncel bilgi.
 */
export interface CompanionBrainWeb {
  kind:  'web';
  query: string;
}

export type BrainRaw = CompanionBrainResult | CompanionBrainWeb;

/** Bileşik plan adım tavanı — bozuk model çıktısı sınırsız iş üretemez. */
export const MAX_PLAN_ITEMS = 5;

/** Modelin döndüğü ham JSON'un beklenen alanları (hepsi opsiyonel — fail-closed). */
export interface BrainJson {
  type?:        string;
  intent?:      string;
  query?:       string;
  destination?: string;
  category?:    string;
  settingKey?:    string;
  settingKind?:   string;
  settingAction?: string;
  settingValue?:  string;
  appName?:     string;
  screen?:      string;
  screenAction?: string;
  contactName?: string;
  memoryText?:  string;
  sensorQuery?: string;
  feedback?:    string;
  confidence?:  number;
  say?:         string;
  /** MAVI-F6: bileşik komut adımları (her biri kendi `intent` + alanlarını taşır). */
  actions?:     BrainJson[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * AYRIŞTIRMA
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * MAVI-F6: TEK bir beyin eylem nesnesini `SemanticResult`e çevirir.
 *
 * Tekil ve bileşik yol BU fonksiyonu paylaşır — alan çıkarımı iki yerde
 * kopyalanmaz (F5'te kapatılan "üç ayrı liste" kusurunun tekrarı yasak).
 */
export function semanticFromBrainAction(obj: BrainJson): SemanticResult | null {
  try {
    if (!obj || typeof obj.intent !== 'string' || !BRAIN_INTENTS.has(obj.intent)) return null;
    return {
      intent:      obj.intent as SemanticResult['intent'],
      category:    obj.category as SemanticResult['category'],
      query:       typeof obj.query === 'string' ? obj.query : undefined,
      destination: typeof obj.destination === 'string' ? obj.destination : undefined,
      // SET_SETTING alanları — beyin parlaklık/wifi/bluetooth/ses ayarını taşır.
      settingKey:    typeof obj.settingKey === 'string' ? obj.settingKey : undefined,
      settingKind:   typeof obj.settingKind === 'string' ? obj.settingKind : undefined,
      settingAction: typeof obj.settingAction === 'string' ? obj.settingAction : undefined,
      settingValue:  typeof obj.settingValue === 'string' ? obj.settingValue : undefined,
      // OPEN_APP — açılacak uygulamanın serbest adı ("kamera", "radyo", "whatsapp").
      appName:     typeof obj.appName === 'string' ? obj.appName : undefined,
      // OPEN_SCREEN — iç ekran adı + eylem ("trafik" / "gemini qr", open|close).
      screen:      typeof obj.screen === 'string' ? obj.screen : undefined,
      screenAction: typeof obj.screenAction === 'string' ? obj.screenAction : undefined,
      // OPEN_PHONE — aranacak kişi adı ("Selim", "annem"); rehberde aranır.
      contactName: typeof obj.contactName === 'string' ? obj.contactName : undefined,
      // REMEMBER/FORGET — kalıcı kişisel fact metni (companionMemory).
      memoryText:  typeof obj.memoryText === 'string' ? obj.memoryText : undefined,
      // QUERY_SENSOR — sorulan sensörün adı (DEĞER YOK — şemada bilinçli eksik).
      sensorQuery: typeof obj.sensorQuery === 'string' ? obj.sensorQuery : undefined,
      /* MAVI-F2 · I11: model prompt'a rağmen içeriksiz bir bekletme cümlesi
       * ("Bakıyorum") üretirse o metin ONAY OLARAK KULLANILMAZ — deterministik
       * varsayılana düşer. Kapı PARSE SINIRINDADIR: filler o andan itibaren
       * ne seslendirilir, ne geçmişe yazılır, ne kısa süreli hafızaya girer. */
      feedback:    typeof obj.feedback === 'string' && obj.feedback && !isGenericFiller(obj.feedback)
        ? obj.feedback
        : 'Yapılıyor',
      confidence:  typeof obj.confidence === 'number' ? obj.confidence : 0.85,
      source:      'direct_ai',
    };
  } catch { return null; }
}

/**
 * Model çıktısını bounded karar yapısına çevirir. Tanınmayan/bozuk her hâl
 * `null` döner → çağıran eski yola düşer (uydurma karar ÜRETİLMEZ).
 *
 * @param isDriving Seslendirme karakter tavanını belirler (sürüş 300 / park 2400).
 *   SAHA 2026-07-24: sabit 300 tavanı park halinde de uygulanıyordu → 970-1058
 *   karakterlik TAM cevaplar üçte birine kırpılıp "..." ile bitiyordu.
 */
export function parseBrainJson(raw: string, isDriving = false): BrainRaw | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned) as BrainJson;
    if (obj.type === 'web' && typeof obj.query === 'string' && obj.query.trim()) {
      return { kind: 'web', query: obj.query.replace(/\s+/g, ' ').trim().slice(0, 200) };
    }
    if (obj.type === 'chat' && typeof obj.say === 'string' && obj.say.trim()) {
      return { kind: 'chat', response: trimForSpeech(obj.say, isDriving), route: 'companion_gemini' };
    }
    /* MAVI-F6 · BİLEŞİK KOMUT. `actions` dizisi varsa her eleman AYNI tek-adım
     * çıkarıcısından geçer → ikinci bir ayrıştırma sözleşmesi doğmaz. Geçersiz
     * eleman SESSİZCE atılır (fail-closed); geçerli adım kalmazsa `null` döner
     * ve akış eski yola düşer. Tavan BOUNDED (`MAX_PLAN_ITEMS`): bozuk bir model
     * çıktısı sınırsız adım üretemez. */
    if (obj.type === 'action' && Array.isArray(obj.actions) && obj.actions.length > 0) {
      const list: SemanticResult[] = [];
      for (const step of obj.actions.slice(0, MAX_PLAN_ITEMS)) {
        const one = semanticFromBrainAction(step);
        if (one) list.push(one);
      }
      if (list.length > 0) {
        return { kind: 'action', semantic: list[0], semantics: Object.freeze(list) };
      }
      return null;
    }
    if (obj.type === 'action' && typeof obj.intent === 'string' && BRAIN_INTENTS.has(obj.intent)) {
      const single = semanticFromBrainAction(obj);
      if (!single) return null;
      return { kind: 'action', semantic: single, semantics: Object.freeze([single]) };
    }
    return null;
  } catch { return null; }
}
