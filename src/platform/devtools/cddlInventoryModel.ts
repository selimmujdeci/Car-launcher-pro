/**
 * cddlInventoryModel.ts — CDDL ENVANTERİ'nin SAF görünüm modeli (P0-VDK-F3B).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: profil yüklemez, doğrulama yapmaz,
 * "hazır/değil" kararını KENDİ üretmez. `cddlInventorySources` ölçümlerini
 * SINIFLANDIRIR ve fail-closed bir hüküm türetir.
 *
 * PARALEL MİMARİ YOK: gözlemlenebilirlik ilkelleri `sessionInspectorModel`den
 * AYNEN yeniden kullanılır (`OBSERVED · DERIVED · UNAVAILABLE · STALE`).
 *
 * ── DÜRÜSTLÜK KURALLARI ────────────────────────────────────────────────────
 *  · Belge kurulamadıysa sayaçlar `0` DEĞİL, KAYNAK YOK'tur.
 *  · Doğrulama kusuru GİZLENMEZ; ilk sekizi adıyla gösterilir.
 *  · `learned`/`byod` sayısı sıfırdan farklıysa bu bir UYARIDIR: bu fazda
 *    ürün yoluna girmemeleri gerekir.
 *  · Ürün kapısı (`getProductOemProfiles`) gevşediyse AÇIKÇA görünür.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · modül durumu yok.
 */

import {
  observed, derived, unavailable,
  type InspectorField,
} from './sessionInspectorModel';
import type { CddlInventorySnapshot } from './cddlInventorySources';

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type CddlVerdict =
  /** Belge kuruldu, doğrulandı, yalnız `builtin` kaynak var. */
  | 'VALID'
  /** Belge kuruldu ama doğrulama DÜŞTÜ. */
  | 'INVALID'
  /** Doğrulama geçti ama güvenilmeyen kaynak (learned/byod) GÖRÜLDÜ. */
  | 'UNTRUSTED_SOURCE_PRESENT'
  /** Belge kurulamadı — okuma başarısız. */
  | 'UNAVAILABLE'
  /** Sınıflandırılamadı — fail-closed. */
  | 'UNKNOWN';

export const CDDL_VERDICT_LABEL: Readonly<Record<CddlVerdict, string>> = {
  VALID:                    'GEÇERLİ — belge doğrulandı, yalnız builtin kaynak',
  INVALID:                  'GEÇERSİZ — doğrulama düştü',
  UNTRUSTED_SOURCE_PRESENT: 'UYARI — learned/BYOD kaynak GÖRÜLDÜ (bu fazda ürün yoluna GİREMEZ)',
  UNAVAILABLE:              'OKUNAMADI — belge kurulamadı',
  UNKNOWN:                  'BİLİNMİYOR — fail-closed',
} as const;

/**
 * Hüküm — **fail-closed**. Sıra bilinçli: en kesin kusur önce.
 */
export function deriveCddlVerdict(s: CddlInventorySnapshot): CddlVerdict {
  if (!s.documentBuilt) return 'UNAVAILABLE';
  if (s.valid === null) return 'UNKNOWN';
  if (!s.valid) return 'INVALID';
  const untrusted = (s.sourceCounts?.learned ?? 0) + (s.sourceCounts?.byod ?? 0);
  if (untrusted > 0) return 'UNTRUSTED_SOURCE_PRESENT';
  return 'VALID';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) BÖLÜMLER
   ══════════════════════════════════════════════════════════════════════════ */

export type CddlSectionId = 'document' | 'inventory' | 'source' | 'legacy' | 'issues';

export const CDDL_SECTION_ORDER: readonly CddlSectionId[] = [
  'document', 'inventory', 'source', 'legacy', 'issues',
] as const;

export const CDDL_SECTION_TITLE: Readonly<Record<CddlSectionId, string>> = {
  document:  '1 · Belge',
  inventory: '2 · Tanım Envanteri',
  source:    '3 · Kaynak Güven Sınıfları',
  legacy:    '4 · Legacy Köprü',
  issues:    '5 · Doğrulama Kusurları',
} as const;

