/**
 * shiftView — vardiya görünümü, SAF model (V-16/6).
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK (şimdi ÇAĞIRANDAN
 * gelir) · React importu YOK.
 *
 * ── NEDEN YENİ TABLO YOK ────────────────────────────────────────────────────
 * Enterprise sayfası "Vardiya yönetimi" vaat ediyordu (`grep` → 0 sonuç). Ama
 * şema okununca görüldü ki **vardiya zaten var**: `vehicle_driver_assignments`
 * bir araç + bir sürücü + `starts_at`/`ends_at` penceresi tutuyor. Yeni bir
 * "shifts" tablosu açmak, aynı gerçeğin İKİNCİ OTORİTESİ olurdu ve ikisi
 * kaçınılmaz olarak ayrışırdı. Vardiya = **zamanlanmış atama penceresi**.
 *
 * ── "AKTİF" KURALI KOPYALANMADI, YANSITILDI ────────────────────────────────
 * Sunucunun `get_active_driver_assignment` kuralı şudur:
 *     status ∈ {SCHEDULED, ACTIVE}  **VE**  starts_at <= now  **VE**
 *     (ends_at IS NULL VEYA ends_at > now)
 * Yani `status` TEK BAŞINA otorite DEĞİLDİR; zaman penceresiyle BİRLİKTE
 * karar verir. Bu model aynı kuralı birebir uygular — farklı bir tanım
 * yazmak, ekranın araçtakiyle çelişmesi demekti.
 *
 * ── EN DEĞERLİ ÇIKTI: VARDİYA DIŞI SÜRÜŞ ───────────────────────────────────
 * Bir yolculuk hiçbir vardiya penceresine düşmüyorsa, araç **kimseye atanmamış
 * bir zamanda** kullanılmıştır. Filo yönetimi için asıl soru budur ve yalnız
 * vardiyaları listeleyen bir ekran bunu ASLA göstermez.
 */

export type ShiftState =
  /** Penceresi henüz başlamadı. */
  | 'PLANNED'
  /** Şu an yürürlükte (sunucu kuralıyla aynı). */
  | 'ACTIVE'
  /** Penceresi bitti. */
  | 'PAST'
  /** İptal/tamamlandı olarak işaretlenmiş — pencere ne derse desin. */
  | 'CLOSED';

export const SHIFT_STATE_LABEL: Readonly<Record<ShiftState, string>> = {
  PLANNED: 'PLANLANDI',
  ACTIVE:  'YÜRÜRLÜKTE',
  PAST:    'GEÇTİ',
  CLOSED:  'KAPATILDI',
} as const;

/** `list_vehicle_driver_assignments` satırı (ihtiyaç duyulan alanlar). */
export interface AssignmentInput {
  readonly assignment_id?: string | null;
  readonly vehicle_id?: string | null;
  readonly vehicle_name?: string | null;
  readonly driver_id?: string | null;
  readonly driver_name?: string | null;
  readonly starts_at?: string | number | null;
  readonly ends_at?: string | number | null;
  readonly status?: string | null;
  readonly assignment_type?: string | null;
}

/** Yolculuk penceresi (`list_vehicle_trips` satırından). */
export interface TripWindowInput {
  readonly vehicle_id?: string | null;
  readonly started_at?: string | number | null;
  readonly ended_at?: string | number | null;
  readonly distance_km?: string | number | null;
}

export interface ShiftRow {
  readonly id: string;
  readonly vehicleId: string | null;
  readonly vehicleName: string | null;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly startMs: number;
  /** Açık uçlu vardiya → `null` (bitiş UYDURULMAZ). */
  readonly endMs: number | null;
  readonly state: ShiftState;
  readonly type: string | null;
  /** Bu pencereye düşen yolculuk sayısı. */
  readonly tripCount: number;
  /** Bu pencerede sürülen mesafe; ölçüm yoksa `null`. */
  readonly distanceKm: number | null;
  /** Aynı ARACA aynı anda atanmış başka vardiya var mı. */
  readonly vehicleConflict: boolean;
  /** Aynı SÜRÜCÜ aynı anda başka araca atanmış mı (fiziksel olarak imkânsız). */
  readonly driverConflict: boolean;
}

