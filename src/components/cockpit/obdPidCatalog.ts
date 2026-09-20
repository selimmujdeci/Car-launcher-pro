/**
 * obdPidCatalog — OBD CANLI VERİLERİ sayfasının PID PLANI (SAF).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NE YAPAR / NE YAPMAZ
 *
 * Bu dosya YALNIZ "hangi PID hangi görsel kademede gösterilir" sorusunu
 * yanıtlar. Ad · birim · alt/üst sınır · kategori BURADA TANIMLANMAZ:
 * hepsi kanonik `STANDARD_PID_MAP` kaydından okunur (SAE J1979). Böylece
 * sayfa ikinci bir PID sözlüğü kurmaz ve kayıt büyüdüğünde burada bir şey
 * uydurulmuş olmaz (CLAUDE.md §6).
 *
 * SAF: I/O YOK · DOM YOK · React YOK · abonelik YOK.
 *
 * ── ÜÇ KADEME (ürün kararı) ───────────────────────────────────────────────
 *   LARGE — sürüşte tek bakışta okunan iki değer
 *   MINI  — aynı görsel dilde, daha küçük göstergeler
 *   LIST  — düşük öncelikli / ileri teknik veriler, sağda kompakt liste
 * Veri SİLİNMEZ; önem sırasına göre BOYUTLANDIRILIR.
 *
 * ── `core` AYRIMI ─────────────────────────────────────────────────────────
 * Kayıttaki `core: true` olan PID'ler `obdData` ana yolundan ZATEN akar
 * (`obdSanitizer` onları yazar). Onlar için ayrıca genişletilmiş izleme
 * AÇILMAZ — aksi hâlde aynı veri iki kez sorgulanırdı.
 */

import { STANDARD_PID_MAP, type StandardPidDef } from '../../platform/obd/StandardPidRegistry';

/** Sayfadaki görsel kademe. */
export type PidTier = 'large' | 'mini' | 'list';

