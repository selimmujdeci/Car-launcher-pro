/**
 * DTC SONUÇ SÖZLEŞMESİ — telefon tarafının TEK yorum noktası.
 *
 * ── OTORİTE HARİTASI (kanıtlanmış, 2026-09-18) ───────────────────────────
 *   · Komut yazma      : PWA → `vehicle_commands` INSERT (RLS "commands: gonderebilir")
 *   · ÖLÇÜM otoritesi  : ARAÇ tarafı (`src/platform/obd/dtcAuthority.ts` ·
 *                        `remoteDiagnosticCommands.executeReadDtc`)
 *   · Sonuç kalıcılığı : `vehicle_commands.result` (jsonb) — araç
 *                        `updateRemoteCommandStatus(..., result)` ile yazar
 *   · Telefonun okuması: Supabase RLS ("commands: okuyabilir" →
 *                        `is_vehicle_owner OR is_paired`)
 *
 * Telefon DTC ÜRETMEZ, TAHMİN ETMEZ, EKSİK SONUCU TAMAMLAMAZ. Buradaki tüm
 * mantık, aracın yazdığı kaydı YORUMLAMAKTAN ibarettir.
 *
 * ── EN ÖNEMLİ KURAL ──────────────────────────────────────────────────────
 * "0 arıza" ile "okunamadı" AYNI ŞEY DEĞİLDİR. Araç tarafı bu ayrımı zaten
 * yapıyor (`completeness` + fail-closed `executeReadDtc`); telefon o ayrımı
 * KORUMAK zorundadır. Bu yüzden `NO_DTC` yalnızca GERÇEKTEN başarılı bir
 * okumanın boş listesinden üretilir.
 */

export interface DtcCode {
  code:     string;
  severity: 'critical' | 'warning' | 'info';
  system:   string;
  desc:     string;
  /** Hangi OBD modundan geldi (araç doldurur; eski kayıtlarda yok). */
  status?:  'stored' | 'pending' | 'permanent';
}

/** Araç tarafının tarama bütünlüğü — servis başına sonuç sınıfı. */
export type DtcServiceOutcome = 'ok' | 'failed' | 'unsupported';

export interface DtcCompleteness {
  stored?:    DtcServiceOutcome;
  pending?:   DtcServiceOutcome;
  permanent?: DtcServiceOutcome;
}

/** `vehicle_commands.result` içinde aracın yazdığı gövde. */
export interface DtcResult {
  dtcs:                DtcCode[];
  voltage?:            number;
  readAt?:             string;
  partial?:            boolean;
  permanentSupported?: boolean;
  completeness?:       DtcCompleteness;
}

/** Telefonun okuduğu ham komut satırı (yalnız gereken kolonlar). */
export interface DtcCommandRow {
  id:             string;
  vehicle_id:     string;
  type:           string;
  status:         string;
  result:         unknown;
  error_message:  string | null;
  created_at?:    string | null;
  finished_at?:   string | null;
}

/**
 * Kullanıcıya gösterilecek DURUM — her biri AYRI anlam taşır.
 *
 * `FAILED`/`TIMEOUT`/`OFFLINE`/`UNSUPPORTED` hiçbir koşulda "arıza yok"
 * diye sunulamaz; `NO_DTC` yalnız kanıtlı boş okumadır.
 */
export type DtcOutcome =
  | { kind: 'WAITING_FOR_VEHICLE' }
  | { kind: 'READING' }
  | { kind: 'RESULT';      dtcs: DtcCode[]; partial: boolean; readAt?: string; completeness?: DtcCompleteness }
  | { kind: 'NO_DTC';      readAt?: string; partial: boolean; completeness?: DtcCompleteness }
  | { kind: 'UNSUPPORTED'; reason: string }
  | { kind: 'OFFLINE';     reason: string }
  | { kind: 'TIMEOUT';     reason: string }
  | { kind: 'FAILED';      reason: string }
  | { kind: 'STALE';       reason: string };

/** Komut yaşam döngüsünün SONLANDIĞI durumlar. */
const TERMINAL_OK = new Set(['completed']);
const TERMINAL_BAD = new Set(['failed', 'rejected', 'expired', 'timeout']);
const IN_FLIGHT = new Set(['pending', 'queued', 'received', 'sent', 'accepted']);

