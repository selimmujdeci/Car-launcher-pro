/**
 * runtimeModeModel — CAROS LAB · Çalışma Zamanı Modu SAF modeli (V-17).
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── BU EKRANIN CEVAPLADIĞI SORU ─────────────────────────────────────────────
 * *"Mod neden bu ve bir kapıyı düzeltirsem yükselir mi?"*
 *
 * ── EN ÖNEMLİ AYRIM: "TEK SUÇLU" YANILSAMASI ───────────────────────────────
 * Yalnız "kararı veren kapı"yı göstermek, *"onu düzeltirsek mod yükselir"*
 * yanılsaması üretir. Vizyon planı tam olarak buna düştü: nedeni COEP sandı ve
 * pahalı bir çözüm önerdi (medya iframe'lerini ayrı origin'e taşımak). Oysa
 * hedef donanımda BİRDEN FAZLA kapı aynı anda engelliyor olabilir — o hâlde
 * COEP çözülse bile mod DEĞİŞMEZ. Bu yüzden model her zaman **kalan engel
 * sayısını** hesaplar ve hükmü ona göre verir.
 */

import {
  observed, derived, unavailable,
  type InspectorField,
} from './sessionInspectorModel';

const SRC = 'core/runtime/AdaptiveRuntimeManager.traceModeGates()';

export type GateId = 'deviceTier' | 'weakGpu' | 'worker' | 'sab';

export const GATE_LABEL: Readonly<Record<GateId, string>> = {
  deviceTier: 'Cihaz sınıfı',
  weakGpu:    'GPU sınıfı',
  worker:     'Worker desteği',
  sab:        'SAB + crossOriginIsolated',
} as const;

/** Kapının NE olduğunu ve düzeltmenin neye mal olduğunu anlatan kısa not. */
export const GATE_NOTE: Readonly<Record<GateId, string>> = {
  deviceTier:
    'Ekran · çekirdek · RAM · WebView · Android sürümü birleşik sınıfı. Donanımın kendisidir — YAZILIMLA DÜZELTİLEMEZ.',
  weakGpu:
    'Mali-400 sınıfı (Utgard) veya yazılım render. blur software path\'te çalışır, her kare GPU stall üretir. Donanımdır — DÜZELTİLEMEZ.',
  worker:
    'Web Worker yoksa çok iş parçacığı yoktur. Modern WebView\'da normalde AÇIKTIR.',
  sab:
    'SharedArrayBuffer yalnız COOP+COEP altında kullanılabilir. Capacitor WebView\'ında COEP YOKTUR — bilinçli takas: COEP açılırsa YouTube iframe\'i ve çapraz-köken kaynaklar kırılır.',
} as const;

/** Kapı yazılımla açılabilir mi — karar için belirleyici. */
export const GATE_FIXABLE: Readonly<Record<GateId, boolean>> = {
  deviceTier: false,   // donanım
  weakGpu:    false,   // donanım
  worker:     true,
  sab:        true,    // COEP açılabilir (bedeli var)
} as const;

export interface GateRowInput {
  readonly id: GateId;
  readonly blocking: boolean;
  readonly observed: string;
}

export interface GateViewRow {
  readonly id: GateId;
  readonly label: string;
  readonly blocking: boolean;
  readonly fixable: boolean;
  readonly observed: string;
  readonly note: string;
  /** Kararı bu kapı verdi mi (kısa devrede İLK engelleyen). */
  readonly decisive: boolean;
}

export function buildGateRows(
  gates: readonly GateRowInput[],
  decidedBy: GateId | null,
): readonly GateViewRow[] {
  return gates.map((g) => ({
    id: g.id,
    label: GATE_LABEL[g.id],
    blocking: g.blocking,
    fixable: GATE_FIXABLE[g.id],
    observed: g.observed,
    note: GATE_NOTE[g.id],
    decisive: g.id === decidedBy,
  }));
}

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export type ModeVerdict =
  | 'UNAVAILABLE'
  /** Hiçbir kapı engellemiyor — tespit üst moda izin veriyor. */
  | 'UNBLOCKED'
  /** Engel var ve HEPSİ donanım — yazılımla açılamaz. */
  | 'HARDWARE_BOUND'
  /** Engellerin hepsi yazılımla açılabilir. */
  | 'SOFTWARE_BOUND'
  /** Hem donanım hem yazılım engeli var — yazılım engelini çözmek YETMEZ. */
  | 'MIXED_BLOCKED';

