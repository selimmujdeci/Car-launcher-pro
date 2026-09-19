/**
 * diagnostic-history-writer — TEŞHİS GEÇMİŞİ YAZICISI (F5.3B).
 *
 * ⚠️ YAZILDI, DEPLOY EDİLMEDİ.
 *
 * ── NE YAPAR ─────────────────────────────────────────────────────────────
 * Terminal `read_dtc` komut sonuçlarını KALICI teşhis geçmişine taşır:
 *   vehicle_commands.result → F2.1 sınıflandırma → F5.3 mapper
 *                           → vehicle_diagnostic_scans
 *
 * ── NEDEN UZLAŞTIRICI (RECONCILER), TETİKLEYİCİ DEĞİL ────────────────────
 * "Araç sonucu yazdığı anda kalıcılaştır" seçeneği İLKESEL OLARAK ELENDİ:
 * yazma anı `update_command_status` RPC'sidir ve orası SQL'dir. Sınıflandırma
 * (`classifyDtcCommand` · `parseDtcResult` · completeness mantığı)
 * TypeScript'tedir; SQL'de yeniden yazmak İKİNCİ BİR YORUMCU doğururdu ve
 * zamanla PWA ile ayrışırdı. DB trigger → pg_net → Edge Function yolu da
 * elendi: `pg_net` production'da hiçbir aktif migration'da kullanılmıyor ve
 * o yol "bir kez dene, olmazsa kaybet" demek olurdu.
 *
 * Uzlaştırıcı RETRY'ı BEDAVA verir: yazılamayan satır kalıcılaşmamış olarak
 * kalır ve BİR SONRAKİ TURDA yeniden denenir. "Sonuç geçici tabloda görüldü"
 * ile "kalıcı geçmişe güvenle kaydedildi" ayrımı budur.
 *
 * ── İMLEÇ YOK, ANTI-JOIN VAR (§10) ───────────────────────────────────────
 * İlerleyen bir imleç, yazılamayan satırı SONSUZA DEK atlardı. Bunun yerine
 * "terminal `read_dtc` olup KARŞILIĞI OLMAYAN" satırlar aranır. Başarısız
 * satır kendiliğinden bir sonraki turun adayıdır — kendi kendini onarır.
 * Son idempotens otoritesi DB'deki `source_command_id UNIQUE` kısıtıdır.
 *
 * ── ÇALIŞTIRMA ───────────────────────────────────────────────────────────
 * `retention-manager` / `consumer-notify-scan` ile AYNI desen: Supabase Cron
 * veya dahili servis çağırır, yetki `service_role` bearer'dır.
 *
 * POST /functions/v1/diagnostic-history-writer
 * Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * ÖNERİLEN CADENCE: 15 dakika. Gerekçe: `vehicle_commands` 14 GÜN saklanır,
 * yani kalıcılaştırma için ~1300 fırsat doğar. Teşhis taraması kullanıcı
 * tetiklidir ve nadirdir; saniyelik yoklamanın hiçbir faydası yoktur.
 *
 * ── BU FONKSİYON PUSH GÖNDERMEZ (§14) ────────────────────────────────────
 * Yazıcı ÖLÇÜLMÜŞ GERÇEĞİ kalıcılaştırır; bildirim adaylığı
 * `consumer-notify-scan`in işidir. İki otorite BİRLEŞTİRİLMEZ.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { planDiagnosticPersistence } from '@/lib/diagnostics/diagnosticPersistencePlan';
import type { DtcCommandRow } from '@/lib/diagnostics/dtcResultContract';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Bir turda işlenecek azami komut — sınırsız tarama yok (bounded). */
const BATCH_LIMIT = 200;

/**
 * Geriye bakış penceresi (gün).
 *
 * `vehicle_commands` 14 gün saklanır; 20 gün BİLİNÇLİ OLARAK daha geniştir ki
 * retention politikası ileride gevşetilirse yazıcı kör kalmasın. Pencere
 * dışında kalan satır zaten SİLİNMİŞTİR — kaçırılan bir şey yoktur.
 */
const LOOKBACK_DAYS = 20;

/** Terminal komut durumları — KANONİK sınıflandırıcıyla uyumlu küme. */
const TERMINAL_STATUSES = ['completed', 'failed', 'rejected', 'expired', 'timeout'];

interface CommandRowDb {
  id: string;
  vehicle_id: string;
  type: string;
  status: string;
  result: unknown;
  error_message: string | null;
  created_at: string | null;
  finished_at: string | null;
}

