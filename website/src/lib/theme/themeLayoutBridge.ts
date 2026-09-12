/**
 * themeLayoutBridge — Tema Manifesti ile mevcut `layoutSolver` arasındaki köprü (PWA).
 *
 * BU DOSYA YENİ BİR YERLEŞİM MOTORU DEĞİLDİR. Tek işi, Stüdyo'nun yerleşim
 * arayüzüne solver'ın GERÇEK verisini (bölge · varsayılan boyut · kilit · sıra)
 * okutmaktır. Çözümü hâlâ `layoutSolver.solveLayout` yapar — burada kopyası yok.
 *
 * Parite dışıdır (araç tarafında karşılığı yoktur): araçta zaten solver'ın
 * kendisi var; PWA'nın tek ihtiyacı manifest girdilerini OKUMAK.
 */

import {
  EXPEDITION_MANIFEST,
  PRO_MANIFEST,
  HORIZON_MANIFEST,
  TESLA_MANIFEST,
  defaultIntent,
  normalizeIntent,
  solveLayout,
  type Manifest,
  type ManifestEntry,
  type Zone,
} from '@/lib/layoutSolver';
import { manifestToLayoutIntent, type ThemeBaseId, type ThemeManifest } from './themeManifest';
import { isLayoutCapableTheme } from './themeComponentRegistry';

/** Bölge adlarının Türkçe karşılığı (yalnız gösterim). */
export const ZONE_LABEL: Record<Zone, string> = {
  'left-rail': 'Sol Ray',
  'center-stage': 'Orta Sahne',
  'right-rail': 'Sağ Ray',
  dock: 'Dock',
};

/**
 * Temanın solver manifesti. Solver kullanmayan tema için `null` — arayüz
 * yerleşim bölümünü hiç göstermez, sahte kart üretmez.
 *
 * #660: Horizon ve Tesla da solver'a bağlandı. Kapı hâlâ
 * `isLayoutCapableTheme`dir (kod gerçeği); burada ikinci bir liste TUTULMAZ —
 * yeni bir tema yetenekli olur da buraya eklenmezse `null` döner ve arayüz
 * yerleşimi göstermez (fail-closed: sahte alan yerine hiç alan).
 */
export function solverManifestFor(themeId: ThemeBaseId): Manifest | null {
  if (!isLayoutCapableTheme(themeId)) return null;
  if (themeId === 'pro') return PRO_MANIFEST;
  if (themeId === 'expedition') return EXPEDITION_MANIFEST;
  if (themeId === 'horizon') return HORIZON_MANIFEST;
  if (themeId === 'tesla') return TESLA_MANIFEST;
  return null;
}

/** Bir solver kartının manifest girdisi (bölge/varsayılan boyut/kilit/öncelik). */
export function solverEntry(themeId: ThemeBaseId, cardId: string): ManifestEntry | null {
  const man = solverManifestFor(themeId);
  if (!man) return null;
  return man.find((e) => e.id === cardId) ?? null;
}

export interface SolvedPreviewItem {
  id: string;
  label: string;
  zone: Zone;
  size: 'S' | 'M' | 'L';
  grow: number;
  locked: boolean;
}

/**
 * Manifest yerleşimini GERÇEK solver'dan geçirip sonucu döndürür.
 * Stüdyo bunu "önce/sonra" göstermek ve sıralamayı doğrulamak için kullanır;
 * hesabı yapan `solveLayout`tur.
 */
export function solvePreview(
  themeId: ThemeBaseId,
  m: ThemeManifest,
): { zones: { zone: Zone; items: SolvedPreviewItem[]; overflow: string[] }[] } | null {
  const man = solverManifestFor(themeId);
  if (!man) return null;
  const intent = normalizeIntent(manifestToLayoutIntent(m), man);
  const solved = solveLayout(intent, man);
  const labelOf = (id: string) => man.find((e) => e.id === id)?.label ?? id;
  const lockedOf = (id: string) => man.find((e) => e.id === id)?.locked === true;
  const zones = (Object.keys(solved) as Zone[]).map((zone) => ({
    zone,
    items: solved[zone].items.map((it) => ({
      id: it.id,
      label: labelOf(it.id),
      zone,
      size: it.size,
      grow: it.grow,
      locked: lockedOf(it.id),
    })),
    overflow: solved[zone].overflow,
  }));
  return { zones };
}

/** Solver'ın bu tema için ürettiği FABRİKA niyeti (karşılaştırma/varsayılan gösterimi). */
export function solverDefaultIntent(themeId: ThemeBaseId) {
  const man = solverManifestFor(themeId);
  return man ? defaultIntent(man) : null;
}
