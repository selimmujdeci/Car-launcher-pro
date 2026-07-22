/**
 * aiGatewayFlag — Mavi'nin AI Gateway hattı için TEK anahtar (rollback şalteri).
 *
 * VARSAYILAN: KAPALI. Kapalıyken mevcut sağlayıcı zinciri (Gemini → Groq →
 * Haiku) BİREBİR eskisi gibi çalışır — tek satır davranış değişmez. Açıkken
 * zincirin BAŞINA gateway adayı eklenir; kalan zincir yedek olarak DURUR
 * (kaldırılmaz) → her an geri dönülebilir.
 *
 * İki kaynak (MAVI3 takeover deseniyle aynı):
 *   1) Uzak bayrak `mavi_ai_gateway` (remoteConfigService; bilinmeyen anahtar → false)
 *   2) Yerel geliştirme kaldıracı `localStorage['mavi.aiGateway.enabled']`
 *      — YALNIZ tam `"true"` açar; `"1"`/`"yes"`/bozuk değer AÇMAZ (fail-closed).
 *
 * Değer İLK OKUMADA ÖNBELLEĞE ALINIR: karar bir konuşma turunun ortasında
 * değişip zinciri yarı-yolda değiştiremez (deterministik tur). Şalteri
 * çevirdikten sonra uygulama yeniden başlatılır.
 */

import { getFlag } from '../../remoteConfigService';

/** Uzak yapılandırma bayrağı anahtarı. */
export const AI_GATEWAY_REMOTE_FLAG = 'mavi_ai_gateway';
/** Yerel geliştirme kaldıracı anahtarı. */
export const AI_GATEWAY_LOCAL_FLAG  = 'mavi.aiGateway.enabled';

let _cached: boolean | null = null;

function readLocalOverride(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(AI_GATEWAY_LOCAL_FLAG) === 'true';   // YALNIZ tam "true"
  } catch {
    return false;                                                     // depo kilitli/kotalı
  }
}

function readRemoteFlag(): boolean {
  try {
    return getFlag(AI_GATEWAY_REMOTE_FLAG) === true;
  } catch {
    return false;                                                     // yapılandırma yoksa KAPALI
  }
}

/**
 * Mavi AI Gateway hattı açık mı? Varsayılan `false` (mevcut davranış).
 * İlk çağrıda okunur ve önbelleğe alınır.
 */
export function isAiGatewayEnabled(): boolean {
  if (_cached === null) _cached = readRemoteFlag() || readLocalOverride();
  return _cached;
}

/* ── Alt tercih: Model Orchestrator ───────────────────────────────────────── */

/**
 * Orchestrator, gateway hattının ALT TERCİHİDİR (ayrı bir üst şalter DEĞİL):
 *   Gateway KAPALI                    → eski Mavi yolu birebir
 *   Gateway AÇIK · Orchestrator KAPALI → mevcut tek-sağlayıcı gateway davranışı
 *   Gateway AÇIK · Orchestrator AÇIK   → orkestre edilmiş yürütücü
 * Gateway kapalıyken orchestrator TEK BAŞINA devreye GİREMEZ (fail-closed).
 * Varsayılan KAPALI; rollback tek ayarla.
 */
export const AI_ORCHESTRATOR_REMOTE_FLAG = 'mavi_ai_orchestrator';
export const AI_ORCHESTRATOR_LOCAL_FLAG  = 'mavi.aiOrchestrator.enabled';

let _orchestratorCached: boolean | null = null;

export function isMaviOrchestratorEnabled(): boolean {
  if (!isAiGatewayEnabled()) return false;          // üst şalter kapalıysa asla
  if (_orchestratorCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_ORCHESTRATOR_LOCAL_FLAG) === 'true';   // YALNIZ tam "true"
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_ORCHESTRATOR_REMOTE_FLAG) === true; } catch { remote = false; }
    _orchestratorCached = remote || local;
  }
  return _orchestratorCached;
}

/** Orchestrator alt tercihini çevirir (yalnız yerel kaldıraç yazılır). */
export function setMaviOrchestratorEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_ORCHESTRATOR_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_ORCHESTRATOR_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _orchestratorCached = null;                        // bir sonraki okumada tazelenir
}

