/**
 * vehicleProvenance — Digital Twin'in ilk gerçek katmanı: HER SİNYALİN KAYNAK İZİ (V-12).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Vizyon belgesi kendi beyanıyla *"`UnifiedVehicleStore` gerçek Digital Twin
 * değildir — yalnız anlık sinyal aynasıdır; kimlik, history, prediction,
 * **provenance** ve lifecycle eksiktir"* diyordu. Ölçüm bunu doğruladı:
 * `UnifiedVehicleState` çıplak skalerler taşır ve `gpsSource` DIŞINDA hiçbir
 * sinyalde "bu değer NEREDEN geldi, NE ZAMAN ölçüldü" bilgisi YOKTUR.
 *
 * Sonuç: `speed` "fused" diye yazılıdır ama hangi kaynaktan geldiği okunamaz;
 * `rpm` OBD'den mi CAN'den mi bilinmez. Kaynağı bilinmeyen bir değerle KARAR
 * vermek, zero-trust telemetri ilkesinin ihlalidir.
 *
 * ── NEDEN YAN KANAL (alan başına `{value,source}` DEĞİL) ───────────────────
 * Her alanı sarmalamak, mağazayı okuyan ONLARCA bileşeni kırardı — anayasanın
 * "çok-sistemli refactor YASAK · atomik patch" kuralına aykırı. Bu katman
 * PARALEL bir defterdir: değerler olduğu gibi kalır, kaynak izi yanında
 * tutulur. Umursayan okur; umursamayan HİÇ ETKİLENMEZ.
 *
 * ── HOT-PATH GÜVENLİĞİ (pazarlıksız) ───────────────────────────────────────
 * `updateVehicleState` saniyede birkaç kez çağrılır (hız/devir). Bu yüzden:
 *  · Kayıtlar BAŞLANGIÇTA bir kez oluşturulur; sözlüğe sonradan ANAHTAR
 *    EKLENMEZ → V8 hidden-class geçişi olmaz (CLAUDE.md §Hidden Class).
 *  · Yazma yolunda TAHSİS YOKTUR: var olan kayıt YERİNDE değiştirilir.
 *  · Zaman damgası yama BAŞINA bir kez alınır, alan başına DEĞİL.
 *  · Fonksiyonlar ASLA fırlatmaz — provenance defteri veri yolunu bozamaz.
 *
 * SAF DEĞİL (modül durumu tutar) ama: I/O YOK · timer YOK · ağ YOK.
 */

/**
 * Bir değerin ÜRETİCİSİ.
 *
 * `fused` bilinçlidir: hız birden çok kaynaktan harmanlanır ve tek bir üreticiye
 * indirgenemez — "obd" demek yalan olurdu.
 */
export type ProvenanceSource =
  | 'obd'        // OBD-II poll döngüsü
  | 'can'        // CAN bus frame'i
  | 'gps'        // konum servisi
  | 'fused'      // birden çok kaynaktan harmanlanmış (tek üreticiye indirgenemez)
  | 'derived'    // başka sinyallerden hesaplanmış
  | 'persisted'  // diskten geri yüklenmiş (ölçüm DEĞİL)
  | 'unknown';   // yazan taraf bildirmedi — UYDURULMAZ

/** İzlenen sinyal anahtarları — sözlük BAŞLANGIÇTA bunlarla kurulur. */
export const PROVENANCE_KEYS = [
  'speed', 'rpm', 'fuel', 'odometer', 'reverse',
  'canRpm', 'canCoolantTemp', 'canOilTemp', 'canThrottle',
  'canBatteryVolt', 'canGearPos', 'canAmbientTemp', 'canTpmsKpa',
  'heading', 'location',
  /* P0-OBD-01 · OBD Data Bridge. TEK anahtar (sinyal başına DEĞİL) bilinçlidir:
     defter yalnız "köprü gerçekten akıyor mu" sorusuna cevap verir; sinyal
     başına yaş/kaynak zaten `obdSignalsAt` haritasında ölçülür — aynı gerçeği
     iki yerde tutmak ikinci otorite üretirdi. */
  'obdCanonical',
] as const;

export type ProvenanceKey = (typeof PROVENANCE_KEYS)[number];

export interface ProvenanceEntry {
  /** Değeri en son KİM yazdı. */
  source: ProvenanceSource;
  /** En son yazıldığı an (Unix ms). `0` = HİÇ yazılmadı ("1970" DEĞİL). */
  updatedAt: number;
  /** Kaç kez yazıldı — sinyalin gerçekten akıp akmadığının kanıtı. */
  writes: number;
}

/**
 * Kayıt sözlüğü — TÜM anahtarlarla ÖNCEDEN doldurulur.
 *
 * Alan sırası ve varlığı sabit olduğu için her kayıt AYNI hidden-class'ı
 * paylaşır; yazma yolu monomorfik kalır.
 */
const _entries: Record<string, ProvenanceEntry> = (() => {
  const m: Record<string, ProvenanceEntry> = Object.create(null);
  for (const k of PROVENANCE_KEYS) {
    m[k] = { source: 'unknown', updatedAt: 0, writes: 0 };
  }
  return m;
})();

/**
 * Bir sinyalin kaynak izini damgalar. TAHSİS YOK, O(1), ASLA fırlatmaz.
 *
 * @param key   İzlenen anahtar. Bilinmeyen anahtar SESSİZCE yok sayılır —
 *              sözlüğe yeni anahtar eklemek hidden-class geçişi üretirdi.
 * @param source Üretici.
 * @param nowMs Çağıran tarafından yama başına BİR KEZ alınan damga.
 */
export function stampProvenance(key: string, source: ProvenanceSource, nowMs: number): void {
  const e = _entries[key];
  if (e === undefined) return;          // bilinmeyen anahtar → sözlük büyümez
  e.source = source;
  e.updatedAt = nowMs;
  e.writes += 1;
}

/** Tek sinyalin izi; bilinmeyen anahtar için `null` (fail-soft). */
export function getProvenance(key: string): Readonly<ProvenanceEntry> | null {
  const e = _entries[key];
  return e === undefined ? null : e;
}

export interface ProvenanceRow {
  readonly key: string;
  readonly source: ProvenanceSource;
  readonly updatedAt: number;
  readonly writes: number;
  /** Ölçümün yaşı (ms); hiç yazılmadıysa `null` — sahte 0 YOK. */
  readonly ageMs: number | null;
}

/**
 * Tüm izlerin anlık kopyası (LAB okur).
 *
 * @param nowMs Çağıranın damgası — bu modül `Date.now()` ÇAĞIRMAZ.
 */
export function getProvenanceSnapshot(nowMs: number): readonly ProvenanceRow[] {
  const out: ProvenanceRow[] = [];
  for (const key of PROVENANCE_KEYS) {
    const e = _entries[key];
    out.push({
      key,
      source: e.source,
      updatedAt: e.updatedAt,
      writes: e.writes,
      /* HİÇ yazılmamışsa yaş HESAPLANMAZ: `nowMs - 0` 56 yıllık sahte bir
         yaş üretirdi ve "çok bayat" gibi okunurdu. */
      ageMs: e.updatedAt > 0 ? Math.max(0, nowMs - e.updatedAt) : null,
    });
  }
  return out;
}

/** @internal — testler arası izolasyon. */
export function _resetProvenanceForTest(): void {
  for (const k of PROVENANCE_KEYS) {
    const e = _entries[k];
    e.source = 'unknown';
    e.updatedAt = 0;
    e.writes = 0;
  }
}