export type ShiftVerdict = 'UNREADABLE' | 'NO_SHIFTS' | 'OK';

export const SHIFT_VERDICT_LABEL: Readonly<Record<ShiftVerdict, string>> = {
  UNREADABLE: 'OKUNAMADI',
  NO_SHIFTS:  'VARDİYA TANIMLANMAMIŞ',
  OK:         'LİSTELENDİ',
} as const;

export interface ShiftSummary {
  readonly verdict: ShiftVerdict;
  readonly shifts: readonly ShiftRow[];
  readonly activeCount: number;
  readonly conflictCount: number;
  /**
   * Hiçbir vardiyaya düşmeyen yolculuk sayısı; yolculuk okunamadıysa `null`.
   * `0` ile `null` AYRIDIR: ilki "hepsi kapsandı", ikincisi "bilmiyoruz".
   */
  readonly unassignedTripCount: number | null;
}

function ms(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** İki yarı-açık aralık kesişiyor mu (`end === null` = açık uçlu). */
export function overlaps(
  aStart: number, aEnd: number | null,
  bStart: number, bEnd: number | null,
): boolean {
  const aE = aEnd ?? Number.POSITIVE_INFINITY;
  const bE = bEnd ?? Number.POSITIVE_INFINITY;
  return aStart < bE && bStart < aE;
}

/**
 * Vardiya durumu — SUNUCU KURALININ AYNISI.
 *
 * `status` tek başına yetmez; pencereyle birlikte karar verilir.
 */
export function shiftState(
  status: string | null | undefined,
  startMs: number, endMs: number | null, nowMs: number,
): ShiftState {
  const s = (status ?? '').toUpperCase();
  /* Sunucu yalnız SCHEDULED/ACTIVE'i canlı sayar; gerisi kapalıdır. */
  if (s !== '' && s !== 'SCHEDULED' && s !== 'ACTIVE') return 'CLOSED';
  if (startMs > nowMs) return 'PLANNED';
  if (endMs !== null && endMs <= nowMs) return 'PAST';
  return 'ACTIVE';
}

export interface ShiftInput {
  /** `null` = OKUNAMADI ("vardiya yok" DEĞİL). */
  readonly assignments: readonly AssignmentInput[] | null;
  /** `null` = yolculuklar okunamadı → kapsam dışı sürüş HESAPLANMAZ. */
  readonly trips: readonly TripWindowInput[] | null;
  readonly nowMs: number;
}

export function buildShiftSummary(input: ShiftInput): ShiftSummary {
  if (input.assignments === null) {
    return { verdict: 'UNREADABLE', shifts: [], activeCount: 0, conflictCount: 0, unassignedTripCount: null };
  }

  /* Başlangıcı okunamayan atama vardiya SAYILMAZ: penceresi olmayan bir
     vardiya, kapsam hesabını sessizce bozardı. */
  const parsed = input.assignments
    .map((a) => ({ a, startMs: ms(a.starts_at), endMs: ms(a.ends_at) }))
    .filter((x): x is { a: AssignmentInput; startMs: number; endMs: number | null } => x.startMs !== null);

  if (parsed.length === 0) {
    return {
      verdict: 'NO_SHIFTS', shifts: [], activeCount: 0, conflictCount: 0,
      unassignedTripCount: input.trips === null ? null : input.trips.length,
    };
  }

  const shifts: ShiftRow[] = parsed.map(({ a, startMs, endMs }) => {
    const state = shiftState(a.status, startMs, endMs, input.nowMs);

    /* Çakışma YALNIZ kapalı olmayan vardiyalar arasında aranır: iptal edilmiş
       bir vardiya kimseyle çakışmaz. */
    const others = parsed.filter((o) => o.a.assignment_id !== a.assignment_id
      && shiftState(o.a.status, o.startMs, o.endMs, input.nowMs) !== 'CLOSED');

    const vehicleConflict = state !== 'CLOSED' && others.some((o) =>
      o.a.vehicle_id != null && o.a.vehicle_id === a.vehicle_id
      && overlaps(startMs, endMs, o.startMs, o.endMs));

    const driverConflict = state !== 'CLOSED' && others.some((o) =>
      o.a.driver_id != null && o.a.driver_id === a.driver_id
      && o.a.vehicle_id !== a.vehicle_id
      && overlaps(startMs, endMs, o.startMs, o.endMs));

    let tripCount = 0;
    let dist = 0;
    let distSeen = false;
    for (const t of input.trips ?? []) {
      if (t.vehicle_id != null && a.vehicle_id != null && t.vehicle_id !== a.vehicle_id) continue;
      const ts = ms(t.started_at);
      if (ts === null) continue;
      const te = ms(t.ended_at);
      if (!overlaps(ts, te, startMs, endMs)) continue;
      tripCount += 1;
      const d = num(t.distance_km);
      if (d !== null) { dist += d; distSeen = true; }
    }

    return {
      id: String(a.assignment_id ?? ''),
      vehicleId: a.vehicle_id ?? null,
      vehicleName: a.vehicle_name ?? null,
      driverId: a.driver_id ?? null,
      driverName: a.driver_name ?? null,
      startMs, endMs, state,
      type: a.assignment_type ?? null,
      tripCount,
      distanceKm: distSeen ? dist : null,
      vehicleConflict, driverConflict,
    };
  });

  /* Vardiya DIŞI sürüş: filo yönetiminin asıl sorusu. */
  let unassigned: number | null = null;
  if (input.trips !== null) {
    unassigned = 0;
    for (const t of input.trips) {
      const ts = ms(t.started_at);
      if (ts === null) continue;
      const te = ms(t.ended_at);
      const covered = parsed.some(({ a, startMs, endMs }) =>
        (t.vehicle_id == null || a.vehicle_id == null || t.vehicle_id === a.vehicle_id)
        && overlaps(ts, te, startMs, endMs));
      if (!covered) unassigned += 1;
    }
  }

  return {
    verdict: 'OK',
    shifts: shifts.sort((x, y) => y.startMs - x.startMs),
    activeCount: shifts.filter((s) => s.state === 'ACTIVE').length,
    conflictCount: shifts.filter((s) => s.vehicleConflict || s.driverConflict).length,
    unassignedTripCount: unassigned,
  };
}

/** Özetin altına yazılacak dürüstlük cümlesi. */
export function shiftDisclaimer(s: ShiftSummary): string {
  if (s.verdict === 'UNREADABLE') {
    return 'Atamalar OKUNAMADI. Bu, "vardiya tanımlanmamış" anlamına GELMEZ.';
  }
  if (s.verdict === 'NO_SHIFTS') {
    return 'Hiç vardiya (araç–sürücü atama penceresi) tanımlanmamış. Vardiya, ayrı bir kayıt değil; zamanlanmış bir atamadır.';
  }
  const parts: string[] = [];
  if (s.conflictCount > 0) {
    parts.push(`${s.conflictCount} vardiyada ÇAKIŞMA var (aynı araca iki sürücü ya da aynı sürücü iki araçta).`);
  }
  if (s.unassignedTripCount === null) {
    parts.push('Yolculuklar okunamadı; vardiya dışı sürüş HESAPLANAMADI (bu "yok" demek DEĞİL).');
  } else if (s.unassignedTripCount > 0) {
    parts.push(`${s.unassignedTripCount} yolculuk hiçbir vardiyaya düşmüyor — araç, kimseye atanmamış bir zamanda kullanılmış.`);
  } else {
    parts.push('Tüm yolculuklar bir vardiya penceresine düşüyor.');
  }
  return parts.join(' ');
}