/** Araç bu komutu yürütürken "okuyor" sayılır. */
const EXECUTING = new Set(['executing', 'in_progress']);

/**
 * Aracın yazdığı gövdeyi güvenle ayrıştırır.
 *
 * Bozuk/eksik gövde SESSİZCE boş listeye çevrilmez — o, "arıza yok" yalanını
 * üretirdi. `null` dönerse çağıran `FAILED` üretir.
 */
export function parseDtcResult(raw: unknown): DtcResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  /* Voltaj okumaları `dtcs` içermez; DTC okuması için dizi ZORUNLUDUR. */
  if (!Array.isArray(body.dtcs)) return null;

  const dtcs: DtcCode[] = [];
  for (const item of body.dtcs) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.code !== 'string' || entry.code.length === 0) return null;
    dtcs.push({
      code:     entry.code,
      severity: entry.severity === 'critical' || entry.severity === 'warning'
        ? entry.severity : 'info',
      system:   typeof entry.system === 'string' ? entry.system : 'Bilinmeyen sistem',
      /* Açıklama aracın sözlüğünden gelir; telefonda PARALEL SÖZLÜK KURULMAZ.
         Gelmediyse dürüstçe "tanım yok" denir (uydurma açıklama yasak). */
      desc:     typeof entry.desc === 'string' && entry.desc.length > 0
        ? entry.desc : 'Tanımı mevcut değil',
      ...(entry.status === 'stored' || entry.status === 'pending' ||
          entry.status === 'permanent' ? { status: entry.status } : {}),
    });
  }

  const completeness = body.completeness && typeof body.completeness === 'object'
    ? body.completeness as DtcCompleteness
    : undefined;

  return {
    dtcs,
    ...(typeof body.readAt === 'string' ? { readAt: body.readAt } : {}),
    partial: body.partial === true,
    ...(typeof body.permanentSupported === 'boolean'
      ? { permanentSupported: body.permanentSupported } : {}),
    ...(completeness ? { completeness } : {}),
  };
}

/** Tarama hiçbir servisi başarıyla okuyamadıysa "boş liste" KANIT DEĞİLDİR. */
export function hasAnySuccessfulRead(c?: DtcCompleteness): boolean {
  if (!c) return true; /* eski kayıtlarda alan yok — gövde varsa okuma yapılmıştır */
  return c.stored === 'ok' || c.pending === 'ok' || c.permanent === 'ok';
}

/** Araç o servisleri hiç tanımıyorsa bu bir ARIZA DEĞİL, kapsam gerçeğidir. */
export function isFullyUnsupported(c?: DtcCompleteness): boolean {
  if (!c) return false;
  const values = [c.stored, c.pending, c.permanent].filter(Boolean);
  return values.length > 0 && values.every((v) => v === 'unsupported');
}

export interface ClassifyInput {
  row: DtcCommandRow | null;
  /** Bu komutun hangi araç için istendiği — satır bağı doğrulanır. */
  expectedVehicleId: string;
  /** Beklenen komut türü (`read_dtc`). */
  expectedType: string;
  /** Sonucun bayatlama sınırı; aşılırsa `STALE`. */
  maxAgeMs?: number;
  now?: number;
}

/**
 * Komut satırını kullanıcıya gösterilecek duruma çevirir — SAF.
 *
 * Sıra pazarlıksızdır: bağ doğrulaması → yaşam döngüsü → gövde → bütünlük.
 * Her adım fail-closed: belirsizlik "arıza yok"a DÖNÜŞMEZ.
 */
