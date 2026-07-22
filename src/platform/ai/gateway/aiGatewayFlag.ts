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
}