/* ── Alt tercih: Araç Bağlamı (Context Engine) ────────────────────────────── */

/**
 * Bağlam enjeksiyonu, gateway hattının AYRI bir alt tercihidir ve İKİ KAPI
 * gerektirir:
 *   1) özellik şalteri (`mavi.aiContext.enabled` / uzak bayrak)
 *   2) KULLANICI İZNİ (`mavi.aiContext.consent` === 'vehicle_context')
 * İkisi de olmadan araç verisi AI'ya GÖNDERİLMEZ. Varsayılan: KAPALI + izin YOK.
 *
 * Not: bunlar gizli veri değil KULLANICI TERCİHİDİR; diğer Mavi alt tercihleriyle
 * aynı mekanizmada tutulur (anahtar/sır depolamasıyla karıştırılmaz).
 */
export const AI_CONTEXT_REMOTE_FLAG = 'mavi_ai_context';
export const AI_CONTEXT_LOCAL_FLAG  = 'mavi.aiContext.enabled';
export const AI_CONTEXT_CONSENT_KEY = 'mavi.aiContext.consent';

/** İzin seviyeleri — konum izni bu fazda YOK. */
export type MaviContextConsent = 'off' | 'vehicle_context';

let _contextCached: boolean | null = null;

export function isMaviContextEnabled(): boolean {
  if (!isAiGatewayEnabled()) return false;            // üst şalter kapalıysa asla
  if (_contextCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_CONTEXT_LOCAL_FLAG) === 'true';
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_CONTEXT_REMOTE_FLAG) === true; } catch { remote = false; }
    _contextCached = remote || local;
  }
  return _contextCached;
}

/**
 * Kullanıcının bağlam izni. Değer okunamaz/tanınmazsa FAIL-CLOSED (`off`) —
 * belirsiz profil/misafir durumunda araç verisi paylaşılmaz.
 */
export function getMaviContextConsent(): MaviContextConsent {
  try {
    if (typeof localStorage === 'undefined') return 'off';
    return localStorage.getItem(AI_CONTEXT_CONSENT_KEY) === 'vehicle_context'
      ? 'vehicle_context'
      : 'off';                                        // YALNIZ tam eşleşme açar
  } catch {
    return 'off';
  }
}

export function setMaviContextConsent(level: MaviContextConsent): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (level === 'vehicle_context') localStorage.setItem(AI_CONTEXT_CONSENT_KEY, 'vehicle_context');
    else                             localStorage.removeItem(AI_CONTEXT_CONSENT_KEY);
  } catch { /* depo kilitli */ }
}

export function setMaviContextEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_CONTEXT_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_CONTEXT_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _contextCached = null;
}

/* ── Alt tercih: Hafıza (Memory Engine) ───────────────────────────────────── */

/**
 * Hafıza enjeksiyonu KİŞİSEL VERİ taşıdığı için araç bağlamından AYRI izin
 * gerektirir (araç telemetrisine izin vermek, kişisel tercihlerin AI'ya
 * gönderilmesine izin vermek anlamına GELMEZ).
 *
 * İki kapı: şalter + `mavi.aiMemory.consent === 'memory'`. Gateway kapalıyken
 * tek başına açılamaz. Varsayılan: KAPALI + izin YOK.
 */
export const AI_MEMORY_REMOTE_FLAG = 'mavi_ai_memory';
export const AI_MEMORY_LOCAL_FLAG  = 'mavi.aiMemory.enabled';
export const AI_MEMORY_CONSENT_KEY = 'mavi.aiMemory.consent';

export type MaviMemoryConsent = 'off' | 'memory';

let _memoryCached: boolean | null = null;

export function isMaviMemoryEnabled(): boolean {
  if (!isAiGatewayEnabled()) return false;
  if (_memoryCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_MEMORY_LOCAL_FLAG) === 'true';
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_MEMORY_REMOTE_FLAG) === true; } catch { remote = false; }
    _memoryCached = remote || local;
  }
  return _memoryCached;
}

/** Okunamaz/tanınmaz değer → FAIL-CLOSED (`off`). */
export function getMaviMemoryConsent(): MaviMemoryConsent {
  try {
    if (typeof localStorage === 'undefined') return 'off';
    return localStorage.getItem(AI_MEMORY_CONSENT_KEY) === 'memory' ? 'memory' : 'off';
  } catch {
    return 'off';
  }
}

