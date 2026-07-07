/**
 * Yerleşim Motoru (Layout Solver) — araç tarafı.
 * PWA'daki website/src/lib/layoutSolver.ts ile BİREBİR aynı kurallar (senkron tutulmalı).
 *
 * İlke: kullanıcı NİYET söyler (sıra + boyut + göster/gizle), solver GEOMETRİYİ çözer.
 * Çıktı piksel değil FLOW modeli (flex-grow ağırlığı) → her ekranda kendi kendine oturur.
 * Güvenlik: locked kart gizlenemez/taşmaz.
 *
 * Öncelikler MEVCUT görsel sırayı üretir (geri-uyum): defaultIntent → sol ray
 * clock>gauge>settings, sağ ray music>vehicle. Böylece hiç özelleştirme
 * yapılmamışsa ekran BUGÜNKÜYLE AYNI görünür.
 *
 * ÇOK-TEMA: solveLayout/defaultIntent/normalizeIntent bir `manifest` alır
 * (varsayılan PRO_MANIFEST — geri-uyum). Her tema (Pro/Expedition/…) kendi
 * kart kümesini kendi manifest'iyle çözer; niyet ham blob olarak saklanır,
 * her tema OKUMA anında kendi manifest'ine göre normalize eder → temalar
 * birbirinin kartını ezmez.
 */

export type Zone = 'left-rail' | 'center-stage' | 'right-rail' | 'dock';
export const ZONES: readonly Zone[] = ['left-rail', 'center-stage', 'right-rail', 'dock'];

export type SizeClass = 'S' | 'M' | 'L';
export const SIZES: readonly SizeClass[] = ['S', 'M', 'L'];

export interface ManifestEntry {
  id: string;
  label: string;
  zone: Zone;
  size: SizeClass;
  priority: number;
  locked?: boolean;
}

export type Manifest = ManifestEntry[];

/** ProLayout'un gerçek kartları. priority = varsayılan görsel sıra (desc). */
export const PRO_MANIFEST: Manifest = [
  { id: 'clock',    label: 'Saat',         zone: 'left-rail',    size: 'S', priority: 90 },
  { id: 'gauge',    label: 'Hız & Menzil', zone: 'left-rail',    size: 'L', priority: 80, locked: true },
  { id: 'settings', label: 'Ayarlar',      zone: 'left-rail',    size: 'S', priority: 30 },
  { id: 'nav',      label: 'Harita',       zone: 'center-stage', size: 'L', priority: 90, locked: true },
  { id: 'music',    label: 'Müzik',        zone: 'right-rail',   size: 'M', priority: 70 },
  { id: 'vehicle',  label: 'Araç Durumu',  zone: 'right-rail',   size: 'L', priority: 65 },
  { id: 'dock',     label: 'Dock',         zone: 'dock',         size: 'L', priority: 100, locked: true },
];

/** ExpeditionLayout'un gerçek kartları (bolted-metal cockpit).
 *  Sol ray: SpeedPlate (saat+hız+telltale, güvenlik → locked) + RangePlate (menzil/km).
 *  Orta: MapPlate (harita → locked). Sağ ray: MusicPlate + VehiclePlate. */
export const EXPEDITION_MANIFEST: Manifest = [
  { id: 'speed',   label: 'Hız & Saat',   zone: 'left-rail',    size: 'L', priority: 90, locked: true },
  { id: 'range',   label: 'Menzil',       zone: 'left-rail',    size: 'M', priority: 70 },
  { id: 'map',     label: 'Harita',       zone: 'center-stage', size: 'L', priority: 90, locked: true },
  { id: 'music',   label: 'Müzik',        zone: 'right-rail',   size: 'M', priority: 70 },
  { id: 'vehicle', label: 'Araç Durumu',  zone: 'right-rail',   size: 'L', priority: 65 },
  { id: 'dock',    label: 'Dock',         zone: 'dock',         size: 'L', priority: 100, locked: true },
];

export const GROW_BY_SIZE: Record<SizeClass, number> = { S: 1, M: 2, L: 3 };
export const ZONE_CAPACITY: Record<Zone, number> = {
  'left-rail': 4, 'center-stage': 3, 'right-rail': 3, 'dock': 16,
};

