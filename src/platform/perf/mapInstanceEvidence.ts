/**
 * mapInstanceEvidence — ARCH-06/F3 · MAPLIBRE ÖRNEK YAŞAM DÖNGÜSÜ KANITI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F0'ın açık sorusu şuydu: **FullMapView ve MiniMapWidget aynı anda iki
 * MapLibre (WebGL) bağlamı yaşatıyor mu?** Mali-400 sınıfı bir GPU'da iki
 * canlı harita bağlamı render hedefini tüketir ve dokunma gecikmesi üretir.
 *
 * F3'te repo okundu ve cevap ÖLÇÜLDÜ: **hayır — mimari bunu zaten
 * engelliyor.** Ama "engelliyor" bir İDDİADIR; bu modül onu ÖLÇÜME çevirir
 * ve bir regresyon sessizce geri gelirse `peakConcurrent` bunu gösterir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **HARİTA SAHİBİ DEĞİLDİR.** Hiçbir haritayı kurmaz, yıkmaz, gizlemez.
 *     Yaşam döngüsü bileşende/`MapCore`ta KALIR.
 * (2) **HARİTA NESNESİ TUTMAZ.** Yalnız sayı sayar — bir `Map` referansı
 *     saklamak, yıkılmış bir bağlamı canlı tutup TAM OLARAK önlemeye
 *     çalıştığımız sızıntıyı üretirdi.
 * (3) **KARAR VERMEZ.** "İki harita çok" demez; sayıyı verir, hüküm LAB
 *     okuyucusunundur.
 */

/** Örneğin hangi yüzeye ait olduğu — yalnız sınıf, referans DEĞİL. */
export type MapSurfaceKind = 'FULL' | 'MINI' | 'TRAFFIC' | 'UNKNOWN';

export interface MapInstanceEvidence {
  /** ŞU AN canlı olan MapLibre bağlamı sayısı. */
  readonly active: number;
  /** Oturum boyunca görülen EN YÜKSEK eşzamanlı sayı. */
  readonly peakConcurrent: number;
  readonly createdTotal: number;
  readonly destroyedTotal: number;
  /** Yüzey sınıfına göre oluşturma adedi. */
  readonly createdByKind: Readonly<Record<MapSurfaceKind, number>>;
  /**
   * `peakConcurrent > 1` GÖZLENDİ mi. Bu bir ARIZA BEYANI DEĞİLDİR: geçiş
   * anında kısa bir örtüşme normal olabilir. Yalnız "oldu mu" der.
   */
  readonly concurrentObserved: boolean;
  readonly provenance: readonly string[];
}

const KINDS: readonly MapSurfaceKind[] = Object.freeze(['FULL', 'MINI', 'TRAFFIC', 'UNKNOWN']);

let _active = 0;
let _peak = 0;
let _created = 0;
let _destroyed = 0;
const _byKind: Record<MapSurfaceKind, number> = (() => {
  const o = {} as Record<MapSurfaceKind, number>;
  for (const k of KINDS) o[k] = 0;
  return o;
})();

/**
 * Bir MapLibre bağlamı KURULDU. Tek işlem: iki tamsayı artırımı ve bir
 * karşılaştırma — T0 bütçesine uygun.
 */
export function noteMapInstanceMounted(kind: MapSurfaceKind = 'UNKNOWN'): void {
  _created += 1;
  _active += 1;
  if (_active > _peak) _peak = _active;
  const cur = _byKind[kind];
  if (cur !== undefined) _byKind[kind] = cur + 1;
}

/**
 * Bir MapLibre bağlamı YIKILDI.
 *
 * `_active` asla negatife düşmez: yıkım yolu iki kez çağrılabilir
 * (`destroyMap` + orphan temizliği) ve negatif bir sayaç "eksi bir harita"
 * gibi anlamsız bir kanıt üretirdi.
 */
export function noteMapInstanceUnmounted(): void {
  _destroyed += 1;
  if (_active > 0) _active -= 1;
}

/** Salt-okunur projeksiyon. Hiçbir haritaya dokunmaz. */
export function getMapInstanceEvidence(): MapInstanceEvidence {
  return Object.freeze({
    active: _active,
    peakConcurrent: _peak,
    createdTotal: _created,
    destroyedTotal: _destroyed,
    createdByKind: Object.freeze({ ..._byKind }),
    concurrentObserved: _peak > 1,
    provenance: Object.freeze([
      'mapInstanceEvidence — MapCore kurulum/yıkım yollarından sayılır',
      'harita nesnesi TUTULMAZ; yalnız sayılar',
    ]),
  });
}

/** @internal YALNIZ TEST. */
export function _resetMapInstanceEvidenceForTest(): void {
  _active = 0; _peak = 0; _created = 0; _destroyed = 0;
  for (const k of KINDS) _byKind[k] = 0;
}