export function setMaviMemoryConsent(level: MaviMemoryConsent): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (level === 'memory') localStorage.setItem(AI_MEMORY_CONSENT_KEY, 'memory');
    else                    localStorage.removeItem(AI_MEMORY_CONSENT_KEY);
  } catch { /* depo kilitli */ }
}

export function setMaviMemoryEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_MEMORY_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_MEMORY_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _memoryCached = null;
}

/* ── Alt tercih: Tool Router ──────────────────────────────────────────────── */

/**
 * Araç kullanımı (tool calling) AYRI izin gerektirir: araçlar uygulama içinde
 * EYLEM yapabilir (ekran açma) ve araç verisi okuyabilir — bu, sohbet bağlamı
 * iznden farklı bir yetkidir.
 *
 * İki kapı: şalter + izin `'tools'`. Gateway kapalıyken tek başına açılamaz.
 * Varsayılan: KAPALI + izin YOK.
 */
export const AI_TOOLS_REMOTE_FLAG = 'mavi_ai_tools';
export const AI_TOOLS_LOCAL_FLAG  = 'mavi.aiTools.enabled';
export const AI_TOOLS_CONSENT_KEY = 'mavi.aiTools.consent';

export type MaviToolsConsent = 'off' | 'tools';

let _toolsCached: boolean | null = null;

export function isMaviToolsEnabled(): boolean {
  if (!isAiGatewayEnabled()) return false;
  if (_toolsCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_TOOLS_LOCAL_FLAG) === 'true';
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_TOOLS_REMOTE_FLAG) === true; } catch { remote = false; }
    _toolsCached = remote || local;
  }
  return _toolsCached;
}

/** Okunamaz/tanınmaz değer → FAIL-CLOSED. */
export function getMaviToolsConsent(): MaviToolsConsent {
  try {
    if (typeof localStorage === 'undefined') return 'off';
    return localStorage.getItem(AI_TOOLS_CONSENT_KEY) === 'tools' ? 'tools' : 'off';
  } catch {
    return 'off';
  }
}

export function setMaviToolsConsent(level: MaviToolsConsent): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (level === 'tools') localStorage.setItem(AI_TOOLS_CONSENT_KEY, 'tools');
    else                   localStorage.removeItem(AI_TOOLS_CONSENT_KEY);
  } catch { /* depo kilitli */ }
}

export function setMaviToolsEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_TOOLS_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_TOOLS_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _toolsCached = null;
  _plannerCached = null;
  _mechanicCached = null;
}

/* ── Alt tercih: Planner ──────────────────────────────────────────────────── */

/**
 * Planner YALNIZ KARAR üretir (araç çalıştırmaz), bu yüzden ek KULLANICI İZNİ
 * gerektirmez; ama yine de kendi şalteri vardır ve araç kataloğu Tool Router'ın
 * izin kapılarından geçtiği için pratikte tool izni olmadan plan BOŞ kalır.
 * Varsayılan KAPALI; gateway kapalıyken açılamaz.
 */
export const AI_PLANNER_REMOTE_FLAG = 'mavi_ai_planner';
export const AI_PLANNER_LOCAL_FLAG  = 'mavi.aiPlanner.enabled';

let _plannerCached: boolean | null = null;

export function isMaviPlannerEnabled(): boolean {
  if (!isAiGatewayEnabled()) return false;
  if (_plannerCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_PLANNER_LOCAL_FLAG) === 'true';
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_PLANNER_REMOTE_FLAG) === true; } catch { remote = false; }
    _plannerCached = remote || local;
  }
  return _plannerCached;
}

export function setMaviPlannerEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_PLANNER_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_PLANNER_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _plannerCached = null;
}

/* ── Alt tercih: AI Usta (Mechanic) ───────────────────────────────────────── */

/**
 * Teşhis bloğu, ZATEN çalışan aiCore AI Usta sonucunun Mavi'ye taşınmasıdır;
 * yeni ölçüm/sorgu YAPMAZ. Yine de kendi şalteri vardır. Varsayılan KAPALI;
 * gateway kapalıyken açılamaz.
 */
