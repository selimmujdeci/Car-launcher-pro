/**
 * diagnosticHistory — KALICI TEŞHİS GEÇMİŞİ sözleşmesi ve projeksiyonu (F5.3).
 *
 * ── BU BİR TEŞHİS OTORİTESİ DEĞİLDİR ─────────────────────────────────────
 * Yeni tarayıcı, yeni severity tablosu, yeni sağlık motoru KURMAZ. Aracın
 * ZATEN ölçtüğü sonucu (`vehicle_commands.result`) mevcut kanonik yorumcuyla
 * (`classifyDtcCommand` · F2.1) sınıflandırır ve KALICI, normalize bir kayda
 * çevirir. DTC kodu, severity ve kapsam bilgisi ARAÇTAN gelir; burada
 * üretilmez.
 *
 * ── NEDEN GEREKLİ (ölçüldü, production salt-okuma) ───────────────────────
 * · `vehicle_commands` KALICI DEĞİL: terminal satırlar **14 GÜN** sonra
 *   siliniyor (`cleanup_old_telemetry` → `_retention_days('vehicle_commands',14)`).
 * · Production'da KALICI teşhis tablosu YOK (`diag|dtc|fault|scan` adlı tablo
 *   yok; `get_recent_diagnostics` yalnız super_admin'e açık DESTEK yüzeyidir
 *   ve `obd_diag` = bağlantı teşhisi, DTC taraması değildir).
 * · `vehicle_events` ÇARE DEĞİL: RLS'i `authenticated` kullanıcıya kendi
 *   aracı için **INSERT** veriyor → tarayıcı teşhis geçmişi UYDURABİLİR.
 *   Ayrıca `vehicle_id` `text`, `metadata` sözleşmesiz serbest JSONB.
 *
 * ── TEMEL İLKE ───────────────────────────────────────────────────────────
 *   "Geçmişte gördük"     ≠ "Şu anda var"
 *   "Bu taramada görmedik" ≠ "Tamir edildi"
 *
 * Bu dosya KANIT DİLİ üretir ("görüldü", "son görüldü", "bu taramada
 * görülmedi"); HÜKÜM DİLİ ("tamir edildi", "araç sağlam") ÜRETMEZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import {
  classifyDtcCommand,
  type DtcCode,
  type DtcCommandRow,
  type DtcCompleteness,
  type DtcOutcome,
  DTC_HEALTH_MAX_AGE_MS,
} from './dtcResultContract';

/* ── Kalıcı sözleşme ───────────────────────────────────────────────────── */

/**
 * KALICILAŞTIRILABİLİR tarama sonucu — yalnız TERMİNAL durumlar.
 *
 * `WAITING_FOR_VEHICLE` ve `READING` bilinçli olarak YOKTUR: onlar komutun
 * uçuş hâlidir, bir ÖLÇÜM SONUCU değildir; kalıcılaştırmak "yarım gerçek"
 * saklamak olurdu.
 *
 * AYRIM PAZARLIKSIZ (§6):
 *   `RESULT`      → tarama başarılı, EN AZ BİR kod bulundu
 *   `NO_DTC`      → tarama başarılı, KAPSAMINDA kod bulunmadı
 *   `UNSUPPORTED` → araç/protokol desteklemiyor — "sağlıklı" DEĞİL
 *   `OFFLINE`     → araca ulaşılamadı    — "kod yok" DEĞİL
 *   `TIMEOUT`     → araç yanıt vermedi   — "kod yok" DEĞİL
 *   `FAILED`      → tarama düştü         — "kod yok" DEĞİL
 *   `STALE`       → sonuç bayat/geçersiz — "kod yok" DEĞİL
 */
export type DiagnosticScanStatus =
  | 'RESULT' | 'NO_DTC' | 'UNSUPPORTED' | 'OFFLINE' | 'TIMEOUT' | 'FAILED' | 'STALE';

/** Bu tarama "araçta kod yok" DİYEBİLİR mi? Yalnız başarılı tarama diyebilir. */
export function scanCanClaimZeroDtc(status: DiagnosticScanStatus): boolean {
  return status === 'NO_DTC';
}

/** Tarama gerçekten ÖLÇÜM yaptı mı (başarılı okuma)? */
export function scanSucceeded(status: DiagnosticScanStatus): boolean {
  return status === 'RESULT' || status === 'NO_DTC';
}

