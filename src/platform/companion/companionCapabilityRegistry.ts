/**
 * companionCapabilityRegistry.ts — Companion yetenek defteri (P1-PREP · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · React importu YOK.
 * Ad bilinçli olarak `companion` ön ekliidir: depoda ARAÇ tarafı için ayrı bir
 * `capabilityRegistry` VARDIR ve o dosyaya DOKUNULMAZ (paralel sistem değil,
 * ayrı alan adı).
 *
 * ── BU DEFTER NE YAPMAZ ─────────────────────────────────────────────────────
 * Hiçbir yeteneği ETKİNLEŞTİRMEZ · izin İSTEMEZ · veri OKUMAZ. Yalnız "karşı
 * taraf neyi iddia etti / biz neyi kabul ettik" defterini tutar.
 *
 * ── BİLİNMEYEN YETENEK DÜŞÜRÜLMEZ ───────────────────────────────────────────
 * Karşı taraf ileri sürümde yeni yetenek gönderebilir. Bilinmeyen jeton HATA
 * DEĞİLDİR: ayrı `unknown` listesinde TAŞINIR, ama ASLA `granted` sayılmaz —
 * anlamını bilmediğimiz bir yeteneği kabul etmek fail-open olur.
 */

import {
  fnv1aHex, isKnownCapability, isValidCapabilityToken, MAX_CAPABILITIES,
  MAX_UNKNOWN_CAPABILITIES, CAPABILITY_PRIVACY,
  type CapabilityToken, type CompanionCapability, type CapabilityPrivacyClass,
} from './companionDomain';

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir yeteneğin defterdeki durumu.
 *  DECLARED  : karşı taraf iddia etti, henüz kabul edilmedi.
 *  GRANTED   : iki taraf da destekliyor → kullanılabilir (kullanılmıyor, kullanılabilir).
 *  UNSUPPORTED: bizim tarafımız desteklemiyor.
 *  UNKNOWN   : jeton tanınmıyor (ileri sürüm) — taşınır, kabul edilmez.
 */
export type CapabilityStatus = 'DECLARED' | 'GRANTED' | 'UNSUPPORTED' | 'UNKNOWN';

export const CAPABILITY_STATUS_LABEL: Readonly<Record<CapabilityStatus, string>> = {
  DECLARED:    'BEYAN EDİLDİ',
  GRANTED:     'ANLAŞILDI',
  UNSUPPORTED: 'DESTEKLENMİYOR',
  UNKNOWN:     'TANINMIYOR',
} as const;

export interface CapabilityRecord {
  readonly token: CapabilityToken;
  readonly status: CapabilityStatus;
  readonly known: boolean;
  /** Yalnız bilinen yetenekler için gizlilik sınıfı; bilinmeyende null. */
  readonly privacy: CapabilityPrivacyClass | null;
  /** Bu kaydın oluştuğu oturum nesli — bayat kayıt ayırt edilsin. */
  readonly generation: number;
}

export interface CapabilitySnapshot {
  readonly generation: number;
  readonly granted: readonly CapabilityToken[];
  readonly declared: readonly CapabilityToken[];
  readonly unsupported: readonly CapabilityToken[];
  readonly unknown: readonly CapabilityToken[];
  readonly rejectedTokenCount: number;
  readonly truncated: boolean;
  /** Kararlı özet — değişim tespiti için (yeniden anlaşma tetiği). */
  readonly digest: string;
}

/**
 * Bu derlemenin DESTEKLEDİĞİ yetenekler.
 *
 * ⚠️ BİLİNÇLİ OLARAK BOŞ: Companion Foundation hiçbir yeteneği uygulamadı.
 * Buraya bir yetenek eklemek, o yeteneğin GERÇEKTEN uygulanmış olmasını ve
 * gizlilik/onay kapısının kurulmuş olmasını gerektirir. Boş liste sayesinde
 * `granted` kümesi bugün DAİMA boştur — fail-closed.
 */
export const LOCALLY_SUPPORTED_CAPABILITIES: readonly CompanionCapability[] = Object.freeze([]);

/* ══════════════════════════════════════════════════════════════════════════
 * Defter
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionCapabilityRegistryDeps {
  /** Bizim desteklediğimiz yetenekler (test/ileri faz için enjekte edilebilir). */
  readonly locallySupported?: readonly CompanionCapability[];
}

export class CompanionCapabilityRegistry {
  private readonly _local: ReadonlySet<string>;
  private _records = new Map<CapabilityToken, CapabilityRecord>();
  private _generation = 0;
  private _rejected = 0;
  private _truncated = false;

  constructor(deps: CompanionCapabilityRegistryDeps = {}) {
    this._local = new Set<string>(deps.locallySupported ?? LOCALLY_SUPPORTED_CAPABILITIES);
  }