export const AI_MECHANIC_REMOTE_FLAG = 'mavi_ai_mechanic';
export const AI_MECHANIC_LOCAL_FLAG  = 'mavi.aiMechanic.enabled';

let _mechanicCached: boolean | null = null;

export function isMaviMechanicEnabled(): boolean {
  if (!isAiGatewayEnabled()) return false;
  if (_mechanicCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_MECHANIC_LOCAL_FLAG) === 'true';
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_MECHANIC_REMOTE_FLAG) === true; } catch { remote = false; }
    _mechanicCached = remote || local;
  }
  return _mechanicCached;
}

export function setMaviMechanicEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_MECHANIC_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_MECHANIC_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _mechanicCached = null;
}

/* ── Alt tercih: AI Usta GEÇMİŞİ (Faz 2 — tekrar/eğilim/tazelik) ──────────── */

/**
 * Geçmiş yorumu, MEVCUT bus geçmişi + MEVCUT Vehicle Memory'nin SALT OKUNUR
 * yorumudur; teşhisi değiştirmez, hiçbir yere yazmaz. Kendi şalteri vardır:
 * varsayılan KAPALI ve AI Usta kapalıyken açılamaz (zincirleme fail-closed).
 */
export const AI_MECHANIC_HISTORY_REMOTE_FLAG = 'mavi_ai_mechanic_history';
export const AI_MECHANIC_HISTORY_LOCAL_FLAG  = 'mavi.aiMechanicHistory.enabled';

let _mechanicHistoryCached: boolean | null = null;

export function isMaviMechanicHistoryEnabled(): boolean {
  if (!isMaviMechanicEnabled()) return false;
  if (_mechanicHistoryCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_MECHANIC_HISTORY_LOCAL_FLAG) === 'true';
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_MECHANIC_HISTORY_REMOTE_FLAG) === true; } catch { remote = false; }
    _mechanicHistoryCached = remote || local;
  }
  return _mechanicHistoryCached;
}

export function setMaviMechanicHistoryEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_MECHANIC_HISTORY_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_MECHANIC_HISTORY_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _mechanicHistoryCached = null;
}

/* ── Alt tercih: AI Usta BİLGİ NOTU (otomotiv bilgi tabanı) ───────────────── */

/**
 * Bilgi notu, MEVCUT deterministik bilgi kaynaklarının (bundled DTC kataloğu +
 * `diagnosticKnowledgeEngine`) SALT OKUNUR yorumudur; teşhisi/güveni/riski
 * değiştirmez, yeni ölçüm/OBD sorgusu YAPMAZ, hiçbir yere yazmaz. Kendi şalteri
 * vardır: varsayılan KAPALI ve AI Usta kapalıyken açılamaz (zincirleme fail-closed).
 */
export const AI_MECHANIC_KNOWLEDGE_REMOTE_FLAG = 'mavi_ai_mechanic_knowledge';
export const AI_MECHANIC_KNOWLEDGE_LOCAL_FLAG  = 'mavi.aiMechanicKnowledge.enabled';

let _mechanicKnowledgeCached: boolean | null = null;

export function isMaviMechanicKnowledgeEnabled(): boolean {
  if (!isMaviMechanicEnabled()) return false;          // üst şalter kapalıysa asla
  if (_mechanicKnowledgeCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_MECHANIC_KNOWLEDGE_LOCAL_FLAG) === 'true';   // YALNIZ tam "true"
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_MECHANIC_KNOWLEDGE_REMOTE_FLAG) === true; } catch { remote = false; }
    _mechanicKnowledgeCached = remote || local;
  }
  return _mechanicKnowledgeCached;
}

export function setMaviMechanicKnowledgeEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_MECHANIC_KNOWLEDGE_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_MECHANIC_KNOWLEDGE_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _mechanicKnowledgeCached = null;
}

/* ── Alt tercih: Operatör (çok-adımlı görev yönetimi) ─────────────────────── */

/**
 * Operatör, MEVCUT katmanları (Planner + Tool Router + AI Usta/Bilgi Beyni)
 * çok-adımlı bir görevde ORKESTRE eder; yeni motor/router/planner KURMAZ.
 * Alt katmanların her biri kendi kapısını uygular (planner/tools izni, mechanic
 * şalteri) — operatör bunları BYPASS ETMEZ. Kendi şalteri vardır: varsayılan
 * KAPALI ve gateway kapalıyken açılamaz (fail-closed).
 */
