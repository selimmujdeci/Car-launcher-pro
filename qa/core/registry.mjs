/**
 * registry.mjs — Faz defteri (plugin sözleşmesi).
 *
 * Fazlar `definePhase()` ile TANIMLANIR (saf veri + run fonksiyonu), registry'ye
 * KAYDEDİLİR, orchestrator tarafından deterministik sırayla koşulur.
 *
 * Sözleşme (PR-1'de dondurulmuştur — sonraki fazlar bunu genişletemez, uyar):
 *   { id, name, order, weight, category, requires[], safetyCritical, run(context) }
 *
 * Kurallar:
 * - Aynı id iki kez kaydedilemez (sessiz üzerine-yazma = sessiz kanıt kaybı).
 * - Sıralama deterministik: order → id (aynı order'da alfabetik). Kayıt sırası
 *   sonucu ETKİLEMEZ (Set/Map iteration'a bağımlı olmayan tekrarlanabilir koşu).
 *
 * Yan etkisiz: bu modül import edildiğinde hiçbir faz otomatik kaydolmaz.
 */
import { PHASE_CATEGORY, CAPABILITIES } from './result-types.mjs';

/**
 * Faz tanımlar ve doğrular. Geçersiz tanım = ERKEN çöküş (test-time),
 * koşu sırasında sürpriz değil.
 */
export function definePhase(def) {
  const {
    id,
    name,
    order,
    weight = 1,
    category = PHASE_CATEGORY.GENERAL,
    requires = [],
    safetyCritical = false,
    run,
  } = def ?? {};

  if (!id || typeof id !== 'string')          throw new TypeError('phase.id zorunlu (string)');
  if (!name || typeof name !== 'string')      throw new TypeError(`[${id}] phase.name zorunlu (string)`);
  if (!Number.isFinite(order))                throw new TypeError(`[${id}] phase.order zorunlu (sayı)`);
  if (!Number.isFinite(weight) || weight <= 0) throw new TypeError(`[${id}] phase.weight > 0 olmalı`);
  if (!Object.values(PHASE_CATEGORY).includes(category)) throw new TypeError(`[${id}] geçersiz category: ${category}`);
  if (!Array.isArray(requires))               throw new TypeError(`[${id}] phase.requires dizi olmalı`);
  for (const cap of requires) {
    if (!CAPABILITIES.includes(cap)) throw new TypeError(`[${id}] bilinmeyen capability: ${cap}`);
  }
  if (typeof safetyCritical !== 'boolean')    throw new TypeError(`[${id}] phase.safetyCritical boolean olmalı`);
  if (typeof run !== 'function')              throw new TypeError(`[${id}] phase.run(context) fonksiyon olmalı`);

  return Object.freeze({
    id,
    name,
    order,
    weight,
    category,
    requires: Object.freeze([...requires]),
    safetyCritical,
    run,
  });
}

/** Boş faz defteri üretir. */
export function createRegistry() {
  /** @type {Map<string, ReturnType<typeof definePhase>>} */
  const phases = new Map();

  return Object.freeze({
    /** Faz kaydeder. Duplicate id → hata. */
    register(phase) {
      if (!phase || typeof phase.id !== 'string') throw new TypeError('register(phase): geçersiz faz');
      if (phases.has(phase.id)) throw new Error(`Faz zaten kayıtlı: ${phase.id} (duplicate id yasak)`);
      phases.set(phase.id, phase);
      return phase;
    },

    /** Birden çok faz kaydeder. */
    registerAll(list) {
      for (const p of list) this.register(p);
      return this;
    },

    has(id) { return phases.has(id); },
    get(id) { return phases.get(id) ?? null; },
    get size() { return phases.size; },

    /**
     * Deterministik sırada faz listesi. `allowlist` verilirse (profil.phases)
     * yalnız o id'ler döner; profildeki bilinmeyen id → hata (sessiz atlama yok).
     */
    list(allowlist = null) {
      let items = [...phases.values()];
      if (allowlist) {
        for (const id of allowlist) {
          if (!phases.has(id)) throw new Error(`Profil bilinmeyen faz istiyor: ${id}`);
        }
        const allowed = new Set(allowlist);
        items = items.filter((p) => allowed.has(p.id));
      }
      return items.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
    },
  });
}