/**
 * Kalıcı tarama kaydı — DB satırının kod tarafındaki karşılığı.
 *
 * Yalnız GERÇEKTEN BİLİNEN alanlar taşınır. Bilinmeyen alan `null`dır;
 * tahminle doldurulmaz (§5).
 */
export interface DiagnosticScanRecord {
  /** Kaynağı olan komut — AYNI ZAMANDA idempotens anahtarı (§9). */
  readonly sourceCommandId: string;
  readonly vehicleId: string;
  readonly status: DiagnosticScanStatus;
  /** Aracın bildirdiği ÖLÇÜM anı (ISO). Araç yazmadıysa `null` — uydurulmaz. */
  readonly measuredAt: string | null;
  /** Komutun sonlandığı an (ISO). Bilinmiyorsa `null`. */
  readonly completedAt: string | null;
  /** Tarama KISMİ mi? Kısmi tarama TAM tarama gibi sunulamaz (§10). */
  readonly partial: boolean;
  /** Servis bazlı kapsam (stored/pending/permanent). Bilinmiyorsa `null`. */
  readonly completeness: DtcCompleteness | null;
  /** Kalıcı DTC servisi destekleniyor mu? Üç değerli: bilinmiyorsa `null`. */
  readonly permanentSupported: boolean | null;
  /** Bulunan kodlar. YALNIZ `RESULT` doluyken anlamlıdır. */
  readonly dtcs: readonly DtcCode[];
  /** Neden düştü (başarısız durumlar). Başarılıda `null`. */
  readonly failureReason: string | null;
}

/* ── Komut satırı → kalıcı kayıt ───────────────────────────────────────── */

/**
 * Tamamlanmış bir `read_dtc` komutunu KALICI kayda çevirir.
 *
 * Sınıflandırma KOPYALANMAZ: `classifyDtcCommand` (F2.1) çağrılır. Terminal
 * olmayan durum (`WAITING_FOR_VEHICLE` · `READING`) `null` döner —
 * kalıcılaştırılacak bir ölçüm henüz YOKTUR.
 *
 * İDEMPOTENS: kayıt `sourceCommandId` taşır. Aynı komut retry/realtime/reload
 * yüzünden iki kez işlenirse çağıran (veya DB UNIQUE kısıtı) ikinci yazımı
 * reddeder. İKİ AYRI gerçek tarama aynı kodları verse bile AYRI komut
 * kimlikleri olduğu için AYRI kayıttır — DTC listesi tarama kimliği DEĞİLDİR.
 */
export function buildDiagnosticScanRecord(
  row: DtcCommandRow,
  /** Kaydın AİT OLDUĞU araç — satır bağı BURADA doğrulanır (§13). */
  expectedVehicleId: string,
  now: number,
  /** Sonucun bayatlama sınırı; aşılırsa `STALE`. */
  maxAgeMs?: number,
): DiagnosticScanRecord | null {
  /* Bağ doğrulaması KOPYALANMAZ: `classifyDtcCommand` satırın araç ve komut
     türü bağını kendisi denetler ve uyuşmazlıkta fail-closed davranır.
     Böylece "B aracının satırı A'nın geçmişine yazıldı" yolu kapanır. */
  const outcome: DtcOutcome = classifyDtcCommand({
    row,
    expectedVehicleId,
    expectedType: 'read_dtc',
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    now,
  });

  if (outcome.kind === 'WAITING_FOR_VEHICLE' || outcome.kind === 'READING') {
    return null;
  }

  const body = (row.result && typeof row.result === 'object' && !Array.isArray(row.result))
    ? row.result as Record<string, unknown>
    : null;

  /* Kapsam alanları ARAÇTAN gelir; yoksa `null` (varsayılan UYDURULMAZ). */
  const completeness = outcome.kind === 'RESULT' || outcome.kind === 'NO_DTC'
    ? outcome.completeness ?? null
    : null;
  const permanentSupported = typeof body?.permanentSupported === 'boolean'
    ? body.permanentSupported
    : null;

  const measuredAt = outcome.kind === 'RESULT' || outcome.kind === 'NO_DTC'
    ? outcome.readAt ?? null
    : null;

  const partial = (outcome.kind === 'RESULT' || outcome.kind === 'NO_DTC')
    ? outcome.partial === true
    : false;

  /* Kod listesi YALNIZ başarılı okumadan gelir. Başarısız durumda BOŞ kalır —
     ama bu "kod yok" DEMEK DEĞİLDİR; onu `status` söyler. */
  const dtcs: readonly DtcCode[] = outcome.kind === 'RESULT' ? outcome.dtcs : [];

  const failureReason = (outcome.kind === 'UNSUPPORTED' || outcome.kind === 'OFFLINE'
    || outcome.kind === 'TIMEOUT' || outcome.kind === 'FAILED' || outcome.kind === 'STALE')
    ? outcome.reason
    : null;

  return {
    sourceCommandId: row.id,
    vehicleId: expectedVehicleId,
    status: outcome.kind,
    measuredAt,
    completedAt: row.finished_at ?? null,
    partial,
    completeness,
    permanentSupported,
    dtcs,
    failureReason,
  };
}

