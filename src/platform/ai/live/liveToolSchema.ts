/**
 * liveToolSchema — Gemini Live function-calling sözleşmesi ↔ mevcut beyin JSON'u.
 *
 * REST beyni kararını JSON zarfında verir (`{"type":"action"|"chat"|"web"}`) ve
 * `companionBrainParser.parseBrainJson` bunu doğrular. Live'da çıktı SES olduğu
 * için karar function call olarak gelir. Bu modül İKİNCİ bir ayrıştırıcı
 * KURMAZ: tool argümanlarını AYNI JSON zarfına çevirir; doğrulama, intent
 * allowlist'i, çoklu-plan tavanı ve feedback filtresi `parseBrainJson`da kalır.
 *
 * Yetki ZİNCİRİ DEĞİŞMEZ: buradan çıkan `BrainRaw` → `fromSemanticResult` →
 * capability kapısı → `dispatch` → `maviActionAuthority` → AiSafetyGate → onay.
 * Sağlayıcı araç donanımına DOĞRUDAN dokunamaz.
 */

import { brainIntentAllowlist } from '../../capability/fabric/carosCapabilityCatalog';
import type { LiveToolCall } from './geminiLiveSession';

export const LIVE_TOOL_ACTION = 'mavi_action';
export const LIVE_TOOL_WEB    = 'mavi_web_search';
/**
 * "Eylem istendi ama eşleyemedim" beyanı — modelin KONUŞMADAN çıkış yolu.
 * Regression fix (2026-09-21): eskiden model bunu sesle ("yapamıyorum") söylüyor,
 * ses çalındığı için tur "çözüldü" sayılıyor ve REST/yerel kurtarma hiç
 * denenmiyordu. Bu araç bir EYLEM ÜRETMEZ; yalnız turun çözülmediğini
 * yaşam döngüsüne bildirir (`liveTurnResolution` → UNRESOLVED → fallback).
 */
export const LIVE_TOOL_UNRESOLVED = 'mavi_unresolved';

const ACTION_FIELDS: Readonly<Record<string, { type: string; description: string }>> = Object.freeze({
  query:         { type: 'STRING', description: 'Arama/müzik sorgusu (DÜZELTİLMİŞ sanatçı/şarkı/mekân adı).' },
  destination:   { type: 'STRING', description: 'Gidilecek adres/yer (NAVIGATE_ADDRESS) veya "home"/"work".' },
  category:      { type: 'STRING', description: 'POI kategorisi (RESTAURANT, GAS, PARKING …).' },
  settingKey:    { type: 'STRING', description: 'SET_SETTING anahtarı (brightness|wifi|bluetooth|volume|…).' },
  settingKind:   { type: 'STRING', description: 'number|bool' },
  settingAction: { type: 'STRING', description: 'inc|dec|on|off|toggle|set' },
  settingValue:  { type: 'STRING', description: 'Opsiyonel değer (yüzde/enum).' },
  appName:       { type: 'STRING', description: 'OPEN_APP için YALNIZ uygulama adı.' },
  screen:        { type: 'STRING', description: 'OPEN_SCREEN için YALNIZ ekran adı.' },
  screenAction:  { type: 'STRING', description: 'open|close' },
  contactName:   { type: 'STRING', description: 'OPEN_PHONE için YALNIZ kişi adı.' },
  memoryText:    { type: 'STRING', description: 'REMEMBER/FORGET için kısa fact.' },
  sensorQuery:   { type: 'STRING', description: 'QUERY_SENSOR için sensör adı (soru eki yok).' },
  feedback:      { type: 'STRING', description: 'Kısa Türkçe onay (≤8 kelime). Bittiğini İDDİA ETME.' },
  confidence:    { type: 'NUMBER', description: '0.0-1.0' },
});

function actionProperties(intents: readonly string[]): Record<string, unknown> {
  return {
    intent: { type: 'STRING', enum: [...intents], description: 'Araç komutu niyeti (yalnız listedekiler).' },
    ...ACTION_FIELDS,
  };
}

/**
 * `tools[0].functionDeclarations` — setup'ta BİR KEZ gönderilir. Intent enum'u
 * katalogdan türetilir (REST prompt'uyla AYNI kaynak: `brainIntentAllowlist`).
 */
