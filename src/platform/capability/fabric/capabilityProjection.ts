/**
 * capabilityProjection.ts — **MAVİ F5 · BAĞLAMA GÖRE DARALTILMIŞ YETENEK YÜZEYİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Mavi'nin "ne yapabilirim" bilgisi artık katalogdan TÜRETİLİR. Ama her turda
 * bütün katalogu prompt'a dökmek iki şeyi birden bozar: prompt bütçesi şişer ve
 * model alakasız işlemleri önermeye başlar. Bu dosya, isteğin bağlamına göre
 * **daraltılmış** bir yüzey üretir.
 *
 * ── SINIR (çok önemli) ──────────────────────────────────────────────────────
 * Projeksiyon bir **GÜVENLİK KAPISI DEĞİLDİR.** Daraltma yalnız prompt
 * bütçesi ve öneri kalitesi içindir. Yüzey ne kadar geniş olursa olsun yetki
 * DEĞİŞMEZ: doğrulama `capabilityResolver`, availability/izin `capabilityFabric`,
 * güvenlik ve onay `maviActionAuthority` + `AiSafetyGate` tarafından uygulanır.
 * Bu yüzden "geniş projeksiyon" bir fail-open DEĞİLDİR — yetki hattı ayrıdır.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** yalnız tip + katalog import eder; I/O · timer · `Date.now` ·
 *    global durum YOK.
 *  · **BOUNDED:** eşleşme sözlüğü sabittir; kullanıcı metni SAKLANMAZ ve
 *    çıktıya KOPYALANMAZ (yalnız hangi alanların açıldığı döner).
 */

import type { CapabilityOperationDef, FabricDomain } from './capabilityContract';
import { CAROS_CAPABILITY_CATALOG } from './carosCapabilityCatalog';

/**
 * Alan ipucu sözlüğü — Türkçe kök/gövde eşleşmesi (ASR çıktısı kusurludur,
 * bu yüzden tam sözcük değil GEÇME kontrolü yapılır). Liste BOUNDED'dır ve
 * kullanıcı metni buraya YAZILMAZ.
 */
const DOMAIN_HINTS: Readonly<Record<FabricDomain, readonly string[]>> = Object.freeze({
  navigation: Object.freeze([
    'git', 'gide', 'götür', 'gotur', 'rota', 'harita', 'navigasyon', 'yol',
    'adres', 'benzin', 'akaryakıt', 'akaryakit', 'otopark', 'park yeri',
    'dinlenme', 'yakın', 'yakin', 'nerede', 'restoran', 'kafe', 'eczane',
  ]),
  media: Object.freeze([
    /* Türkçe ÜNSÜZ YUMUŞAMASI: "müziği" içinde "müzik" GEÇMEZ (k→ğ). Bu yüzden
       ipucu gövdeye ("müzi") indirilir — ek ne olursa olsun yakalanır. */
    'müzi', 'muzi', 'şarkı', 'sarki', 'çal', 'cal', 'dinle', 'ses',
    'duraklat', 'durdur', 'sonraki', 'önceki', 'onceki', 'parça', 'parca',
    'radyo', 'spotify',
  ]),
  settings: Object.freeze([
    'ayar', 'parlaklık', 'parlaklik', 'wifi', 'bluetooth', 'tema', 'gece',
    'mod', 'ekran', 'kıs', 'kis',
  ]),
  vehicle: Object.freeze([
    'motor', 'yağ', 'yag', 'su', 'sıcaklık', 'sicaklik', 'devir', 'rpm',
    'akü', 'aku', 'voltaj', 'yakıt', 'yakit', 'depo', 'kilometre', 'sağlık',
    'saglik', 'bakım', 'bakim', 'şasi', 'sasi', 'vin', 'sensör', 'sensor',
  ]),
  diagnostics: Object.freeze([
    'arıza', 'ariza', 'hata kodu', 'dtc', 'tanılama', 'tanilama',
  ]),
  phone: Object.freeze([
    'ara', 'arama', 'telefon', 'çağrı', 'cagri', 'rehber',
  ]),
  surface: Object.freeze([
    'aç', 'ac', 'kapat', 'uygulama', 'panel', 'favori', 'ekranı', 'ekrani',
  ]),
});

