/**
 * routeLayerModel.ts — rota katman yığınının SAF teşhis modeli (#623).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: renk/kalınlık KARARI vermez, haritaya
 * yazmaz, ikinci bir palet kurmaz. Yalnız `routeLayerProbe`'un okuduğu GERÇEK
 * paint değerlerini `resolveRouteColor` KARARIYLA karşılaştırır ve sapmaları
 * açığa çıkarır.
 *
 * SAF: I/O yok, timer yok, `Date.now` yok, modül durumu yok, React importu yok.
 * Zaman FARKI hesabı için `nowMs` DIŞARIDAN verilir.
 *
 * Gözlemlenebilirlik sınıfları `sessionInspectorModel` sözleşmesinden gelir
 * (OBSERVED · DERIVED · UNAVAILABLE · STALE) — paralel sistem KURULMAZ.
 */

import type { Observability } from './sessionInspectorModel';
import type { RouteLayerProbe, RouteLayerPaintProbe } from '../map/routeLayerProbe';
import type { RouteColorDecision } from '../map/core/routeColorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Bayatlık eşiği — TANIMLI olmalı, yoksa STALE verilmez (kütük kuralı).
 * Rota boyası yalnız rota kurulunca/tema değişince yazılır; 5 dakikadan eski
 * bir fotoğraf "şu anki ekranın kanıtı" sayılmaz.
 * ════════════════════════════════════════════════════════════════════════ */
export const ROUTE_PROBE_FRESH_WINDOW_MS = 5 * 60 * 1000;

/** Çekirdek katmanın kimliği — `_mapState` ile AYNI dize (tek gerçek). */
const SEL = 'selected-route-layer';

export type RouteFindingSeverity = 'ROOT' | 'WARN' | 'INFO';

export interface RouteLayerFinding {
  readonly id: string;
  readonly severity: RouteFindingSeverity;
  readonly title: string;
  /** Neyin ölçüldüğü — sayı/renk içerir, genel laf DEĞİL. */
  readonly evidence: string;
}

export interface RouteLayerRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly klass: Observability;
  readonly note: string;
}

export interface RouteLayerView {
  readonly probeAgeMs: number | null;
  readonly probeKlass: Observability;
  readonly probeNote: string;
  readonly rows: readonly RouteLayerRow[];
  readonly layerRows: readonly RouteLayerRow[];
  readonly findings: readonly RouteLayerFinding[];
}

/** Ekranda gösterilecek katman adları — teknik kimlik KORUNUR (Faz A kuralı). */
const LAYER_LABEL: Readonly<Record<string, string>> = {
  'car-route-shadow':    '0 · Gölge',
  'car-route-glow-sel':  '1 · Dış Halo (glow)',
  'car-route-casing':    '2 · Kılıf (casing)',
  'selected-route-layer':'3 · Çekirdek (core)',
  'car-route-flow':      '4 · Akış (flow)',
};

const UNAVAILABLE_ROW = (id: string, label: string, note: string): RouteLayerRow => ({
  id, label, value: '—', klass: 'UNAVAILABLE', note,
});

/** WCAG bağıl parlaklık — ölçüm aracı (göz kararı DEĞİL). */
function _lin(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function hexLuminance(hex: string): number | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b);
}

function _fmtOpacity(v: number | null): string {
  return v === null ? '—' : v.toFixed(2);
}

/**
 * Tek katmanın ekranda GÖRÜNEN rengini özetle — düz renk, gradient ya da
 * "AYARLANMAMIŞ" (MapLibre varsayılanı #000000).
 */
function _colorSummary(l: RouteLayerPaintProbe): string {
  if (l.hasGradient && l.gradientStops.length > 0) return `gradient[${l.gradientStops.join(' → ')}]`;
  if (l.hasGradient) return 'gradient(durak okunamadı)';
  if (l.lineColor) return l.lineColor;
  if (l.lineColorIsExpression) return 'ifade (düz renk değil)';
  if (l.lineColorUnset) return 'AYARLANMAMIŞ → varsayılan #000000';
  return '—';
}

