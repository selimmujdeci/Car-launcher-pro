/**
 * maviCore/wiring/takeoverPolicy.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-3 TAKEOVER politikası.
 *
 * AMAÇ: SHADOW (gölge) / TAKEOVER (gerçek devralma) seçimini TİPLENMİŞ, SAF bir politika ile
 * tanımlar. Varsayılan SHADOW; feature-flag/config kapalıyken mevcut davranış BİREBİR korunur.
 *
 * SAVUNMA DERİNLİĞİ (task · CLAUDE.md):
 *  - TAKEOVER yalnız `TAKEOVER_ELIGIBLE` kümesindeki eylemler için mümkündür. İlk ve TEK eligible:
 *    `media.next`. Allowlist'e başka bir şey verilse bile (config hatası/kötü niyet) KESİŞİM
 *    alınır → yalnız eligible olanlar geçer.
 *  - ECU write/coding/adaptation/actuator ve TÜM araç eylemleri (vehicle.*) eligible DEĞİLDİR →
 *    hiçbir config onları TAKEOVER'a alamaz (AiSafetyGate zaten ayrı bir katman olarak korur).
 *  - SAF: I/O yok, yan etki yok; feature-flag OKUMA wiring katmanındadır (bu modül yalnız config alır).
 */

export type MaviMode = 'shadow' | 'takeover';

/**
 * TAKEOVER'a UYGUN eylemler (anayasal beyaz liste). Bu kümenin DIŞINDAKİ hiçbir eylem — config ne
 * derse desin — gerçek devralınamaz. Faz-3: yalnızca `media.next`.
 */
export const TAKEOVER_ELIGIBLE: ReadonlySet<string> = new Set<string>(['media.next']);

/** Eligible olsa bile asla TAKEOVER edilemeyecek desenler (araç/ECU) — çifte savunma. */
const FORBIDDEN_PREFIXES: readonly string[] = ['vehicle.', 'ecu', 'coding', 'adaptation', 'actuator', 'dtc.'];

function isForbiddenAction(actionId: string): boolean {
  return FORBIDDEN_PREFIXES.some((p) => actionId.startsWith(p));
}

export interface TakeoverConfig {
  /** Çalışma modu (varsayılan 'shadow'). Feature-flag bunu belirler. */
  readonly mode?: MaviMode;
  /** TAKEOVER'a istenen eylemler (varsayılan: TAKEOVER_ELIGIBLE = ['media.next']). */
  readonly allowlist?: readonly string[];
}

export interface TakeoverPolicy {
  readonly mode: MaviMode;
  /** Etkin allowlist (istenen ∩ eligible, araç eylemleri elenmiş). */
  readonly allowlist: ReadonlySet<string>;
  /** Bir eylem GERÇEK devralınmalı mı (mode=takeover VE etkin allowlist'te). */
  shouldTakeover(actionId: string): boolean;
  /** Bir eylem hiç TAKEOVER'a UYGUN mu (mod'dan bağımsız — savunma derinliği sorgusu). */
  isEligible(actionId: string): boolean;
}

/**
 * Typed politika üretir. `mode` yalnız açıkça 'takeover' verilirse takeover; aksi halde SHADOW
 * (varsayılan güvenli). Allowlist eligible ile kesiştirilir + araç eylemleri elenir.
 */
export function createTakeoverPolicy(config: TakeoverConfig = {}): TakeoverPolicy {
  const mode: MaviMode = config.mode === 'takeover' ? 'takeover' : 'shadow';
  const requested = Array.isArray(config.allowlist) ? config.allowlist : [...TAKEOVER_ELIGIBLE];

  const effective = new Set<string>();
  for (const id of requested) {
    if (typeof id !== 'string') continue;
    // Eligible kümesinde OLMALI ve yasak desende OLMAMALI (çifte savunma).
    if (TAKEOVER_ELIGIBLE.has(id) && !isForbiddenAction(id)) effective.add(id);
  }
  const allowlist: ReadonlySet<string> = effective;

  return Object.freeze({
    mode,
    allowlist,
    shouldTakeover(actionId: string): boolean {
      return mode === 'takeover' && typeof actionId === 'string' && allowlist.has(actionId);
    },
    isEligible(actionId: string): boolean {
      return typeof actionId === 'string' && TAKEOVER_ELIGIBLE.has(actionId) && !isForbiddenAction(actionId);
    },
  });
}