  /**
   * Karşı tarafın beyanını UYGULAR. Bu bir DEĞİŞTİRME işlemidir: eski nesle ait
   * kayıtlar TAMAMEN atılır (karşı taraf bir yeteneği kaybettiyse defterde
   * kalması sahte yetenek olurdu).
   *
   * ASLA throw etmez; geçersiz jeton sayılır ve düşürülür.
   */
  applyDeclaration(tokens: unknown, generation: number): CapabilitySnapshot {
    const gen = Number.isFinite(generation) ? Math.max(0, Math.trunc(generation)) : 0;
    const next = new Map<CapabilityToken, CapabilityRecord>();
    let rejected = 0;
    let truncated = false;
    let unknownCount = 0;

    const list: unknown[] = Array.isArray(tokens) ? tokens : [];
    for (const raw of list) {
      if (!isValidCapabilityToken(raw)) { rejected++; continue; }
      const token = raw;
      if (next.has(token)) continue;                       // yinelenen jeton sessizce tekilleşir

      const known = isKnownCapability(token);
      if (!known && unknownCount >= MAX_UNKNOWN_CAPABILITIES) { truncated = true; continue; }
      if (next.size >= MAX_CAPABILITIES) { truncated = true; continue; }
      if (!known) unknownCount++;

      const status: CapabilityStatus = !known
        ? 'UNKNOWN'
        : this._local.has(token) ? 'GRANTED' : 'UNSUPPORTED';

      next.set(token, {
        token,
        status,
        known,
        privacy: known ? CAPABILITY_PRIVACY[token as CompanionCapability] : null,
        generation: gen,
      });
    }

    this._records = next;
    this._generation = gen;
    this._rejected = rejected;
    this._truncated = truncated;
    return this.snapshot();
  }

  /** Anlaşma sonrası kabul edilen küme — YALNIZ bilinen + yerelde desteklenen. */
  grantedTokens(): readonly CapabilityToken[] {
    return this._sortedByStatus('GRANTED');
  }

  get(token: string): CapabilityRecord | null {
    return typeof token === 'string' ? (this._records.get(token) ?? null) : null;
  }

  has(token: string): boolean {
    return typeof token === 'string' && this._records.has(token);
  }

  /** Yetenek KULLANILABİLİR mi — yalnız GRANTED. UNKNOWN asla izin vermez. */
  isGranted(token: string): boolean {
    const rec = this.get(token);
    return rec !== null && rec.status === 'GRANTED';
  }

  get generation(): number { return this._generation; }
  get size(): number { return this._records.size; }

  snapshot(): CapabilitySnapshot {
    const granted = this._sortedByStatus('GRANTED');
    const declared = this._sortedByStatus('DECLARED');
    const unsupported = this._sortedByStatus('UNSUPPORTED');
    const unknown = this._sortedByStatus('UNKNOWN');
    return {
      generation: this._generation,
      granted,
      declared,
      unsupported,
      unknown,
      rejectedTokenCount: this._rejected,
      truncated: this._truncated,
      digest: capabilityDigest(granted, unsupported, unknown),
    };
  }

  /** Defteri boşaltır (kopma/sıfırlama). Sistem durumuna DOKUNMAZ. */
  clear(): void {
    this._records = new Map();
    this._rejected = 0;
    this._truncated = false;
  }

  private _sortedByStatus(status: CapabilityStatus): readonly CapabilityToken[] {
    const out: CapabilityToken[] = [];
    for (const rec of this._records.values()) if (rec.status === status) out.push(rec.token);
    return Object.freeze(out.sort());
  }
}

export function createCompanionCapabilityRegistry(
  deps: CompanionCapabilityRegistryDeps = {},
): CompanionCapabilityRegistry {
  return new CompanionCapabilityRegistry(deps);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Değişim tespiti
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kararlı özet. Nesil DIŞARIDA bırakılır: amaç "yetenek KÜMESİ değişti mi"
 * sorusunu yanıtlamak; nesil her yeniden bağlanmada artacağı için özete girerse
 * her seferinde "değişti" derdi ve gereksiz yeniden anlaşma tetiklerdi.
 *
 * GİZLİLİK: `granted`/`unsupported` bizim BİLİNEN enum'umuzdur, açıkça yazılır.
 * `unknown` ise KARŞI TARAFIN özel ad alanıdır — özete AÇIK YAZILMAZ, yalnız
 * adet + geri çevrilemez karma girer. Böylece değişim tespiti korunur ama
 * özet bir yere (döküm, dışa aktarma, olay yükü) taşındığında karşı tarafın
 * jeton adları SIZMAZ. Bu kural testte yakalanan gerçek bir sızıntıdan sonra
 * eklendi.
 */
export function capabilityDigest(
  granted: readonly CapabilityToken[],
  unsupported: readonly CapabilityToken[],
  unknown: readonly CapabilityToken[],
): string {
  const unknownSorted = [...unknown].sort();
  const unknownFingerprint = unknownSorted.length === 0
    ? '0'
    : `${unknownSorted.length}.${fnv1aHex(unknownSorted.join(','))}`;
  const parts = [
    `g:${[...granted].sort().join(',')}`,
    `u:${[...unsupported].sort().join(',')}`,
    `x:${unknownFingerprint}`,
  ];
  return parts.join('|');
}

/** İki beyan arasında anlamlı fark var mı → YENİDEN ANLAŞMA gerekir. */
export function capabilitiesChanged(
  before: CapabilitySnapshot | null,
  after: CapabilitySnapshot | null,
): boolean {
  if (!before || !after) return before !== after;
  return before.digest !== after.digest;
}