export function buildLiveFunctionDeclarations(): readonly unknown[] {
  const intents = brainIntentAllowlist();
  const props = actionProperties(intents);
  return Object.freeze([
    {
      name: LIVE_TOOL_ACTION,
      description:
        'Kullanıcı bir ARAÇ/UYGULAMA KOMUTU istediğinde çağır (navigasyon, müzik, telefon, ayar, ekran, hafıza, sensör). '
        + 'Birden fazla AYRI iş varsa `actions` dizisini kullan (en fazla 5). Bu aracı çağırdığın turda KONUŞMA; '
        + 'onayı sistem verir. Listede karşılığı olmayan ya da emin olmadığın eylem için bu aracı ÇAĞIRMA; `mavi_unresolved` çağır.',
      parameters: {
        type: 'OBJECT',
        properties: {
          ...props,
          actions: {
            type: 'ARRAY',
            description: 'Yalnız gerçekten AYRI işler için; tek iş varsa kullanma.',
            items: { type: 'OBJECT', properties: props },
          },
        },
      },
    },
    {
      name: LIVE_TOOL_WEB,
      description:
        'GÜNCEL/gerçek-zamanlı bilgi gerektiğinde çağır (haber, döviz, hava tahmini, maç, "X kaç para", açılış saati). '
        + 'Bu aracı çağırdığın turda KONUŞMA; sistem aramayı yapıp cevabı seslendirir. Zamansız bilgi için çağırma.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Aranacak güncel bilgi (Türkçe, net).' } },
        required: ['query'],
      },
    },
    {
      name: LIVE_TOOL_UNRESOLVED,
      description:
        'Kullanıcı bir ARAÇ/UYGULAMA EYLEMİ istedi ama `mavi_action` intent listesinde GERÇEK karşılığı yok ya da hangi intent '
        + 'olduğundan emin değilsin → bu aracı çağır ve KONUŞMA. Sistem isteği başka yolla dener ya da dürüstçe cevap verir. '
        + 'Sohbet/bilgi sorusu için ÇAĞIRMA (onlara doğrudan konuşarak cevap ver).',
      parameters: {
        type: 'OBJECT',
        properties: { note: { type: 'STRING', description: 'Kısa sebep (opsiyonel).' } },
      },
    },
  ]);
}

/**
 * Tool çağrısını REST beyninin JSON zarfına çevirir (metin). Bilinmeyen tool
 * → `null`. Doğrulama `parseBrainJson`da: geçersiz intent/alan burada
 * "geçerli" sayılmaz, yalnız TAŞINIR.
 */
export function liveToolCallToBrainJson(call: LiveToolCall): string | null {
  if (call.name === LIVE_TOOL_ACTION) {
    return JSON.stringify({ type: 'action', ...call.args });
  }
  if (call.name === LIVE_TOOL_WEB) {
    const q = call.args.query;
    if (typeof q !== 'string' || !q.trim()) return null;
    return JSON.stringify({ type: 'web', query: q });
  }
  return null;
}

/** Live oturumu için REST beyin prompt'una eklenen tool-disiplini satırları. */
export const LIVE_TOOL_INSTRUCTION_LINES: readonly string[] = Object.freeze([
  'KARAR MEKANİZMAN ARAÇLARDIR: bir ARAÇ KOMUTU istendiğinde `mavi_action` aracını çağır; GÜNCEL bilgi gerektiğinde `mavi_web_search` aracını çağır; eylem istendi ama eşleyemiyorsan `mavi_unresolved` aracını çağır. Aracı çağırdığın turda SESLİ CEVAP VERME — onayı ve sonucu sistem seslendirir.',
  'SOHBET ise (bilgi, tavsiye, fıkra, duygu, genel konuşma) araç çağırmadan doğrudan KONUŞ. Kısa ve doğal; liste/madde/emoji yok.',
  'ARAÇ GERÇEĞİ: konuşmak yapmak DEĞİLDİR. Bir eylemi "yaptım/açıyorum/hallettim" diye SESLE onaylama; eylem yalnız `mavi_action` çağrısıyla olur. Yapamıyorsan bunu sesle söyleme, `mavi_unresolved` çağır.',
]);