/* ── Projeksiyon — KANIT DİLİ ──────────────────────────────────────────── */

export interface ScanSummary {
  /** Tek satırlık dürüst özet. */
  readonly headline: string;
  /** Kapsamın NEYİ KAPSAMADIĞI — boş liste "her şey kapsandı" DEMEK DEĞİLDİR. */
  readonly limitations: readonly string[];
  /** Bu tarama "kod bulunmadı" diyebilir mi? */
  readonly claimsZeroDtc: boolean;
  readonly status: DiagnosticScanStatus;
}

/** Kapsam sınırlarını ARAÇ verisinden türetir — yeni kural üretmez. */
function limitationsOf(scan: DiagnosticScanRecord): string[] {
  const out: string[] = [];
  if (scan.partial) {
    out.push('Tarama kısmi tamamlandı — tüm kontrol üniteleri doğrulanamadı.');
  }
  const c = scan.completeness;
  if (c) {
    if (c.stored    && c.stored    !== 'ok') out.push('Kayıtlı arıza kodları okunamadı.');
    if (c.pending   && c.pending   !== 'ok') out.push('Bekleyen arıza kodları okunamadı.');
    if (c.permanent && c.permanent !== 'ok') out.push('Kalıcı arıza kodları okunamadı.');
  }
  if (scan.permanentSupported === false) {
    out.push('Bu araç kalıcı arıza kodu servisini desteklemiyor.');
  }
  return out;
}

/**
 * Tek taramanın tüketici diline çevrimi.
 *
 * HÜKÜM ÜRETİLMEZ: "tamir edildi", "araç sağlam", "sorun çözüldü" gibi
 * ifadeler YOKTUR. Başarısız tarama "kod yok" DEMEZ.
 */
export function summarizeScan(scan: DiagnosticScanRecord): ScanSummary {
  const limitations = limitationsOf(scan);

  switch (scan.status) {
    case 'RESULT': {
      const n = scan.dtcs.length;
      return {
        headline: n === 1
          ? '1 arıza kodu görüldü.'
          : `${n} arıza kodu görüldü.`,
        limitations, claimsZeroDtc: false, status: scan.status,
      };
    }
    case 'NO_DTC':
      return {
        /* "Bu taramanın kapsamında" ifadesi ZORUNLU: kapsam dışı bir arıza
           olabilir; cümle aracın tamamı hakkında hüküm VERMEZ (§19). */
        headline: scan.partial
          ? 'Tarama kısmi tamamlandı — okunabilen kapsamda arıza kodu bulunmadı.'
          : 'Tarama tamamlandı — bu taramanın kapsamında arıza kodu bulunmadı.',
        limitations, claimsZeroDtc: !scan.partial, status: scan.status,
      };
    case 'UNSUPPORTED':
      return {
        headline: 'Araç bu taramayı desteklemiyor — sonuç alınamadı.',
        limitations, claimsZeroDtc: false, status: scan.status,
      };
    case 'OFFLINE':
      return {
        headline: 'Araca ulaşılamadı — tarama yapılamadı.',
        limitations, claimsZeroDtc: false, status: scan.status,
      };
    case 'TIMEOUT':
      return {
        headline: 'Araç yanıt vermedi — tarama tamamlanamadı.',
        limitations, claimsZeroDtc: false, status: scan.status,
      };
    case 'STALE':
      return {
        headline: 'Sonuç güncelliğini yitirdi — tarama tekrarlanmalı.',
        limitations, claimsZeroDtc: false, status: scan.status,
      };
    case 'FAILED':
      return {
        headline: 'Tarama tamamlanamadı.',
        limitations, claimsZeroDtc: false, status: scan.status,
      };
  }
}