export function classifyDtcCommand(input: ClassifyInput): DtcOutcome {
  const { row, expectedVehicleId, expectedType } = input;

  /* Satır okunamadı: RLS reddetti, silindi ya da hiç yok. Hangisi olursa
     olsun telefon sonuç ÜRETMEZ. */
  if (!row) {
    return { kind: 'FAILED', reason: 'Komut kaydı okunamadı' };
  }
  /* KOMUT ↔ ARAÇ BAĞI: id bilmek yeterli değildir (IDOR ek savunması;
     birincil koruma RLS'tedir). */
  if (row.vehicle_id !== expectedVehicleId) {
    return { kind: 'FAILED', reason: 'Komut bu araca ait değil' };
  }
  /* Yanlış türden bir komutun sonucu DTC olarak yorumlanamaz. */
  if (row.type !== expectedType) {
    return { kind: 'FAILED', reason: 'Komut türü teşhis okuması değil' };
  }

  const status = (row.status ?? '').toLowerCase();

  if (IN_FLIGHT.has(status)) return { kind: 'WAITING_FOR_VEHICLE' };
  if (EXECUTING.has(status)) return { kind: 'READING' };

  if (TERMINAL_BAD.has(status)) {
    const reason = row.error_message?.trim() || 'Araç teşhis okumasını tamamlamadı';
    if (status === 'expired' || status === 'timeout') {
      return { kind: 'TIMEOUT', reason };
    }
    /* Araç bağlantısı yoksa yürütücü tam bu gerekçeyi yazar. */
    if (/bağlantı|baglanti|offline|link/i.test(reason)) {
      return { kind: 'OFFLINE', reason };
    }
    return { kind: 'FAILED', reason };
  }

  if (!TERMINAL_OK.has(status)) {
    /* Bilinmeyen durum kodu: uydurmak yerine beklemeye devam edilir. */
    return { kind: 'WAITING_FOR_VEHICLE' };
  }

  /* ── Buradan sonrası: TAŞIMA tamamlandı ────────────────────────────────
     F0 invariantı: `completed` TESLİM/yaşam döngüsü tamamlanmasıdır, ÖLÇÜM
     BAŞARISI DEĞİLDİR. Ölçüm ancak araç gerçek bir gövde yazdıysa vardır. */
  const parsed = parseDtcResult(row.result);
  if (!parsed) {
    return {
      kind: 'FAILED',
      reason: row.error_message?.trim() || 'Araç ölçüm sonucu yazmadı',
    };
  }

  const ageLimit = input.maxAgeMs;
  if (ageLimit && parsed.readAt) {
    const measuredAt = Date.parse(parsed.readAt);
    const now = input.now ?? Date.now();
    if (Number.isFinite(measuredAt) && now - measuredAt > ageLimit) {
      return { kind: 'STALE', reason: 'Sonuç güncel değil, yeniden okuyun' };
    }
  }

  if (isFullyUnsupported(parsed.completeness)) {
    return { kind: 'UNSUPPORTED', reason: 'Araç bu teşhis servislerini desteklemiyor' };
  }
  /* Hiçbir servis başarıyla okunamadıysa boş liste KANIT DEĞİLDİR. */
  if (!hasAnySuccessfulRead(parsed.completeness)) {
    return { kind: 'FAILED', reason: 'Teşhis servisleri okunamadı' };
  }

  const partial = parsed.partial === true;
  if (parsed.dtcs.length === 0) {
    return {
      kind: 'NO_DTC',
      partial,
      ...(parsed.readAt ? { readAt: parsed.readAt } : {}),
      ...(parsed.completeness ? { completeness: parsed.completeness } : {}),
    };
  }
  return {
    kind: 'RESULT',
    dtcs: parsed.dtcs,
    partial,
    ...(parsed.readAt ? { readAt: parsed.readAt } : {}),
    ...(parsed.completeness ? { completeness: parsed.completeness } : {}),
  };
}

/* ── AKÜ VOLTAJI (F2.2) ───────────────────────────────────────────────────
   ÖLÇÜLEN KUSUR: `read_voltage` sonucu da telefona ULAŞMIYORDU. Panel voltajı
   yine `/api/pwa/dtc-result` üzerinden istiyordu, yani DTC'de kapatılan aynı
   410 tombstone'a çarpıyordu: komut gidiyor, araç ölçüyor, ekranda daima
   "Voltaj sonucu okunamadı" yazıyordu.

   Ölçüm otoritesi ARAÇTIR (`remoteDiagnosticCommands.executeReadVoltage`) ve
   fail-closed'dır: ATRV gelmiyorsa SONUÇ YAZMAZ ("sahte 0 V YASAK").
   Telefon yalnız o kaydı yorumlar; kendi voltaj aralığını UYDURMAZ. Aşağıdaki
   geçerlilik kapısı aracın `isReportableVoltage` kapısının AYNISIDIR (`v > 0`)
   — ikinci bir eşik otoritesi kurulmaz. */

