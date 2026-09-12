/**
 * vectorTileTemplate — ürünün ÇİZDİĞİ vektör karo şablonunu ÇÖZER.
 *
 * ── NEDEN SABİT YAZILAMAZ (V-07'nin kalbi) ─────────────────────────────────
 * Sağlayıcılar karo yoluna VERİ SÜRÜMÜ DAMGASI koyar. OpenFreeMap örneği:
 *   https://tiles.openfreemap.org/planet/20260802_080001_pt/{z}/{x}/{y}.pbf
 *                                        └─ her veri tazelemesinde DEĞİŞİR
 * Şablonu koda gömmek, sağlayıcı veriyi tazelediği gün haritayı sessizce
 * kırardı. `mapStyleBuilders` bu yüzden TileJSON ucunu MapLibre'ye verir ve
 * gerçek adresi O çözer. Çevrimdışı paket indirmesi AYNI adresi kullanmak
 * ZORUNDADIR — yoksa indirilen karo hiç istenmeyen bir adrese yazılır ve
 * paket sessizce işe yaramaz (tam olarak V-07'nin bulduğu kusur).
 *
 * ── SONUÇ: PAKETLER SÜRÜM DAMGASINA BAĞLIDIR ───────────────────────────────
 * Sağlayıcı veriyi tazeleyince ÖNCEDEN indirilmiş karolar eski adreste kalır
 * ve bir daha istenmez — paket ölür. Bu bir kusur değil, bu mimarinin
 * KAÇINILMAZ sonucudur; ürün bunu kullanıcıya söylemek zorundadır
 * ("paket şu tarihli veriye ait"). Gizlenirse kullanıcı çevrimdışı kalıp
 * boş harita görür ve nedenini bilemez.
 *
 * SAF DEĞİL (ağ okur) ama: timer YOK · abonelik YOK · global durum YOK.
 */

/** Çözülmüş şablon ve onu üreten kaynak. */
export interface VectorTileTemplate {
  /** `{z}/{x}/{y}` içeren tam karo adresi. */
  readonly template: string;
  /** Sağlayıcının bildirdiği sınırlar — paket bunları AŞMAMALI. */
  readonly minzoom: number;
  readonly maxzoom: number;
  /**
   * Şablon TileJSON'dan mı geldi yoksa doğrudan env şablonu mu.
   * `tilejson` ise adres SÜRÜM DAMGALI olabilir (bkz. başlık).
   */
  readonly source: 'tilejson' | 'template';
  /** TileJSON ucundan okunan sürüm/tarih ipucu — yoksa `null`. */
  readonly versionHint: string | null;
}

const TILEJSON_TIMEOUT_MS = 10_000;

/** URL'den sürüm damgası benzeri bir yol parçası çıkarır (yoksa `null`). */
export function extractVersionHint(url: string): string | null {
  /* OpenFreeMap deseni: `/planet/20260802_080001_pt/{z}/...` — 8 haneli tarih
     ile başlayan yol parçası. Uydurma YAPILMAZ: eşleşmezse `null`. */
  const m = url.match(/\/(\d{8}_\d{6}[a-z_]*)\//i);
  return m ? m[1] : null;
}

/**
 * Şablonu çözer. Ağ yoksa veya uç bozuksa `null` — SAHTE ŞABLON ÜRETİLMEZ
 * (yanlış adrese indirmek, hiç indirmemekten kötüdür: kullanıcı paketi var
 * sanır).
 */
export async function resolveVectorTileTemplate(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<VectorTileTemplate | null> {
  const url = (rawUrl ?? '').trim();
  if (!url) return null;

  /* Doğrudan şablon verilmişse TileJSON'a hiç gitme. */
  if (url.includes('{z}')) {
    return {
      template: url,
      minzoom: 0,
      maxzoom: 14,
      source: 'template',
      versionHint: extractVersionHint(url),
    };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TILEJSON_TIMEOUT_MS);
    /* Çağıranın iptali de geçerli olmalı. */
    signal?.addEventListener('abort', () => ctrl.abort(), { once: true });

    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const json = await res.json() as {
      tiles?: unknown; minzoom?: unknown; maxzoom?: unknown;
    };

    const tiles = Array.isArray(json.tiles) ? json.tiles : [];
    const first = tiles.find((t) => typeof t === 'string' && t.includes('{z}'));
    if (typeof first !== 'string') return null;

    const minzoom = typeof json.minzoom === 'number' ? json.minzoom : 0;
    const maxzoom = typeof json.maxzoom === 'number' ? json.maxzoom : 14;

    return {
      template: first,
      minzoom,
      maxzoom,
      source: 'tilejson',
      versionHint: extractVersionHint(first),
    };
  } catch {
    return null;
  }
}

/** Şablonu somut adrese çevirir. Saf. */
export function tileUrlFrom(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}