export interface CddlSection {
  readonly id: CddlSectionId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export interface CddlInventoryView {
  readonly verdict: CddlVerdict;
  readonly verdictLabel: string;
  readonly sections: readonly CddlSection[];
}

const SRC = 'obd/cddl/schema · legacyAdapter · validate';

function count(id: string, label: string, v: number | null, note: string): InspectorField {
  if (v === null) return unavailable({ id, label, source: SRC, note }, 'Ölçüm YOK — sayaç üretilmez.');
  return observed({ id, label, source: SRC, note }, String(v));
}

export function buildCddlInventoryView(s: CddlInventorySnapshot): CddlInventoryView {
  const verdict = deriveCddlVerdict(s);

  const document: InspectorField[] = [
    s.schemaVersion === null
      ? unavailable({ id: 'schema', label: 'Şema sürümü', source: SRC, note: 'Belge kurulamadı.' })
      : observed({
        id: 'schema', label: 'Şema sürümü', source: SRC,
        note: 'BİLİNMEYEN sürüm fail-closed REDDEDİLİR.',
      }, s.schemaVersion),
    observed({
      id: 'built', label: 'Belge kuruldu', source: SRC,
      note: 'Belge her okumada MEVCUT legacy kayıtlardan yeniden kurulur — ayrı depo YOK.',
    }, s.documentBuilt ? 'EVET' : 'HAYIR'),
    derived({
      id: 'verdict', label: 'Hüküm', source: 'devtools/cddlInventoryModel.deriveCddlVerdict',
      note: 'Doğrulama düşerse ya da güvenilmeyen kaynak görülürse GEÇERLİ DENMEZ.',
    }, verdict),
  ];

  const inventory: InspectorField[] = s.counts === null
    ? [unavailable({ id: 'inv', label: 'Tanım envanteri', source: SRC, note: 'Belge kurulamadı.' })]
    : s.counts.map((c) => observed({
      id: `inv-${c.kind}`, label: c.kind, source: SRC,
      note: c.count === 0
        ? 'Bu türde tanım YOK — bu bir kusur değil, ölçüm.'
        : 'Legacy köprüden okunan tanım adedi.',
    }, String(c.count)));

  const source: InspectorField[] = s.sourceCounts === null
    ? [unavailable({ id: 'src', label: 'Kaynak dağılımı', source: SRC, note: 'Belge kurulamadı.' })]
    : [
      count('src-builtin', 'builtin', s.sourceCounts.builtin ?? 0,
        'Ürünle gelen, incelenmiş tanım — ÜRÜN YOLUNA giren TEK sınıf.'),
      count('src-learned', 'learned', s.sourceCounts.learned ?? 0,
        'Araçtan öğrenilmiş — bu fazda ürün yoluna GİRMEZ (F4). Sıfırdan farklıysa UYARI.'),
      count('src-byod', 'byod', s.sourceCounts.byod ?? 0,
        'Dışarıdan içe aktarılmış — bu fazda ürün yoluna GİRMEZ (F4). Sıfırdan farklıysa UYARI.'),
    ];

  const legacy: InspectorField[] = [
    count('legacy-profiles', 'Legacy OEM profil', s.legacyProfileCount,
      'Mevcut profil sistemi SİLİNMEDİ — CDDL onu OKUR.'),
    count('legacy-product', 'Ürün kapısından geçen', s.productEligibleCount,
      'Yalnız gerçek araçta doğrulanmış profiller. CDDL bu kapıyı GEVŞETMEZ.'),
    s.serviceBytes === null
      ? unavailable({ id: 'svc-bytes', label: 'Servis beyaz listesi', source: SRC, note: 'Okunamadı.' })
      : observed({
        id: 'svc-bytes', label: 'Servis beyaz listesi', source: SRC,
        note: 'Hepsi SALT OKUMA. Yazma/aktüatör servisi bu listeye GİREMEZ.',
      }, s.serviceBytes.join(' · ')),
  ];

  const issues: InspectorField[] = s.issues === null
    ? [unavailable({ id: 'iss', label: 'Doğrulama kusurları', source: SRC, note: 'Doğrulama çalışmadı.' })]
    : s.issues.length === 0
      ? [observed({
        id: 'iss', label: 'Doğrulama kusurları', source: SRC,
        note: 'Belge tüm kapıları geçti.',
      }, 'YOK')]
      : s.issues.map((i, n) => observed({
        id: `iss-${n}`, label: `${i.rejection} @ ${i.path}`, source: SRC,
        note: 'Kusur GİZLENMEZ — sessiz eleme, aynı satırın yarın tekrar yazılması demektir.',
      }, i.detail));

  const byId: Record<CddlSectionId, InspectorField[]> = {
    document, inventory, source, legacy, issues,
  };

  return {
    verdict,
    verdictLabel: CDDL_VERDICT_LABEL[verdict],
    sections: CDDL_SECTION_ORDER.map((id) => ({
      id, title: CDDL_SECTION_TITLE[id], fields: byId[id],
    })),
  };
}