export type VoltageOutcome =
  | { kind: 'WAITING_FOR_VEHICLE' }
  | { kind: 'READING' }
  | { kind: 'RESULT';  volts: number; readAt?: string }
  | { kind: 'OFFLINE'; reason: string }
  | { kind: 'TIMEOUT'; reason: string }
  | { kind: 'FAILED';  reason: string }
  | { kind: 'STALE';   reason: string };

/**
 * Voltaj gövdesini ayrıştırır. Ölçülmemiş/sentinel değer `null` döner —
 * `0 V` "akü bitti" diye SUNULMAZ, "ölçülmedi"dir.
 */
export function parseVoltageResult(
  raw: unknown,
): { volts: number; readAt?: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const v = body.voltage;
  /* Aracın kapısıyla aynı: sonlu ve sıfırdan büyük. */
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return {
    volts: v,
    ...(typeof body.readAt === 'string' ? { readAt: body.readAt } : {}),
  };
}

/**
 * `read_voltage` komut satırını duruma çevirir — SAF.
 *
 * Sıra DTC ile AYNIDIR (bağ → yaşam döngüsü → gövde): `completed` gelmesi
 * ölçüm başarısı DEĞİLDİR, gövde yoksa `FAILED` üretilir.
 */
export function classifyVoltageCommand(input: ClassifyInput): VoltageOutcome {
  const { row, expectedVehicleId, expectedType } = input;

  if (!row) return { kind: 'FAILED', reason: 'Komut kaydı okunamadı' };
  if (row.vehicle_id !== expectedVehicleId) {
    return { kind: 'FAILED', reason: 'Komut bu araca ait değil' };
  }
  if (row.type !== expectedType) {
    return { kind: 'FAILED', reason: 'Komut türü voltaj okuması değil' };
  }

  const status = (row.status ?? '').toLowerCase();
  if (IN_FLIGHT.has(status)) return { kind: 'WAITING_FOR_VEHICLE' };
  if (EXECUTING.has(status)) return { kind: 'READING' };

  if (TERMINAL_BAD.has(status)) {
    const reason = row.error_message?.trim() || 'Araç voltaj okumasını tamamlamadı';
    if (status === 'expired' || status === 'timeout') return { kind: 'TIMEOUT', reason };
    if (/bağlantı|baglanti|offline|link/i.test(reason)) return { kind: 'OFFLINE', reason };
    return { kind: 'FAILED', reason };
  }
  if (!TERMINAL_OK.has(status)) return { kind: 'WAITING_FOR_VEHICLE' };

  const parsed = parseVoltageResult(row.result);
  if (!parsed) {
    return {
      kind: 'FAILED',
      reason: row.error_message?.trim() || 'Akü voltajı ölçülemedi',
    };
  }

  const ageLimit = input.maxAgeMs;
  if (ageLimit && parsed.readAt) {
    const measuredAt = Date.parse(parsed.readAt);
    const now = input.now ?? Date.now();
    if (Number.isFinite(measuredAt) && now - measuredAt > ageLimit) {
      return { kind: 'STALE', reason: 'Voltaj ölçümü güncel değil' };
    }
  }

  return {
    kind: 'RESULT',
    volts: parsed.volts,
    ...(parsed.readAt ? { readAt: parsed.readAt } : {}),
  };
}

/** Kullanıcıya gösterilecek tek cümle — "arıza yok" yalnız NO_DTC'de. */
export function describeDtcOutcome(outcome: DtcOutcome): string {
  switch (outcome.kind) {
    case 'WAITING_FOR_VEHICLE': return 'Araç bekleniyor…';
    case 'READING':             return 'Araç arıza kodlarını okuyor…';
    case 'NO_DTC':
      return outcome.partial
        ? 'Okunabilen sistemlerde arıza yok (tarama kısmi)'
        : 'Arıza kodu bulunamadı';
    case 'RESULT':
      return outcome.partial
        ? `${outcome.dtcs.length} arıza kodu (tarama kısmi)`
        : `${outcome.dtcs.length} arıza kodu`;
    case 'UNSUPPORTED':        return outcome.reason;
    case 'OFFLINE':            return outcome.reason;
    case 'TIMEOUT':            return outcome.reason;
    case 'STALE':              return outcome.reason;
    case 'FAILED':             return outcome.reason;
  }
}