export const AI_OPERATOR_REMOTE_FLAG = 'mavi_ai_operator';
export const AI_OPERATOR_LOCAL_FLAG  = 'mavi.aiOperator.enabled';

let _operatorCached: boolean | null = null;

export function isMaviOperatorEnabled(): boolean {
  if (!isAiGatewayEnabled()) return false;             // üst şalter kapalıysa asla
  if (_operatorCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_OPERATOR_LOCAL_FLAG) === 'true';   // YALNIZ tam "true"
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_OPERATOR_REMOTE_FLAG) === true; } catch { remote = false; }
    _operatorCached = remote || local;
  }
  return _operatorCached;
}

export function setMaviOperatorEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_OPERATOR_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_OPERATOR_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _operatorCached = null;
  _operatorChatCached = null;
}

/* ── Alt tercih: Operatör SOHBET BAĞLAMASI (Intent Engine → orchestrated chat) ── */

/**
 * Operatör'ün orkestre sohbet akışına bağlanması (Faz 2). Niyet motoru kullanıcı
 * mesajını çözer ve uygun görevi çalıştırıp sonucu system prompt'a EKLER. Kendi
 * şalteri vardır: varsayılan KAPALI ve Operatör kapalıyken açılamaz (zincirleme
 * fail-closed). Kapalıyken mevcut sohbet davranışı BAYT BAYT aynıdır.
 */
export const AI_OPERATOR_CHAT_REMOTE_FLAG = 'mavi_ai_operator_chat';
export const AI_OPERATOR_CHAT_LOCAL_FLAG  = 'mavi.aiOperatorChat.enabled';

let _operatorChatCached: boolean | null = null;

export function isMaviOperatorChatEnabled(): boolean {
  if (!isMaviOperatorEnabled()) return false;          // üst şalter kapalıysa asla
  if (_operatorChatCached === null) {
    let local = false;
    try {
      local = typeof localStorage !== 'undefined'
        && localStorage.getItem(AI_OPERATOR_CHAT_LOCAL_FLAG) === 'true';   // YALNIZ tam "true"
    } catch { local = false; }
    let remote = false;
    try { remote = getFlag(AI_OPERATOR_CHAT_REMOTE_FLAG) === true; } catch { remote = false; }
    _operatorChatCached = remote || local;
  }
  return _operatorChatCached;
}

export function setMaviOperatorChatEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_OPERATOR_CHAT_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_OPERATOR_CHAT_LOCAL_FLAG);
    }
  } catch { /* depo kilitli */ }
  _operatorChatCached = null;
}

/**
 * Şalteri kullanıcı tercihine göre AÇAR/KAPATIR (ayarlar ekranı).
 *
 * Yalnız YEREL kaldıracı yazar — uzak bayrak filoya aittir, cihazdan
 * değiştirilmez. Önbellek hemen tazelenir ki kullanıcı ayarı çevirince bir
 * sonraki konuşma turu yeni değeri görsün (yeniden başlatma gerekmez).
 *
 * ⚠️ Bu fonksiyon anahtarın GEÇERLİ olduğunu DOĞRULAMAZ — çağıran taraf
 * (openRouterKeyService) fail-closed kapıyı uygular.
 */
export function setAiGatewayEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_GATEWAY_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_GATEWAY_LOCAL_FLAG);
    }
  } catch { /* depo kilitli/kotalı — yalnız bellek içi karar güncellenir */ }
  // Uzak bayrak AÇIKSA kullanıcı yerelden kapatamaz (filo politikası üstündür).
  _cached = enabled || readRemoteFlag();
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetAiGatewayFlagForTest(): void {
  _cached = null;
  _orchestratorCached = null;
  _contextCached = null;
  _memoryCached = null;
  _toolsCached = null;
  _plannerCached = null;
  _mechanicCached = null;
  _mechanicHistoryCached = null;
  _mechanicKnowledgeCached = null;
  _operatorCached = null;
  _operatorChatCached = null;
}
