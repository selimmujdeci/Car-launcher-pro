/**
 * PID açıklama bütünlük katmanı — AI ve UI yalnızca doğrulanmış kayıt metnine yönlendirilir.
 *
 * Kaynak: `src/data/pidHumanRegistry.json` + `pidHumanRegistry.schema.json`
 * Şema dışı PID: sabit Türkçe "Açıklama Mevcut Değil"
 */

import pidHumanRegistry from '../../data/pidHumanRegistry.json';

export interface PidHumanEntry {
  kisaAd:             string;
  insancilAciklama:   string;
  birim?:             string;
  teknikKod?:         string;
}

const PID_REGISTRY = pidHumanRegistry as Record<string, PidHumanEntry>;

/** Şema dışı veya çözümlenemeyen PID için zorunlu kullanıcı metni */
export const PID_DESCRIPTION_MISSING_TR = 'Açıklama Mevcut Değil' as const;

const HEX2 = /^[0-9A-F]{2}$/;
const HEX4 = /^[0-9A-F]{4}$/i;

/**
 * OBD Mode 22 (Read Data By ID) — iki bayt DID anahtarına dönüştürür (örn. `22-F1-90`).
 * Kayıtta olup olmadığını kontrol etmez — bkz. getVerifiedPidEntry.
 */
export function parseToMode22DidKey(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '');
  if (!s.startsWith('22')) return null;
  const rest = s.startsWith('22-') ? s.slice(3) : s.slice(2);
  if (!rest) return null;
  const hexOnly = rest.replace(/-/g, '');
  if (!HEX4.test(hexOnly)) return null;
  const b1 = hexOnly.slice(0, 2).toUpperCase();
  const b2 = hexOnly.slice(2, 4).toUpperCase();
  if (!HEX2.test(b1) || !HEX2.test(b2)) return null;
  return `22-${b1}-${b2}`;
}

/**
 * Kullanıcı veya log girdisini Mode 01 PID anahtarına dönüştürür (örn. `01-0C`).
 * Kayıtta olup olmadığını kontrol etmez — bkz. getVerifiedPidEntry.
 */
export function parseToMode01PidKey(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '');

  if (!s) return null;

  const m01 = /^01[-]?([0-9A-F]{2})$/.exec(s);
  if (m01 && HEX2.test(m01[1]!)) return `01-${m01[1]}`;

  const mCompact = /^01([0-9A-F]{2})$/.exec(s);
  if (mCompact && HEX2.test(mCompact[1]!)) return `01-${mCompact[1]}`;

  const m0x = /^0X([0-9A-F]{1,2})$/.exec(s);
  if (m0x) {
    const h = m0x[1]!.padStart(2, '0');
    if (HEX2.test(h)) return `01-${h}`;
  }

  const mHex2 = /^([0-9A-F]{2})$/.exec(s);
  if (mHex2 && HEX2.test(mHex2[1]!)) return `01-${mHex2[1]}`;

  return null;
}

export function listValidatedPidKeys(): readonly string[] {
  return Object.keys(PID_REGISTRY).sort() as readonly string[];
}

export function isValidatedPidKey(key: string): key is keyof typeof PID_REGISTRY {
  return Object.prototype.hasOwnProperty.call(PID_REGISTRY, key);
}

export function getVerifiedPidEntry(key: string): PidHumanEntry | null {
  return isValidatedPidKey(key) ? PID_REGISTRY[key] : null;
}

export function getVerifiedPidTurkishDescription(key: string): string {
  const e = getVerifiedPidEntry(key);
  return e ? e.insancilAciklama : PID_DESCRIPTION_MISSING_TR;
}

/** Ham kullanıcı PID / Mode22 DID ifadesi → doğrulanmış açıklama veya şema dışı sabit metin */
export function explainPidSafeForDisplay(userPidFragment: string): string {
  const k22 = parseToMode22DidKey(userPidFragment);
  if (k22) return getVerifiedPidTurkishDescription(k22);
  const key = parseToMode01PidKey(userPidFragment);
  if (!key) return PID_DESCRIPTION_MISSING_TR;
  return getVerifiedPidTurkishDescription(key);
}

/**
 * AI sistem prompt'una eklenecek blok: yalnızca kayıtlı PID anahtarları ve sabit şema dışı cevap kuralı.
 */
export function buildPidRegistryIntegrityPromptBlock(): string {
  const keys = listValidatedPidKeys();
  const inventory = keys
    .map((k) => {
      const e = PID_REGISTRY[k]!;
      return `"${k}": ${JSON.stringify(e.insancilAciklama)}`;
    })
    .join('\n');

  return `
[PID / DID AÇIKLAMA BÜTÜNLÜĞÜ — ZORUNLU / HALÜSİNASYON ENGELİ]
OBD Mode 01 canlı veri (PID) veya Mode 22 veri tanımlayıcısı (DID) hakkında konuşurken:
1) Teknik kök anahtar olarak yalnızca şunları kullanabilirsin: ${keys.join(', ')}
2) Bu anahtarlardan birinin açıklaması gerekiyorsa metin AŞAĞIDAKİ doğrulanmış cümlelerden biriyle TAM ve AYNI olmalı; yorumlama, kısaltma, yeni teknik iddia veya paraphrase YASAK.
3) Yukarıdaki listede OLMAYAN her PID/DID için yanıtta yalnızca şu ifade kullanılmalıdır (tırnak içi, tek başına): "${PID_DESCRIPTION_MISSING_TR}"
4) Şema dışı kök anahtar veya uydurma sensör adı üretme.

Doğrulanmış insancilAciklama envanteri (satır başı = anahtar: değer):
${inventory}
`.trim();
}

/** Modelden gelen pidAciklama nesnesini yalnızca kayıtlı anahtarlarla süz; metinleri registry ile değiştirir */
export function sanitizePidAiExplanationBlob(raw: unknown): Record<string, PidHumanEntry> {
  const out: Record<string, PidHumanEntry> = {};
  if (!raw || typeof raw !== 'object') return out;

  const root = raw as Record<string, unknown>;
  const blob = root.pidAciklama;
  if (!blob || typeof blob !== 'object') return out;

  for (const k of Object.keys(blob)) {
    if (!isValidatedPidKey(k)) continue;
    out[k] = { ...PID_REGISTRY[k] };
  }
  return out;
}