export const MODE_VERDICT_LABEL: Readonly<Record<ModeVerdict, string>> = {
  UNAVAILABLE:    'OKUNAMADI',
  UNBLOCKED:      'ENGEL YOK — üst mod açık',
  HARDWARE_BOUND: 'DONANIM SINIRI — yazılımla AÇILAMAZ',
  SOFTWARE_BOUND: 'YAZILIM SINIRI — açılabilir (bedeli var)',
  MIXED_BLOCKED:  'KARMA ENGEL — yazılımı çözmek YETMEZ',
} as const;

export type ModeTone = 'ok' | 'muted' | 'warn';

export function modeVerdictTone(v: ModeVerdict): ModeTone {
  return v === 'UNBLOCKED' ? 'ok' : v === 'UNAVAILABLE' ? 'muted' : 'warn';
}

export function deriveModeVerdict(rows: readonly GateViewRow[] | null): ModeVerdict {
  if (rows === null || rows.length === 0) return 'UNAVAILABLE';
  const blocking = rows.filter((r) => r.blocking);
  if (blocking.length === 0) return 'UNBLOCKED';
  const hw = blocking.filter((r) => !r.fixable).length;
  const sw = blocking.length - hw;
  if (hw > 0 && sw > 0) return 'MIXED_BLOCKED';
  return hw > 0 ? 'HARDWARE_BOUND' : 'SOFTWARE_BOUND';
}

/**
 * "Yazılım engelini çözersem mod yükselir mi?" sorusunun DÜRÜST cevabı.
 *
 * `true` DÖNMESİ İÇİN yazılımla açılamayan HİÇBİR engel kalmamalıdır. Bu, planın
 * düştüğü "COEP'i çöz, mod yükselsin" tuzağının panzehridir.
 */
export function softwareFixWouldUnlock(rows: readonly GateViewRow[] | null): boolean {
  if (rows === null) return false;
  const blocking = rows.filter((r) => r.blocking);
  return blocking.length > 0 && blocking.every((r) => r.fixable);
}

/* ── Özet alanları ───────────────────────────────────────────────────────── */

export interface ModeFieldsInput {
  readonly activeMode: string | null;
  readonly detectedMode: string | null;
  readonly rows: readonly GateViewRow[] | null;
  readonly powerCeiling: string | null;
  readonly recoveryTarget: string | null;
  readonly failedComponents: readonly string[] | null;
  readonly lastChange: { readonly from: string; readonly to: string; readonly reason: string; readonly at: number } | null;
  readonly partial: boolean;
}