/**
 * TEŞHİS KURALLARI — hepsi ÖLÇÜLEN alanlardan deterministik türetilir.
 * Kanıtsız "muhtemelen" ifadesi ÜRETİLMEZ; bir kuralın girdisi yoksa bulgu
 * hiç yazılmaz (yokluk beyanı, uydurma değil).
 */
export function deriveRouteFindings(
  probe: RouteLayerProbe | null,
  decision: RouteColorDecision | null,
): readonly RouteLayerFinding[] {
  const out: RouteLayerFinding[] = [];
  if (!probe) return out;

  if (!probe.mapPresent) {
    out.push({
      id: 'no-map', severity: 'INFO',
      title: 'Harita örneği yok',
      evidence: 'Fotoğraf çekildiğinde MapLibre örneği mevcut değildi; katman okunamaz.',
    });
    return out;
  }

  const core = probe.layers.find((l) => l.id === 'selected-route-layer') ?? null;
  const flow = probe.layers.find((l) => l.id === 'car-route-flow') ?? null;
  const glow = probe.layers.find((l) => l.id === 'car-route-glow-sel') ?? null;
  const casing = probe.layers.find((l) => l.id === 'car-route-casing') ?? null;

  /* ── KÖK ADAYI 1: gradient var ama `lineMetrics` yok ──────────────────────
     MapLibre `line-gradient`i YALNIZ kaynakta `lineMetrics:true` varsa
     uygular; yoksa gradient sessizce YOK SAYILIR ve `line-color` kullanılır.
     `line-color` de ayarlanmamışsa varsayılan SİYAH çizilir. */
  if (core && core.hasGradient && probe.sourceLineMetrics === false) {
    out.push({
      id: 'gradient-without-linemetrics', severity: 'ROOT',
      title: 'Çekirdekte gradient var ama kaynakta `lineMetrics` KAPALI',
      evidence: `${SEL} gradient taşıyor (${core.gradientStops.join(' → ') || 'durak okunamadı'}) ` +
        'ama kaynağın `lineMetrics` değeri false. MapLibre bu durumda gradient\'i ' +
        'YOK SAYAR; çekirdek `line-color` ile çizilir, o da ayarlanmamışsa SİYAH olur.',
    });
  }

  /* ── KÖK ADAYI 2: çekirdek rengi hiç ayarlanmamış ────────────────────── */
  if (core && core.present && !core.hasGradient && core.lineColorUnset) {
    out.push({
      id: 'core-color-unset', severity: 'ROOT',
      title: 'Çekirdeğin `line-color` değeri AYARLANMAMIŞ',
      evidence: 'MapLibre varsayılanı #000000 (siyah) — rota gövdesi renk kararını hiç almamış.',
    });
  }

  /* ── KÖK ADAYI 3: çekirdek opaklığı düşük ───────────────────────────── */
  if (core && core.lineOpacity !== null && core.lineOpacity < 0.95) {
    out.push({
      id: 'core-opacity-low', severity: 'ROOT',
      title: 'Çekirdek opaklığı 1,00 değil',
      evidence: `line-opacity = ${core.lineOpacity.toFixed(2)} — karar `
        + `${decision ? decision.coreOpacity.toFixed(2) : 'okunamadı'} diyor. `
        + 'Çekirdek yarı saydamsa altındaki kılıf/halo/zemin karışır ve renk soluk okunur.',
    });
  }

  /* ── KÖK ADAYI 4: akış katmanı çekirdeği örtüyor ─────────────────────
     Flow, z-sırasında çekirdeğin ÜSTÜNDEDİR. Yüksek opaklıkta ve pulse
     dışında saydam olmayan bir renkle çizilirse çekirdeği maskeler. */
  if (flow && core && flow.zIndex !== null && core.zIndex !== null && flow.zIndex > core.zIndex
      && flow.lineOpacity !== null && flow.lineOpacity >= 0.5 && !flow.hasGradient) {
    out.push({
      id: 'flow-masks-core', severity: 'ROOT',
      title: 'Akış katmanı çekirdeğin üstünde ve gradient TAŞIMIYOR',
      evidence: `flow z=${flow.zIndex} > core z=${core.zIndex}, line-opacity=${flow.lineOpacity.toFixed(2)}, `
        + `renk=${_colorSummary(flow)}. Pulse gradient'i yoksa flow tüm rotayı düz renkle örter.`,
    });
  }

  /* ── UYARI: karar ile haritadaki renk UYUŞMUYOR ─────────────────────── */
  if (decision && casing && casing.lineColor
      && casing.lineColor.toLowerCase() !== decision.casing.toLowerCase()) {
    out.push({
      id: 'casing-mismatch', severity: 'WARN',
      title: 'Kılıf rengi karardan FARKLI',
      evidence: `haritada ${casing.lineColor} · karar ${decision.casing} — ikinci bir yazıcı olabilir.`,
    });
  }
  if (decision && core && core.hasGradient && core.gradientStops.length >= 1) {
    const want = decision.coreStops[0].toLowerCase();
    const got  = core.gradientStops[0].toLowerCase();
    if (want !== got) {
      out.push({
        id: 'core-gradient-mismatch', severity: 'WARN',
        title: 'Çekirdek gradient\'inin ilk durağı karardan FARKLI',
        evidence: `haritada ${core.gradientStops[0]} · karar ${decision.coreStops[0]} — `
          + 'trafik gradient\'i gibi ikinci bir yazıcı çekirdeği ezmiş olabilir.',
      });
    }
  }

  /* ── UYARI: blur çekirdeği yayıyor ──────────────────────────────────── */
  if (core && core.lineBlur !== null && core.lineBlur > 0) {
    out.push({
      id: 'core-blur', severity: 'WARN',
      title: 'Çekirdekte `line-blur` var',
      evidence: `line-blur = ${core.lineBlur} — dar bir çizgide blur merkezi de soluklaştırır.`,
    });
  }

  /* ── BİLGİ: perf-low ile gradient/lineMetrics tutarlılığı ───────────── */
  if (probe.perfLow && core && core.hasGradient) {
    out.push({
      id: 'perflow-gradient', severity: 'WARN',
      title: '`perf-low` açık ama çekirdek hâlâ gradient taşıyor',
      evidence: 'Düşük-uç yüzeyde düz renk beklenir; sınıf çalışma anında değişmiş olabilir (#599).',
    });
  }

  /* ── BİLGİ: eksik katmanlar ─────────────────────────────────────────── */
  const missing = probe.layers.filter((l) => !l.present).map((l) => l.id);
  if (missing.length > 0) {
    out.push({
      id: 'missing-layers', severity: 'INFO',
      title: 'Bazı rota katmanları haritada YOK',
      evidence: missing.join(' · ') + ' — düşük-uçta gölge/halo/akış bilerek kurulmaz.',
    });
  }
  if (glow && glow.lineOpacity !== null && glow.lineOpacity > 0.5) {
    out.push({
      id: 'glow-strong', severity: 'WARN',
      title: 'Halo opaklığı yüksek',
      evidence: `glow line-opacity = ${glow.lineOpacity.toFixed(2)} — halo çekirdeğin rengini bastırabilir.`,
    });
  }

  return out;
}