export interface CatalogEntry {
  /** 2 haneli PID ('04'), ya da PID olmayan kanonik alanlar için sözde anahtar. */
  readonly key: string;
  readonly tier: PidTier;
  /**
   * `obdData` ana yolundan mı geliyor? `true` ise genişletilmiş izleme
   * AÇILMAZ; değer `useOBDState()` üzerinden okunur.
   */
  readonly core: boolean;
  /** Ekranda görünecek ad — kayıt varsa ORADAN gelir. */
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  /**
   * Seviye çubuğu/yay ANLAMLI mı? Sayaç ve mesafe gibi sürekli büyüyen
   * değerlerde doluluk göstermek SAHTE olurdu (§7).
   */
  readonly bar: boolean;
  /** Sıfır merkezli mi (yakıt trim gibi ±). */
  readonly centered: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çubuk/yay anlamlı mı — KAYITTAN TÜRETİLİR, elle işaretlenmez
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Sayaç/geçen süre/mesafe türü değerler sürekli artar; "yüzde dolu" diye bir
 * şeyleri YOKTUR. Kayıt bunu doğrudan söylemez ama iki alanı söyler:
 * `category` ve `unit`. Karar o ikisinden TÜRETİLİR.
 */
export function hasMeaningfulRange(def: Pick<StandardPidDef, 'category' | 'unit' | 'min' | 'max'>): boolean {
  if (!Number.isFinite(def.min) || !Number.isFinite(def.max) || def.max <= def.min) return false;
  if (def.category === 'mesafe') return false;            // km sayacı
  if (def.unit === '' ) return false;                     // kod/sayım (birimsiz)
  if (def.unit === 's' || def.unit === 'dk') return false; // geçen süre
  return true;
}

/** Değer sıfır merkezli mi (± trim, EGR hatası, avans). */
export function isCentered(def: Pick<StandardPidDef, 'min' | 'max'>): boolean {
  return def.min < 0 && def.max > 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sayfanın planı
 * ════════════════════════════════════════════════════════════════════════ */

/** LARGE — `obdData` çekirdeğinden gelir. */
const LARGE_PIDS = ['0C', '0D'] as const;

/**
 * MINI — üstteki satır `obdData` çekirdeğinden, alttaki satır
 * genişletilmiş kanaldan gelir. Akü voltajı PID DEĞİLDİR (ELM327 ATRV),
 * bu yüzden kayıt dışı sözde anahtarla taşınır.
 */
const MINI_CORE_PIDS = ['05', '11', '2F', '0F', '0B'] as const;
const MINI_EXT_PIDS  = ['04', '5A', '10', '0A', '06', '07'] as const;

/**
 * LIST — düşük öncelikli / ileri teknik. Sıra ÖNEM sırasıdır; destek
 * durumu çalışma zamanında belli olur, burada varsayılmaz.
 */
const LIST_EXT_PIDS = [
  '0E', // Ateşleme avansı
  '5C', // Motor yağı sıcaklığı
  '24', // O2 lambda (S1)
  '14', // O2 sensör voltajı (B1S1)
  '33', // Barometrik basınç
  '5E', // Motor yakıt tüketim hızı
  '46', // Ortam hava sıcaklığı
  '3C', // Katalizör sıcaklığı (B1S1)
  '2C', // Komutlanan EGR
  '2E', // Komutlanan EVAP temizleme
  '78', // Egzoz gazı sıcaklığı (EGT B1)
  '63', // Referans motor torku
  '1F', // Motor çalışma süresi  (sayaç → çubuk YOK)
  '21', // MIL yanarken kat edilen yol (sayaç → çubuk YOK)
] as const;

/** Akü voltajı: ELM327 ATRV — kayıtta PID karşılığı yoktur. */
export const BATTERY_VOLTAGE_KEY = 'ATRV';

function fromRegistry(pid: string, tier: PidTier): CatalogEntry | null {
  const def = STANDARD_PID_MAP.get(pid.toUpperCase());
  if (!def) return null;                       // kayıtta yoksa UYDURULMAZ
  return Object.freeze({
    key: def.pid,
    tier,
    core: def.core === true,
    label: def.name,
    unit: def.unit,
    min: def.min,
    max: def.max,
    bar: hasMeaningfulRange(def),
    centered: isCentered(def),
  });
}

function build(): readonly CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const p of LARGE_PIDS)     { const e = fromRegistry(p, 'large'); if (e) out.push(e); }
  for (const p of MINI_CORE_PIDS) { const e = fromRegistry(p, 'mini');  if (e) out.push(e); }

  /* Akü voltajı kayıtta yok; sınırları obdSanitizer'ın FİZİKSEL kabul
     bandıyla AYNIDIR ([8,16] V) — orası bu değerin tek doğrulayıcısıdır. */
  out.push(Object.freeze({
    key: BATTERY_VOLTAGE_KEY, tier: 'mini', core: true,
    label: 'Akü / ECU voltajı', unit: 'V', min: 8, max: 16, bar: true, centered: false,
  }));

  for (const p of MINI_EXT_PIDS) { const e = fromRegistry(p, 'mini'); if (e) out.push(e); }
  for (const p of LIST_EXT_PIDS) { const e = fromRegistry(p, 'list'); if (e) out.push(e); }
  return Object.freeze(out);
}

export const OBD_PAGE_CATALOG: readonly CatalogEntry[] = build();

/** Kademeye göre süzülmüş plan. */
export function entriesForTier(tier: PidTier): readonly CatalogEntry[] {
  return OBD_PAGE_CATALOG.filter((e) => e.tier === tier);
}

/**
 * Genişletilmiş kanaldan GERÇEKTEN izlenmesi gereken PID'ler.
 * `core` olanlar dışarıda kalır — onlar zaten ana yoldan akar, ikinci kez
 * sorgulanmaları ELM327 hattını boşa meşgul ederdi.
 */
export const WATCHED_EXTENDED_PIDS: readonly string[] = Object.freeze(
  OBD_PAGE_CATALOG.filter((e) => !e.core && e.key !== BATTERY_VOLTAGE_KEY).map((e) => e.key),
);
