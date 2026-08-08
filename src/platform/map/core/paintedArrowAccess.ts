/**
 * paintedArrowAccess.ts — boyanmış okun SALT-OKUNUR gözlem yüzeyi (yaprak modül).
 *
 * ── NEDEN AYRI DOSYA (bağımlılık TERS ÇEVRİLDİ) ────────────────────────────
 * Gözlem verisi `MapLayerManager` içinde yaşasaydı, CAROS LAB onu okumak için
 * o modülü — dolayısıyla `maplibre-gl` grafiğinin tamamını — import etmek
 * zorunda kalırdı. LAB ekranları salt-okunur ve hafif olmalıdır; ağır servisi
 * teşhis grafiğine sokmak daha önce ölçülmüş bir hatadır (Trip/Mavi Konum
 * turlarındaki `*Access` deseniyle aynı gerekçe).
 *
 * Bu modül YAPRAKTIR: hiçbir ağır şey import etmez. Yazan taraf haritadır,
 * okuyan taraf LAB'dır; ikisi birbirini tanımaz.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Koordinat · sokak adı · hedef · manevra metni BURAYA TAŞINMAZ. Yalnız hüküm
 * (görünür mü), gerekçe (neden değil) ve sayaçlar tutulur.
 */

import { PAINTED_ARROW_POLICY_VERSION } from './paintedArrowModel';
import type { PaintedArrowHiddenReason } from './paintedArrowModel';

export interface PaintedArrowDiagnostics {
  /** Ok şu an çiziliyor mu. */
  readonly visible: boolean;
  /** Son hükmün gerekçesi — 'SHOWN' ya da gizlenme sebebi. */
  readonly reason: 'SHOWN' | PaintedArrowHiddenReason | 'NOT_EVALUATED';
  /** Kaç kez GÖRÜNÜR duruma geçti. */
  readonly shownCount: number;
  /** Kaç kez hüküm DEĞİŞTİ — dedup çalışıyorsa fix sayısından çok küçüktür. */
  readonly appliedCount: number;
  /** Katman haritada kurulu mu (stil reload sonrası false'a düşer). */
  readonly layerPresent: boolean;
  readonly policyVersion: string;
}

const _state = {
  visible: false,
  reason: 'NOT_EVALUATED' as PaintedArrowDiagnostics['reason'],
  shownCount: 0,
  appliedCount: 0,
  layerPresent: false,
};

/** Harita katmanı tarafından çağrılır — hüküm DEĞİŞTİĞİNDE. */
export function _recordPaintedArrowVerdict(
  visible: boolean,
  reason: PaintedArrowDiagnostics['reason'],
): void {
  _state.appliedCount++;
  _state.visible = visible;
  _state.reason = reason;
  if (visible) _state.shownCount++;
}

/** Katman kuruldu / stil reload'da gitti. */
export function _recordPaintedArrowLayer(present: boolean): void {
  _state.layerPresent = present;
}

/** CAROS LAB okuma ucu — senkron, yan etkisiz. */
export function readPaintedArrowDiagnostics(): PaintedArrowDiagnostics {
  return {
    visible:       _state.visible,
    reason:        _state.reason,
    shownCount:    _state.shownCount,
    appliedCount:  _state.appliedCount,
    layerPresent:  _state.layerPresent,
    policyVersion: PAINTED_ARROW_POLICY_VERSION,
  };
}

/** Yalnız testler için — sayaçları sıfırlar. */
export function _resetPaintedArrowDiagnosticsForTest(): void {
  _state.visible = false;
  _state.reason = 'NOT_EVALUATED';
  _state.shownCount = 0;
  _state.appliedCount = 0;
  _state.layerPresent = false;
}