/* ── Kod geçmişi — GÖRÜLDÜ dili ────────────────────────────────────────── */

export interface DtcSighting {
  readonly code: string;
  /** Bu kodun EN SON GÖRÜLDÜĞÜ tarama anı (ISO). Bilinmiyorsa `null`. */
  readonly lastSeenAt: string | null;
  /** Kaç BAŞARILI taramada görüldü. */
  readonly seenInScans: number;
  /**
   * EN SON BAŞARILI taramada görüldü mü?
   *
   * `false` "TAMİR EDİLDİ" DEMEK DEĞİLDİR: ECU silinmiş, arıza aralıklı
   * olabilir ya da o taramanın kapsamı farklı olabilir (§7).
   */
  readonly seenInLatestScan: boolean;
}

/**
 * Başarılı taramalardan kod görülme geçmişi çıkarır.
 *
 * YALNIZ başarılı taramalar sayılır: düşmüş bir tarama "görülmedi" kanıtı
 * ÜRETMEZ. Taramalar `measuredAt`/`completedAt` azalan sırada beklenir;
 * sıralama ÇAĞIRANIN sorumluluğudur (bu modül saat okumaz).
 */
export function buildDtcSightings(
  scansNewestFirst: readonly DiagnosticScanRecord[],
): readonly DtcSighting[] {
  const successful = scansNewestFirst.filter((s) => scanSucceeded(s.status));
  const latest = successful[0] ?? null;
  const latestCodes = new Set((latest?.dtcs ?? []).map((d) => d.code));

  const acc = new Map<string, { lastSeenAt: string | null; count: number }>();
  for (const scan of successful) {
    for (const dtc of scan.dtcs) {
      const prev = acc.get(dtc.code);
      if (prev) {
        prev.count += 1;
      } else {
        acc.set(dtc.code, {
          lastSeenAt: scan.measuredAt ?? scan.completedAt ?? null,
          count: 1,
        });
      }
    }
  }

  return Array.from(acc.entries()).map(([code, v]) => ({
    code,
    lastSeenAt: v.lastSeenAt,
    seenInScans: v.count,
    seenInLatestScan: latestCodes.has(code),
  }));
}

/**
 * EN SON BAŞARILI tarama — paylaşım raporu ve "Son Tarama" yüzeyi için.
 *
 * Hiç başarılı tarama yoksa `null`. `null` "arıza yok" DEĞİL, "hiç
 * ölçülmedi"dir (§16 · §19).
 */
export function latestSuccessfulScan(
  scansNewestFirst: readonly DiagnosticScanRecord[],
): DiagnosticScanRecord | null {
  return scansNewestFirst.find((s) => scanSucceeded(s.status)) ?? null;
}

/* ── Kalıcı kayıt → GÜNCEL kanıt (F5.4) ────────────────────────────────── */

/**
 * Kalıcı bir taramayı, GÜNCEL sağlık değerlendirmesine girebilecek kanıta
 * çevirir — ya da çeviremiyorsa bunu açıkça söyler.
 *
 * ── NEDEN GEREKLİ ────────────────────────────────────────────────────────
 * Geçmiş kayıt tablosundaki son satır KÖRLEMESİNE güncel teşhis sayılamaz.
 * "12 Eylül'de P0300 görüldü" ile "bugün P0300 var" AYNI ŞEY DEĞİLDİR.
 * Bu fonksiyon o sınırı TEK yerde uygular.
 *
 * ── YENİ EŞİK UYDURULMADI ────────────────────────────────────────────────
 * Güncellik penceresi KANONİKTİR: `DTC_HEALTH_MAX_AGE_MS` (F2.2 okuma
 * katmanının kendi güven penceresi, 24 saat). Aynı sabit, aynı karşılaştırma;
 * "history kaydı X dakikadan gençse current" gibi GİZLİ bir ürün kuralı
 * EKLENMEZ. Pencere aşılırsa sonuç `STALE`dir ve F2.2 onu `NO_EVIDENCE`
 * sayar — yani eski bir arıza kodu bugünün hükmünü ÜRETEMEZ.
 *
 * ── BAŞARISIZ TARAMALAR ──────────────────────────────────────────────────
 * `UNSUPPORTED`/`OFFLINE`/`TIMEOUT`/`FAILED`/`STALE` aynen taşınır. Hiçbiri
 * "arıza var" ya da "arıza yok" DEĞİLDİR; F2.2 hepsini `NO_EVIDENCE` sayar.
 * Bunları `NO_DTC`ye ÇEVİRMEK yasaktır (§14).
 *
 * @returns `null` = değerlendirilecek tarama YOK (okunmadı/hiç yok).
 */
