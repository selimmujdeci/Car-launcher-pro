/**
 * diagnosticPersistencePlan — KALICILAŞTIRMA PLANI (F5.3B, saf çekirdek).
 *
 * ── NE YAPAR ─────────────────────────────────────────────────────────────
 * Aday `read_dtc` komut satırlarını alır ve HANGİLERİNİN kalıcı teşhis
 * geçmişine yazılacağına karar verir. Hiçbir I/O yapmaz: DB okuma/yazma
 * çağırana (Edge Function) aittir. Böylece karar mantığı fonksiyondan
 * BAĞIMSIZ test edilebilir.
 *
 * ── İKİNCİ YORUMCU YOK ───────────────────────────────────────────────────
 * Durum yorumu BURADA YAPILMAZ. `buildDiagnosticScanRecord` (F5.3) çağrılır,
 * o da F2.1 `classifyDtcCommand`i çağırır. `RESULT` · `NO_DTC` · `TIMEOUT` ·
 * `OFFLINE` · `UNSUPPORTED` · `FAILED` · `STALE` ayrımı KANONİK yerden gelir;
 * bu dosya tek bir eşik veya durum adı bile ÜRETMEZ.
 *
 * ── ARAÇ BAĞI İSTEMCİDEN GELMEZ (§7) ─────────────────────────────────────
 * Kaydın araç kapsamı DAİMA komut satırının KENDİ `vehicle_id`sinden alınır.
 * Çağıran bir `vehicleId` DAYATAMAZ; bu yüzden fonksiyon öyle bir parametre
 * KABUL ETMEZ. "B aracının sonucunu A'nın geçmişine yaz" yolu imkânsızdır.
 *
 * ── İDEMPOTENS (§8) ──────────────────────────────────────────────────────
 * Zaten kalıcılaşmış komut kimlikleri girdi olarak verilir ve elenir. Son
 * otorite yine DB'deki `source_command_id UNIQUE` kısıtıdır: yarış durumunda
 * ikinci yazım DB tarafından reddedilir. İKİ AYRI gerçek tarama aynı kodları
 * verse bile AYRI komut kimliği taşıdığı için AYRI kayıttır.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · Supabase YOK.
 */

import {
  buildDiagnosticScanRecord,
  type DiagnosticScanRecord,
} from './diagnosticHistory';
import type { DtcCommandRow } from './dtcResultContract';

/* ── Gözlemlenebilirlik (§13) ──────────────────────────────────────────── */

/**
 * Tur sayaçları.
 *
 * `persisted` BU MODÜLDE YOKTUR — kalıcılaştırma bir DB gerçeğidir ve ancak
 * yazma KANITLANDIĞINDA sayılabilir. Burada yalnız "yazılmaya aday" sayılır.
 * "işlendi" ile "kalıcılaştı" AYNI ŞEY DEĞİLDİR.
 */
export interface PersistenceTally {
  /** Bu turda bakılan komut satırı sayısı. */
  readonly scanned: number;
  /** Kalıcı kayda çevrilebilen (yazılmaya aday) satır sayısı. */
  readonly eligible: number;
  /** Zaten kalıcılaşmış olduğu için atlanan. */
  readonly deduped: number;
  /** Henüz terminal olmayan (uçuşta) — ölçüm sonucu YOK. */
  readonly skippedNonTerminal: number;
  /** Yapısal olarak kullanılamaz satır (kimlik/araç alanı yok). */
  readonly skippedInvalid: number;
}

export interface PersistencePlan {
  /** Yazılacak kayıtlar — sırası girdi sırasını korur (deterministik). */
  readonly records: readonly DiagnosticScanRecord[];
  readonly tally: PersistenceTally;
}

export interface PersistencePlanInput {
  /** Değerlendirme anı — ÇAĞIRAN verir (bu modül saat okumaz). */
  readonly now: number;
  /** DB'den gelen aday satırlar (bounded batch). */
  readonly commands: readonly DtcCommandRow[];
  /** Zaten kalıcılaşmış komut kimlikleri (anti-join sonucu). */
  readonly alreadyPersistedCommandIds: ReadonlySet<string>;
  /**
   * Sonucun bayat sayılacağı süre. Verilirse `classifyDtcCommand` eski
   * ölçümü `STALE` sınıflar — bu da KALICILAŞTIRILIR: "bayat bir ölçüm
   * yapıldı" bilgisi, "hiç tarama yok"tan FARKLIDIR.
   */
  readonly maxAgeMs?: number;
}

/* ── Plan ──────────────────────────────────────────────────────────────── */

/** Satır, kayıt üretebilecek yapısal asgariyi taşıyor mu? */
function structurallyUsable(row: DtcCommandRow | null | undefined): row is DtcCommandRow {
  if (!row) return false;
  if (typeof row.id !== 'string' || row.id.length === 0) return false;
  if (typeof row.vehicle_id !== 'string' || row.vehicle_id.length === 0) return false;
  return true;
}

/**
 * Hangi komutların kalıcılaştırılacağını planlar.
 *
 * BOZUK SATIR TÜM TURU DURDURMAZ (§9): kullanılamaz bir satır sayılır ve
 * atlanır, kalan geçerli satırlar işlenmeye devam eder. Aynı şekilde bozuk
 * bir sonuç gövdesi UYDURULMAZ — kanonik sınıflandırıcı onu `FAILED` sayar
 * ve bu DÜRÜST bir kayıttır ("tarama düştü"), "arıza yok" DEĞİLDİR.
 */
export function planDiagnosticPersistence(
  input: PersistencePlanInput,
): PersistencePlan {
  const { now, commands, alreadyPersistedCommandIds, maxAgeMs } = input;

  const records: DiagnosticScanRecord[] = [];
  let deduped = 0;
  let skippedNonTerminal = 0;
  let skippedInvalid = 0;

  for (const row of commands) {
    if (!structurallyUsable(row)) { skippedInvalid += 1; continue; }

    if (alreadyPersistedCommandIds.has(row.id)) { deduped += 1; continue; }

    /* ARAÇ KAPSAMI SATIRIN KENDİSİNDEN: istemci/çağıran dayatamaz (§7). */
    const record = buildDiagnosticScanRecord(row, row.vehicle_id, now, maxAgeMs);

    /* `null` = terminal değil → ölçüm sonucu henüz YOK, kalıcılaştırılmaz. */
    if (record === null) { skippedNonTerminal += 1; continue; }

    records.push(record);
  }

  return {
    records,
    tally: {
      scanned: commands.length,
      eligible: records.length,
      deduped,
      skippedNonTerminal,
      skippedInvalid,
    },
  };
}