export function buildModeFields(input: ModeFieldsInput): readonly InspectorField[] {
  const out: InspectorField[] = [];

  out.push(input.activeMode === null
    ? unavailable({ id: 'rm-active', label: 'Yürürlükteki mod', source: SRC, note: '' },
        'Okunamadı — "BASIC_JS" ile KARIŞTIRILMAZ.')
    : observed({
        id: 'rm-active', label: 'Yürürlükteki mod', source: SRC,
        note: 'Şu an GEÇERLİ olan mod. Tespitten FARKLI olabilir: termal · kullanıcı · güç tavanı · arıza merdiveni onu ezer.',
      }, input.activeMode));

  out.push(input.detectedMode === null
    ? unavailable({ id: 'rm-detected', label: 'Tespit edilen mod', source: SRC, note: '' }, 'Kapı izi okunamadı.')
    : observed({
        id: 'rm-detected', label: 'Tespit edilen mod', source: SRC,
        note: 'Açılışta kapılardan çıkan sonuç. Yürürlükteki moddan farklıysa bir OTORİTE devralmıştır.',
      }, input.detectedMode));

  /* Fark varsa AYRI bir satır: "neden BASIC_JS?" sorusunun cevabı burada ikiye ayrılır. */
  if (input.activeMode !== null && input.detectedMode !== null) {
    out.push(derived({
      id: 'rm-divergence', label: 'Tespit ↔ yürürlük', source: SRC,
      note: input.activeMode === input.detectedMode
        ? 'Aktif mod tespitin sonucudur; bir otorite devralmamış.'
        : 'Aktif mod tespitten FARKLI — sebebi kapılarda DEĞİL, aşağıdaki otoritelerdedir.',
    }, input.activeMode === input.detectedMode ? 'AYNI' : 'FARKLI — otorite devralmış'));
  }

  const blocking = input.rows === null ? null : input.rows.filter((r) => r.blocking);
  out.push(blocking === null
    ? unavailable({ id: 'rm-blocking', label: 'Engelleyen kapı', source: SRC, note: '' }, 'Kapı izi okunamadı.')
    : observed({
        id: 'rm-blocking', label: 'Engelleyen kapı', source: SRC,
        note: 'TÜM kapılar değerlendirildi (üretim yolu ilk engelleyende durur). Birden çoksa tekini düzeltmek YETMEZ.',
      }, blocking.length === 0 ? 'yok' : blocking.map((r) => r.label).join(' · ')));

  out.push(input.rows === null
    ? unavailable({ id: 'rm-unlock', label: 'Yazılımla açılır mı', source: SRC, note: '' }, 'Kapı izi okunamadı.')
    : derived({
        id: 'rm-unlock', label: 'Yazılımla açılır mı', source: SRC,
        note: 'YALNIZ donanım engeli KALMADIYSA "evet". Aksi hâlde COEP gibi pahalı bir çözüm modu DEĞİŞTİRMEZ.',
      }, softwareFixWouldUnlock(input.rows) ? 'EVET' : 'HAYIR'));

  out.push(input.powerCeiling === null
    ? observed({
        id: 'rm-power', label: 'Güç tavanı', source: SRC,
        note: 'Akü koruması etkin değil. "yok" ile "okunamadı" ayrıdır; bu ölçülmüş bir YOK.',
      }, 'yok')
    : observed({
        id: 'rm-power', label: 'Güç tavanı', source: SRC,
        note: 'Voltaj düşük — bu tavanın ÜSTÜNE çıkılamaz, tespit ne derse desin.',
      }, input.powerCeiling));

  out.push(input.recoveryTarget === null
    ? observed({ id: 'rm-recovery', label: 'Kurtarma hedefi', source: SRC,
        note: 'Arıza merdiveni geri çıkmayı hedeflemiyor.' }, 'yok')
    : observed({ id: 'rm-recovery', label: 'Kurtarma hedefi', source: SRC,
        note: 'Arıza giderilirse bu moda geri çıkılacak.' }, input.recoveryTarget));

  out.push(input.failedComponents === null
    ? unavailable({ id: 'rm-failed', label: 'Arızalı bileşen', source: SRC, note: '' }, 'Okunamadı.')
    : observed({
        id: 'rm-failed', label: 'Arızalı bileşen', source: SRC,
        note: 'Arıza bildiren bileşenler modu AŞAĞI çeker.',
      }, input.failedComponents.length === 0 ? 'yok' : input.failedComponents.join(' · ')));

  out.push(input.lastChange === null
    ? observed({
        id: 'rm-last', label: 'Son mod değişimi', source: SRC,
        note: 'Bu oturumda mod HİÇ değişmedi — açılıştaki tespit hâlâ geçerli. Sahte bir "değişti" kaydı üretilmez.',
      }, 'değişmedi')
    : derived({
        id: 'rm-last', label: 'Son mod değişimi', source: SRC,
        note: 'Modu en son KİMİN değiştirdiği — kapılar değil, bir otorite.',
        updatedAt: input.lastChange.at,
      }, `${input.lastChange.from} → ${input.lastChange.to} · ${input.lastChange.reason}`));

  if (input.partial) {
    out.push(unavailable({
      id: 'rm-partial', label: 'Okuma bütünlüğü', source: SRC, note: '',
    }, 'En az bir kaynak okunamadı — tablo EKSİK, tam sanılmamalı.'));
  }

  return out;
}