/** Kullanıcı niyeti — sürükle→ord, köşe-çek→growCustom, göz→visible, boyut→size. */
export interface CardIntent {
  visible: boolean;
  size: SizeClass;
  /** zone içi sıra — küçük = önce */
  ord: number;
  /** elle boyut (grow ağırlığı); null → size'dan türetilir */
  growCustom: number | null;
}
export type LayoutIntent = Record<string, CardIntent>;

export interface SolvedItem { id: string; size: SizeClass; grow: number; }
export interface SolvedZone { items: SolvedItem[]; overflow: string[]; }
export type SolvedLayout = Record<Zone, SolvedZone>;

/** manifest → id→entry haritası (locked/zone/size sorguları için). */
function manifestMap(manifest: Manifest): Record<string, ManifestEntry> {
  const m: Record<string, ManifestEntry> = {};
  manifest.forEach((e) => { m[e.id] = e; });
  return m;
}

/** Varsayılan niyet: her zone içinde priority desc → ord (mevcut ekran sırası). */
export function defaultIntent(manifest: Manifest = PRO_MANIFEST): LayoutIntent {
  const byZone: Record<string, ManifestEntry[]> = {};
  ZONES.forEach((z) => (byZone[z] = []));
  manifest.forEach((m) => byZone[m.zone].push(m));
  const intent: LayoutIntent = {};
  Object.values(byZone).forEach((list) => {
    list.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    list.forEach((m, i) => {
      intent[m.id] = { visible: true, size: m.size, ord: i, growCustom: null };
    });
  });
  return intent;
}

/** Eksik/bozuk niyeti varsayılanla tamamla (zero-trust — bilinmeyen id atılır, locked gizlenemez). */
export function normalizeIntent(raw: unknown, manifest: Manifest = PRO_MANIFEST): LayoutIntent {
  const base = defaultIntent(manifest);
  const MAP = manifestMap(manifest);
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  for (const id of Object.keys(base)) {
    const c = obj[id];
    if (!c || typeof c !== 'object') continue;
    const cc = c as Record<string, unknown>;
    const size = SIZES.includes(cc.size as SizeClass) ? (cc.size as SizeClass) : base[id].size;
    const ord = Number.isFinite(cc.ord) ? Number(cc.ord) : base[id].ord;
    const gc = cc.growCustom;
    const growCustom = gc === null
      ? null
      : (Number.isFinite(gc) ? Math.max(0.5, Math.min(5, Number(gc))) : base[id].growCustom);
    const locked = !!MAP[id]?.locked;
    const visible = locked ? true : (typeof cc.visible === 'boolean' ? cc.visible : base[id].visible);
    base[id] = { visible, size, ord, growCustom };
  }
  return base;
}

function growOf(id: string, intent: LayoutIntent): number {
  const c = intent[id];
  return c.growCustom != null ? c.growCustom : GROW_BY_SIZE[c.size];
}

/** Niyet → çözülmüş flow layout. Deterministik; locked gizlenemez/taşmaz. */
export function solveLayout(intent: LayoutIntent, manifest: Manifest = PRO_MANIFEST): SolvedLayout {
  const byZone: Record<Zone, ManifestEntry[]> = {} as Record<Zone, ManifestEntry[]>;
  ZONES.forEach((z) => (byZone[z] = []));
  manifest.forEach((m) => byZone[m.zone].push(m));

  const out = {} as SolvedLayout;
  for (const z of ZONES) {
    const sorted = byZone[z].slice().sort(
      (a, b) => (intent[a.id]?.ord ?? 0) - (intent[b.id]?.ord ?? 0) || a.id.localeCompare(b.id),
    );
    const items: SolvedItem[] = [];
    const overflow: string[] = [];
    let count = 0;
    for (const m of sorted) {
      const c = intent[m.id];
      if (c && !c.visible && !m.locked) continue;
      if (count >= ZONE_CAPACITY[z] && !m.locked) { overflow.push(m.id); continue; }
      items.push({ id: m.id, size: c?.size ?? m.size, grow: growOf(m.id, intent) });
      count++;
    }
    out[z] = { items, overflow };
  }
  return out;
}