interface ScanIdRow { source_command_id: string | null }

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  /* Yalnız sunucu/iç servis. Tarayıcı teşhis geçmişi YAZDIRAMAZ; bu, tablonun
     RLS'inde yazma policy'si OLMAMASIYLA da ayrıca zorlanır (080). */
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db  = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const now = Date.now();
  const since = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString();

  /* ── 1. Aday satırlar: terminal `read_dtc`, EN ESKİDEN başlayarak ────────
     En eski önce: retention'a (14 gün) en yakın satır en aciliyetlidir. */
  const { data: commands, error: cmdErr } = await db
    .from('vehicle_commands')
    .select('id, vehicle_id, type, status, result, error_message, created_at, finished_at')
    .eq('type', 'read_dtc')
    .in('status', TERMINAL_STATUSES)
    .not('finished_at', 'is', null)
    .gte('finished_at', since)
    .order('finished_at', { ascending: true })
    .limit(BATCH_LIMIT)
    .returns<CommandRowDb[]>();

  if (cmdErr) {
    /* Okunamadı ≠ kayıt yok: hiçbir şey yazılmaz, tur düşer ve YENİDEN denenir. */
    console.error('[diagnostic-history-writer] komutlar okunamadı:', cmdErr.message);
    return new Response(JSON.stringify({ ok: false, reason: 'commands_unreadable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const rows = commands ?? [];
  if (rows.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      tally: { scanned: 0, eligible: 0, persisted: 0, deduped: 0,
               skippedNonTerminal: 0, skippedInvalid: 0, failed: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  /* ── 2. ANTI-JOIN: bu adaylardan hangileri ZATEN kalıcılaşmış? ─────────── */
  const ids = rows.map((r) => r.id);
  const { data: existing, error: existErr } = await db
    .from('vehicle_diagnostic_scans')
    .select('source_command_id')
    .in('source_command_id', ids)
    .returns<ScanIdRow[]>();

  if (existErr) {
    /* Mevcutları okuyamadan YAZMAYIZ: `UNIQUE` yine korurdu ama gereksiz
       çakışma gürültüsü üretirdi. Tur düşer, bir sonraki tur yeniden dener. */
    console.error('[diagnostic-history-writer] mevcut kayıtlar okunamadı:', existErr.message);
    return new Response(JSON.stringify({ ok: false, reason: 'scans_unreadable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const alreadyPersistedCommandIds = new Set(
    (existing ?? []).map((e) => e.source_command_id).filter((v): v is string => !!v),
  );

  /* ── 3. SAF PLAN — karar mantığı burada DEĞİL, paylaşılan çekirdekte ──── */
  const plan = planDiagnosticPersistence({
    now,
    commands: rows as unknown as DtcCommandRow[],
    alreadyPersistedCommandIds,
  });

  /* ── 4. Yazma — SATIR SATIR, biri düşse de diğerleri devam eder (§9) ──── */
  let persisted = 0;
  let failed    = 0;

  for (const rec of plan.records) {
    /* YALNIZ normalize sözleşme yazılır. Ham `result` JSON'u, CAN çerçeveleri,
       ECU dökümleri ve transport iç verisi KALICI GEÇMİŞE GİRMEZ (§12). */
    const { error } = await db.from('vehicle_diagnostic_scans').insert({
      vehicle_id:          rec.vehicleId,
      source_command_id:   rec.sourceCommandId,
      status:              rec.status,
      measured_at:         rec.measuredAt,
      completed_at:        rec.completedAt,
      partial:             rec.partial,
      completeness:        rec.completeness,
      permanent_supported: rec.permanentSupported,
      dtcs:                rec.dtcs,
      failure_reason:      rec.failureReason,
    });

    if (!error) { persisted += 1; continue; }

    /* `23505` = unique_violation → başka bir tur/örnek aynı komutu az önce
       yazdı. Bu bir HATA DEĞİL, idempotensin ÇALIŞTIĞININ kanıtıdır. */
    if ((error as { code?: string }).code === '23505') {
      continue;
    }

    failed += 1;
    /* Hata mesajı loglanır ama DTC/araç içeriği loglanmaz (§11). */
    console.error('[diagnostic-history-writer] kalıcılaştırma düştü:', error.message);
  }

  /* `persisted` YALNIZ DB yazımı kanıtlandığında artar. "İşlendi" ile
     "kalıcılaştı" AYNI ŞEY DEĞİLDİR (§13). */
  const tally = {
    scanned:            plan.tally.scanned,
    eligible:           plan.tally.eligible,
    persisted,
    deduped:            plan.tally.deduped,
    skippedNonTerminal: plan.tally.skippedNonTerminal,
    skippedInvalid:     plan.tally.skippedInvalid,
    failed,
  };

  console.log('[diagnostic-history-writer] tur bitti:', JSON.stringify(tally));
  return new Response(JSON.stringify({ ok: true, tally }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
});