/**
 * Ekran için görünüm üret. `nowMs` DIŞARIDAN verilir (saflık).
 */
export function buildRouteLayerView(
  probe: RouteLayerProbe | null,
  decision: RouteColorDecision | null,
  nowMs: number,
): RouteLayerView {
  if (!probe) {
    return {
      probeAgeMs: null,
      probeKlass: 'UNAVAILABLE',
      probeNote: 'Rota boyası bu oturumda hiç yazılmadı — fotoğraf yok. Rota çizdirince dolar.',
      rows: [UNAVAILABLE_ROW('probe', 'Fotoğraf', 'Kaynak yok.')],
      layerRows: [],
      findings: [],
    };
  }

  const ageMs = nowMs - probe.capturedAt;
  const stale = ageMs > ROUTE_PROBE_FRESH_WINDOW_MS;

  const rows: RouteLayerRow[] = [
    {
      id: 'reason', label: 'Fotoğraf sebebi', value: probe.reason,
      klass: 'OBSERVED', note: 'Boya yazıldıktan hemen sonra alınır (tek yazıcı noktası).',
    },
    {
      id: 'map', label: 'Harita örneği',
      value: probe.mapPresent ? 'VAR' : 'YOK',
      klass: 'OBSERVED', note: 'MapLibre örneği fotoğraf anında mevcut muydu.',
    },
    {
      id: 'style', label: 'Stil yüklü',
      value: probe.styleLoaded ? 'EVET' : 'HAYIR',
      klass: 'OBSERVED', note: 'isStyleLoaded() — stil yüklenmeden paint okumaları eksik olabilir.',
    },
    {
      id: 'perflow', label: '`perf-low` yüzey',
      value: probe.perfLow ? 'AÇIK' : 'KAPALI',
      klass: 'OBSERVED', note: 'Canlı okunur; çalışma anında değişebilir (#599).',
    },
    {
      id: 'source', label: 'Rota kaynağı',
      value: probe.sourcePresent ? 'VAR' : 'YOK',
      klass: 'OBSERVED', note: 'selected-route-source.',
    },
    probe.sourceLineMetrics === null
      ? UNAVAILABLE_ROW('linemetrics', '`lineMetrics`', 'Stil sözlüğünden okunamadı.')
      : {
        id: 'linemetrics', label: '`lineMetrics`',
        value: probe.sourceLineMetrics ? 'AÇIK' : 'KAPALI',
        klass: 'OBSERVED' as Observability,
        note: '`line-gradient` için ZORUNLU. Kapalıysa gradient sessizce yok sayılır.',
      },
  ];

  if (decision) {
    rows.push({
      id: 'decision', label: 'Renk kararı (beklenen)',
      value: `kılıf ${decision.casing} · çekirdek ${decision.coreStops.join(' → ')}`,
      klass: 'OBSERVED', note: `resolveRouteColor · sebep=${decision.reason}`,
    });
    const lum = hexLuminance(decision.coreStops[0]);
    rows.push({
      id: 'decision-lum', label: 'Beklenen çekirdek parlaklığı',
      value: lum === null ? '—' : lum.toFixed(3),
      klass: lum === null ? 'UNAVAILABLE' : 'DERIVED',
      note: 'WCAG bağıl parlaklık — cihazda ölçülen 0,128–0,184 ile karşılaştır (#623).',
    });
  } else {
    rows.push(UNAVAILABLE_ROW('decision', 'Renk kararı (beklenen)',
      'resolveRouteColor okunamadı.'));
  }

  const layerRows: RouteLayerRow[] = probe.layers.map((l) => ({
    id: l.id,
    label: LAYER_LABEL[l.id] ?? l.id,
    value: l.present
      ? `${_colorSummary(l)} · opaklık ${_fmtOpacity(l.lineOpacity)}`
        + (l.lineBlur !== null ? ` · blur ${l.lineBlur}` : '')
        + (l.zIndex !== null ? ` · z=${l.zIndex}` : '')
      : 'KATMAN YOK',
    klass: l.present ? 'OBSERVED' : 'UNAVAILABLE',
    note: l.present
      ? (l.widthIsExpression ? 'Kalınlık ifadeyle (politika).' : 'Kalınlık düz sayı.')
      : 'Düşük-uçta gölge/halo/akış bilerek kurulmaz.',
  }));

  return {
    probeAgeMs: ageMs,
    probeKlass: stale ? 'STALE' : 'OBSERVED',
    probeNote: stale
      ? `Fotoğraf ${Math.round(ageMs / 1000)} sn önce alındı — ${Math.round(ROUTE_PROBE_FRESH_WINDOW_MS / 1000)} sn eşiğini aştı.`
      : `Fotoğraf ${Math.round(ageMs / 1000)} sn önce alındı.`,
    rows,
    layerRows,
    findings: deriveRouteFindings(probe, decision),
  };
}