export interface CapabilityProjection {
  /** Açılan alanlar. */
  readonly domains: readonly FabricDomain[];
  /** Beyne sunulacak işlemler (yalnız `exposedToBrain`). */
  readonly operations: readonly CapabilityOperationDef[];
  /**
   * Daraltma GERÇEKTEN yapılabildi mi. `false` → ipucu bulunamadı ve tam yüzey
   * döndü. Bu bir kusur DEĞİL, dürüst bir bildirimdir (bugünkü davranışla aynı).
   */
  readonly narrowed: boolean;
}

/** Metinden alan ipuçlarını çıkarır. Metin SAKLANMAZ. */
export function detectDomains(text: string): readonly FabricDomain[] {
  if (typeof text !== 'string' || text.length === 0) return Object.freeze([]);
  const t = text.toLocaleLowerCase('tr-TR');
  const hit: FabricDomain[] = [];
  for (const [domain, hints] of Object.entries(DOMAIN_HINTS) as [FabricDomain, readonly string[]][]) {
    for (const h of hints) {
      if (t.includes(h)) { hit.push(domain); break; }
    }
  }
  return Object.freeze(hit);
}

/**
 * Bağlama göre yüzey üretir.
 *
 * `surface` alanı bilinçli olarak GENİŞ eşleşir ("aç"/"kapat" hemen her komutta
 * geçer). Tek başına `surface` eşleşmesi daraltma SAYILMAZ — aksi hâlde
 * "müziği aç" isteğinde medya işlemleri yüzeyden düşerdi.
 */
export function projectCapabilities(
  text: string,
  catalog: readonly CapabilityOperationDef[] = CAROS_CAPABILITY_CATALOG,
): CapabilityProjection {
  const exposed = catalog.filter((d) => d.exposedToBrain && d.legacyIntent !== null);
  try {
    const domains = detectDomains(text);
    const meaningful = domains.filter((d) => d !== 'surface');
    if (meaningful.length === 0) {
      return Object.freeze({
        domains: Object.freeze([] as FabricDomain[]),
        operations: Object.freeze(exposed),
        narrowed: false,
      });
    }
    /* `surface` daima yüzeyde kalır: her alanda "ekranı aç" meşru bir istektir. */
    const open = new Set<FabricDomain>([...meaningful, 'surface']);
    const operations = exposed.filter((d) => open.has(d.domain));
    return Object.freeze({
      domains: Object.freeze([...open]),
      operations: Object.freeze(operations),
      narrowed: true,
    });
  } catch {
    // FAIL-SOFT: daraltma düşerse tam yüzey döner (yetki hattı etkilenmez).
    return Object.freeze({
      domains: Object.freeze([] as FabricDomain[]),
      operations: Object.freeze(exposed),
      narrowed: false,
    });
  }
}

/**
 * Projeksiyondan **tek satırlık** prompt bloğu üretir. Katalog tanımı prompt'ta
 * TEKRAR EDİLMEZ — tek kaynak katalogdur (F5 §11: aynı tanımı üç yerde
 * kopyalama yasağı).
 */
export function renderProjectionLines(p: CapabilityProjection): readonly string[] {
  const out: string[] = [];
  for (const d of p.operations) {
    const req = Object.entries(d.parameters)
      .filter(([, s]) => s.required === true)
      .map(([n]) => n);
    out.push(req.length > 0
      ? `${d.legacyIntent} — ${d.description} (zorunlu: ${req.join(', ')})`
      : `${d.legacyIntent} — ${d.description}`);
  }
  return Object.freeze(out);
}