export function durableScanToCurrentDtcEvidence(
  scan: DiagnosticScanRecord | null | undefined,
  now: number,
  maxAgeMs: number = DTC_HEALTH_MAX_AGE_MS,
): DtcOutcome | null {
  if (!scan) return null;

  switch (scan.status) {
    case 'UNSUPPORTED':
    case 'OFFLINE':
    case 'TIMEOUT':
    case 'FAILED':
    case 'STALE':
      return { kind: scan.status, reason: scan.failureReason ?? 'Tarama tamamlanamadı' };
    default:
      break;
  }

  /* Ölçüm anı bilinmiyorsa GÜNCEL sayılamaz — "az önce" VARSAYILMAZ. */
  const measuredAt = scan.measuredAt ? Date.parse(scan.measuredAt) : NaN;
  if (!Number.isFinite(measuredAt)) {
    return { kind: 'STALE', reason: 'Ölçüm anı bilinmiyor' };
  }
  /* KANONİK güven penceresi — `classifyDtcCommand` ile AYNI kural. */
  if (now - measuredAt > maxAgeMs) {
    return { kind: 'STALE', reason: 'Son teşhis okuması güncelliğini yitirdi' };
  }

  const common = {
    partial: scan.partial,
    ...(scan.measuredAt ? { readAt: scan.measuredAt } : {}),
    ...(scan.completeness ? { completeness: scan.completeness } : {}),
  };

  return scan.status === 'RESULT'
    ? { kind: 'RESULT', dtcs: [...scan.dtcs], ...common }
    : { kind: 'NO_DTC', ...common };
}

/* ── DB satırı → kalıcı kayıt (F5.4) ───────────────────────────────────── */

/** `vehicle_diagnostic_scans` satırının okunan alanları. */
export interface DiagnosticScanRow {
  readonly vehicle_id?: unknown;
  readonly source_command_id?: unknown;
  readonly status?: unknown;
  readonly measured_at?: unknown;
  readonly completed_at?: unknown;
  readonly partial?: unknown;
  readonly completeness?: unknown;
  readonly permanent_supported?: unknown;
  readonly dtcs?: unknown;
  readonly failure_reason?: unknown;
}

const SCAN_STATUSES: readonly DiagnosticScanStatus[] =
  ['RESULT', 'NO_DTC', 'UNSUPPORTED', 'OFFLINE', 'TIMEOUT', 'FAILED', 'STALE'];

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/**
 * Kalıcı satırı kod sözleşmesine çevirir — SAF ve FAIL-CLOSED.
 *
 * Tanınmayan `status` ya da eksik kimlik → `null`. Bozuk satırdan kayıt
 * UYDURULMAZ; okunamayan satır "arıza yok" DEĞİLDİR.
 *
 * Kodlar YALNIZ `RESULT` için taşınır: DB kısıtı bunu zaten zorlar, kod
 * tarafı da aynı invaryantı korur (savunma derinliği).
 */
export function rowToDiagnosticScanRecord(
  row: DiagnosticScanRow | null | undefined,
): DiagnosticScanRecord | null {
  if (!row) return null;

  const vehicleId = str(row.vehicle_id);
  const status = SCAN_STATUSES.find((s) => s === row.status) ?? null;
  if (!vehicleId || !status) return null;

  const rawDtcs = Array.isArray(row.dtcs) ? row.dtcs : [];
  const dtcs: DtcCode[] = status === 'RESULT'
    ? rawDtcs.filter((d): d is DtcCode =>
        !!d && typeof d === 'object' && typeof (d as DtcCode).code === 'string')
    : [];

  const completeness = row.completeness && typeof row.completeness === 'object'
    && !Array.isArray(row.completeness)
    ? row.completeness as DtcCompleteness
    : null;

  return {
    sourceCommandId: str(row.source_command_id) ?? '',
    vehicleId,
    status,
    measuredAt: str(row.measured_at),
    completedAt: str(row.completed_at),
    partial: row.partial === true,
    completeness,
    permanentSupported: typeof row.permanent_supported === 'boolean'
      ? row.permanent_supported : null,
    dtcs,
    failureReason: str(row.failure_reason),
  };
}
