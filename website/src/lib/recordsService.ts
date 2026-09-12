/**
 * recordsService.ts — "Arabam Cebimde" Kayıtlar sekmesinin veri otoritesi.
 *
 * ÖLÇÜLEN KUSUR (2026-08-14): Yakıt ve Servis kayıtları **tamamen
 * `localStorage`**taydı. Üç somut sonuç:
 *   1. Telefon değişince / tarayıcı verisi temizlenince kayıtlar **yok oluyordu**.
 *   2. Depo anahtarı **SABİTTİ** (`caros_fuel_log`) → araç bazlı DEĞİLDİ; iki
 *      araç eşleştiren kullanıcıda kayıtlar **birbirine karışıyordu**.
 *   3. Hiçbir sunucu kaydı olmadığı için bakım zekâsı bu veriden beslenemiyordu.
 *
 * ── DÜRÜSTLÜK SÖZLEŞMESİ ────────────────────────────────────────────────────
 *  · **Oturum yoksa sunucuya yazılamaz** (tablolar `authenticated` RLS'lidir).
 *    Bu durumda kayıt yerelde tutulur ama ekran bunu AÇIKÇA söyler: "yalnız bu
 *    cihazda". Sessizce "kaydedildi" DENMEZ.
 *  · Yazma başarısızsa `saved: false` döner — çağıran yalancı onay gösteremez.
 *  · Yerel depo artık **araç kapsamlıdır**; eski sabit anahtar okunur ve BİR
 *    KEZ göç ettirilir (veri kaybı yok), sonra araç kapsamlı anahtara yazılır.
 *  · Bilinmeyen kilometre `null`dur — **sahte 0 yazılmaz** (DB de NULL kabul eder).
 *  · **Sunucu yazması geçici olarak başarısızsa kayıt ÇEVRİMDIŞI KUYRUĞA
 *    alınır** ve bağlantı gelince gönderilir. Kuyruktaki kayıt ekranda
 *    "gönderilmeyi bekliyor" olarak GÖRÜNÜR — sunucuda sanılmaz, ama
 *    listeden de kaybolmaz.
 */

import { supabaseBrowser, isSupabaseConfigured } from './supabase';
import {
  pushFuelLog,
  pushServiceRecord,
  deleteFuelLog,
  deleteServiceRecord,
  updateFuelLog,
  updateServiceRecord,
  type ServerWriteResult,
} from './recordsServerWriter';
import { enqueueOfflineMutation, getQueue } from './offline/fleetOffline';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

/**
 * Tek bir kaydın NEREDE olduğu.
 *   SERVER — sunucuda doğrulandı.
 *   QUEUED — çevrimdışı kuyrukta, gönderilmeyi bekliyor.
 *   LOCAL  — yalnız bu cihazda (oturum yok ya da göç edilmiş eski kayıt);
 *            kuyrukta DEĞİL, kendiliğinden gitmeyecek.
 */
export type EntrySync = 'SERVER' | 'QUEUED' | 'LOCAL';

export interface FuelEntry {
  id:         string;
  filledOn:   string;          // YYYY-MM-DD
  odometerKm: number | null;   // null = kullanıcı bilmiyor (sahte 0 YOK)
  liters:     number;
  pricePerL:  number | null;
  /** Çift gösterimi engelleyen istemci anahtarı (sunucu tarafında benzersiz). */
  clientRef?: string | null;
  /** Kaydın gerçek yeri. Eski kayıtlarda yoktur → `LOCAL` varsayılır. */
  sync?:      EntrySync;
}

export interface ServiceEntry {
  serviceKey:  string;
  performedOn: string;
  odometerKm:  number | null;
  clientRef?:  string | null;
  sync?:       EntrySync;
  /** Sunucu satır kimliği — yalnız `sync === 'SERVER'` kayıtlarda vardır. */
  id?:         string;
}

/**
 * Kayıtların NEREDE yaşadığı. Ekran bunu göstermek ZORUNDADIR — kullanıcı
 * verisinin buluta gidip gitmediğini bilmelidir.
 */
export type RecordsStorageMode =
  | 'SERVER'        // oturum var, sunucuya yazılıyor
  | 'LOCAL_ONLY'    // oturum yok → yalnız bu cihazda
  | 'QUEUED'        // sunucuya ulaşılamadı → kuyrukta, bağlantı gelince gidecek
  | 'SERVER_ERROR'; // oturum var ama sunucu okunamadı/reddetti → yerel gösteriliyor

export interface RecordsLoadResult<T> {
  entries: T[];
  mode:    RecordsStorageMode;
  /** Sunucu hatası varsa gerçek mesaj (uydurulmaz). */
  error?:  string;
}

export interface RecordsSaveResult {
  /** true = kayıt GERÇEKTEN kalıcı oldu (sunucuda ya da yerelde). */
  saved: boolean;
  mode:  RecordsStorageMode;
  error?: string;
}

/* ── Yerel depo (araç kapsamlı) ───────────────────────────────────────────── */

const LEGACY_FUEL_KEY    = 'caros_fuel_log';
const LEGACY_SERVICE_KEY = 'caros_service_log';

function fuelKey(vehicleId: string): string    { return `caros_fuel_log_v2:${vehicleId}`; }
function serviceKey(vehicleId: string): string { return `caros_service_log_v2:${vehicleId}`; }

function readLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch { return []; }
}

function writeLocal<T>(key: string, entries: T[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, 200)));
    return true;
  } catch { return false; }
}

/**
 * Eski SABİT anahtardaki kayıtları araç kapsamlı anahtara BİR KEZ taşır.
 * Eski anahtar SİLİNMEZ — birden çok araç varsa hangisine ait olduğu
 * bilinemez; veri kaybetmemek için ilk açan araç kopyalar, kaynak durur.
 */
export function migrateLegacyFuelLog(vehicleId: string): FuelEntry[] {
  const scoped = readLocal<FuelEntry>(fuelKey(vehicleId));
  if (scoped.length > 0) return scoped;

  type LegacyFuel = { id: string; date: string; km: number; liters: number; pricePerL: number };
  const legacy = readLocal<LegacyFuel>(LEGACY_FUEL_KEY);
  if (legacy.length === 0) return [];

  const converted: FuelEntry[] = legacy.map((e) => ({
    id:         e.id,
    filledOn:   e.date,
    // Eski biçimde km her zaman sayıydı; 0 ise "bilinmiyor" sayılır
    // (eski form kilometre zorunluydu ama boş bırakılınca 0 yazıyordu).
    odometerKm: Number.isFinite(e.km) && e.km > 0 ? Math.round(e.km) : null,
    liters:     e.liters,
    pricePerL:  Number.isFinite(e.pricePerL) ? e.pricePerL : null,
  }));
  writeLocal(fuelKey(vehicleId), converted);
  return converted;
}

export function migrateLegacyServiceLog(vehicleId: string): ServiceEntry[] {
  const scoped = readLocal<ServiceEntry>(serviceKey(vehicleId));
  if (scoped.length > 0) return scoped;

  try {
    const raw = localStorage.getItem(LEGACY_SERVICE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as Record<string, { lastKm?: number; lastDate?: string }>;
    const converted: ServiceEntry[] = Object.entries(saved)
      .filter(([, v]) => v && v.lastDate)
      .map(([k, v]) => ({
        serviceKey:  k,
        performedOn: String(v.lastDate),
        odometerKm:  typeof v.lastKm === 'number' && v.lastKm > 0 ? Math.round(v.lastKm) : null,
      }));
    if (converted.length > 0) writeLocal(serviceKey(vehicleId), converted);
    return converted;
  } catch { return []; }
}

/* ── Oturum ───────────────────────────────────────────────────────────────── */

/**
 * Oturum sahibi kullanıcı kimliği — yoksa `null`.
 *
 * Kimliğe iki yerde ihtiyaç var: sunucuya yazma kapısı ve **çevrimdışı kuyruk**
 * (kuyruk hesap kapsamlıdır; sahibi bilinmeyen bir kayıt kuyruğa YAZILAMAZ,
 * yoksa bir sonraki kullanıcının oturumunda gönderilmeye çalışılırdı).
 */
async function getSessionUserId(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabaseBrowser) return null;
  try {
    const { data } = await supabaseBrowser.auth.getSession();
    const id = data.session?.user?.id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch { return null; }
}

/** `f-…` / `s-…` biçiminde istemci anahtarı (sunucuda araç başına benzersiz). */
function newClientRef(prefix: 'f' | 's'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sunucu yazması geçici olarak düştüğünde kaydı kuyruğa alır.
 *
 * Kuyruğa alma YALNIZ yeniden denenebilir hatalarda yapılır: RLS reddi veya
 * geçersiz veri kuyrukta beklerse kullanıcı "bağlantı gelince gidecek" sanır
 * ama asla gitmez — bu, ekranın tutamayacağı bir sözdür.
 */
async function queueRecord(
  userId: string,
  operationType: 'FUEL_LOG_ADD' | 'SERVICE_RECORD_ADD',
  vehicleId: string,
  clientRef: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<{ queued: boolean; error?: string }> {
  const res = await enqueueOfflineMutation(userId, {
    operationType,
    actorId:        userId,
    vehicleId,
    payload,
    dedupKey:       `${operationType}:${vehicleId}:${clientRef}`,
    idempotencyKey: clientRef,
  });
  return res.ok ? { queued: true } : { queued: false, error: res.message };
}

/**
 * Yazma sonucunu ekran moduna çevirir. Kuyruğa alınabilen geçici hata
 * `QUEUED`, alınamayan veya kalıcı hata `SERVER_ERROR`dır.
 */
function modeForWriteFailure(result: Exclude<ServerWriteResult, { ok: true }>): string {
  switch (result.errorCode) {
    case 'network_error':          return 'Bağlantı yok — kayıt sıraya alındı.';
    case 'permission_denied':      return 'Bu aracın kayıtlarına yazma yetkiniz yok.';
    case 'vehicle_not_found':      return 'Araç bulunamadı — eşleştirme kopmuş olabilir.';
    case 'invalid_request':        return 'Kayıt sunucu tarafından geçersiz bulundu.';
    case 'supabase_not_configured': return 'Sunucu yapılandırılmamış.';
    default:                       return 'Sunucuya yazılamadı.';
  }
}

/* ── Sunucu + bekleyen birleştirme ───────────────────────────────────────── */

/**
 * SUNUCU listesi ile HENÜZ GİTMEMİŞ yerel kayıtları birleştirir.
 *
 * ── NEDEN GEREKLİ ────────────────────────────────────────────────────────
 * Kayıt kuyruğa alındıktan sonra liste sunucudan yeniden okunur. Yalnız
 * sunucu satırları gösterilseydi, kullanıcının az önce girdiği kayıt
 * **listeden kaybolurdu** — "kaydettim ama yok" görüntüsü, kuyruğun kendisi
 * çalışsa bile ürünü bozuk gösterir.
 *
 * Çift gösterim `clientRef` ile engellenir: sunucuda aynı anahtar varsa
 * yerel kopya ATILIR (sunucu otoritedir). Anahtarı olmayan eski/göç kaydı
 * eşleştirilemez → `LOCAL` etiketiyle gösterilir; "sunucuda" İDDİA EDİLMEZ.
 */
function mergePending<T extends { clientRef?: string | null; sync?: EntrySync }>(
  server: readonly T[],
  local:  readonly T[],
  dateOf: (entry: T) => string,
): T[] {
  const onServer = new Set<string>();
  for (const row of server) {
    if (typeof row.clientRef === 'string' && row.clientRef !== '') onServer.add(row.clientRef);
  }

  const pending = local.filter(
    (row) => !(typeof row.clientRef === 'string' && onServer.has(row.clientRef)),
  );

  // Sunucuda olmayan yerel kayıt kendi etiketini korur; etiketsizse `LOCAL`
  // sayılır — bilinmeyen bir kaydı "kuyrukta" göstermek sahte umut olurdu.
  const labelled = pending.map((row) => (row.sync ? row : { ...row, sync: 'LOCAL' as EntrySync }));

  return [...server, ...labelled].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
}

/* ── Yakıt ────────────────────────────────────────────────────────────────── */

export async function loadFuelEntries(vehicleId: string): Promise<RecordsLoadResult<FuelEntry>> {
  const local = migrateLegacyFuelLog(vehicleId);

  if ((await getSessionUserId()) === null || !supabaseBrowser) {
    return { entries: local, mode: 'LOCAL_ONLY' };
  }

  try {
    const { data, error } = await supabaseBrowser
      .from('vehicle_fuel_logs')
      .select('id, filled_on, odometer_km, liters, price_per_liter, client_ref')
      .eq('vehicle_id', vehicleId)
      .order('filled_on', { ascending: false })
      .limit(200);

    if (error) return { entries: local, mode: 'SERVER_ERROR', error: error.message };

    const rows = (data ?? []) as Array<{
      id: string; filled_on: string; odometer_km: number | null;
      liters: number | string; price_per_liter: number | string | null;
      client_ref: string | null;
    }>;

    const server: FuelEntry[] = rows.map((r) => ({
      id:         r.id,
      filledOn:   r.filled_on,
      odometerKm: r.odometer_km,
      liters:     Number(r.liters),
      pricePerL:  r.price_per_liter === null ? null : Number(r.price_per_liter),
      clientRef:  r.client_ref,
      sync:       'SERVER',
    }));

    return { entries: mergePending(server, local, (e) => e.filledOn), mode: 'SERVER' };
  } catch (e) {
    return {
      entries: local, mode: 'SERVER_ERROR',
      error: e instanceof Error ? e.message : 'Sunucuya ulaşılamadı.',
    };
  }
}

export async function addFuelEntry(
  vehicleId: string,
  entry: Omit<FuelEntry, 'id' | 'clientRef' | 'sync'>,
): Promise<RecordsSaveResult> {
  const clientRef = newClientRef('f');

  /** Yerel kopyayı verilen etiketle yazar — sunucu düşse de veri kaybolmaz. */
  const writeLocalCopy = (sync: EntrySync): boolean => {
    const local = readLocal<FuelEntry>(fuelKey(vehicleId));
    return writeLocal(fuelKey(vehicleId), [{ ...entry, id: clientRef, clientRef, sync }, ...local]);
  };

  const userId = await getSessionUserId();
  if (userId === null) {
    const localOk = writeLocalCopy('LOCAL');
    return {
      saved: localOk, mode: 'LOCAL_ONLY',
      error: localOk ? undefined : 'Cihaz deposuna yazılamadı.',
    };
  }

  const result = await pushFuelLog({
    vehicleId,
    filledOn:   entry.filledOn,
    odometerKm: entry.odometerKm,   // null geçerlidir — sahte 0 YOK
    liters:     entry.liters,
    pricePerL:  entry.pricePerL,
    clientRef,
  });

  if (result.ok) {
    writeLocalCopy('SERVER');
    return { saved: true, mode: 'SERVER' };
  }

  /* GEÇİCİ hata → kuyruk. Kalıcı hata kuyruğa ALINMAZ: "bağlantı gelince
     gidecek" demek tutulamayacak bir sözdür (RLS reddi bağlantıyla düzelmez). */
  if (result.retryable) {
    const queued = await queueRecord(userId, 'FUEL_LOG_ADD', vehicleId, clientRef, {
      vehicleId, clientRef,
      filledOn:   entry.filledOn,
      odometerKm: entry.odometerKm,
      liters:     entry.liters,
      pricePerL:  entry.pricePerL,
    });
    if (queued.queued) {
      const localOk = writeLocalCopy('QUEUED');
      return {
        saved: localOk, mode: 'QUEUED',
        error: localOk ? undefined : 'Cihaz deposuna yazılamadı.',
      };
    }
    // Kuyruk reddetti (dolu / hesap uyuşmazlığı) → sessiz kayıp YOK, gerekçe taşınır.
    const localOk = writeLocalCopy('LOCAL');
    return { saved: localOk, mode: 'SERVER_ERROR', error: queued.error };
  }

  const localOk = writeLocalCopy('LOCAL');
  return { saved: localOk, mode: 'SERVER_ERROR', error: modeForWriteFailure(result) };
}

/* ── Servis ───────────────────────────────────────────────────────────────── */

export async function loadServiceEntries(vehicleId: string): Promise<RecordsLoadResult<ServiceEntry>> {
  const local = migrateLegacyServiceLog(vehicleId);

  if ((await getSessionUserId()) === null || !supabaseBrowser) {
    return { entries: local, mode: 'LOCAL_ONLY' };
  }

  try {
    const { data, error } = await supabaseBrowser
      .from('vehicle_service_records')
      .select('id, service_key, performed_on, odometer_km, client_ref')
      .eq('vehicle_id', vehicleId)
      .order('performed_on', { ascending: false })
      .limit(200);

    if (error) return { entries: local, mode: 'SERVER_ERROR', error: error.message };

    const rows = (data ?? []) as Array<{
      id: string; service_key: string; performed_on: string; odometer_km: number | null;
      client_ref: string | null;
    }>;
    const server: ServiceEntry[] = rows.map((r) => ({
      id:          r.id,
      serviceKey:  r.service_key,
      performedOn: r.performed_on,
      odometerKm:  r.odometer_km,
      clientRef:   r.client_ref,
      sync:        'SERVER',
    }));
    return {
      entries: mergePending(server, local, (e) => e.performedOn),
      mode: 'SERVER',
    };
  } catch (e) {
    return {
      entries: local, mode: 'SERVER_ERROR',
      error: e instanceof Error ? e.message : 'Sunucuya ulaşılamadı.',
    };
  }
}

export async function addServiceEntry(
  vehicleId: string,
  entry: Omit<ServiceEntry, 'clientRef' | 'sync'>,
): Promise<RecordsSaveResult> {
  const clientRef = newClientRef('s');

  // Aynı kalemin yeni kaydı listenin başına gelir; eski kayıt GEÇMİŞ olarak kalır.
  const writeLocalCopy = (sync: EntrySync): boolean => {
    const local = readLocal<ServiceEntry>(serviceKey(vehicleId));
    return writeLocal(serviceKey(vehicleId), [{ ...entry, clientRef, sync }, ...local]);
  };

  const userId = await getSessionUserId();
  if (userId === null) {
    const localOk = writeLocalCopy('LOCAL');
    return {
      saved: localOk, mode: 'LOCAL_ONLY',
      error: localOk ? undefined : 'Cihaz deposuna yazılamadı.',
    };
  }

  const result = await pushServiceRecord({
    vehicleId,
    serviceKey:  entry.serviceKey,
    performedOn: entry.performedOn,
    odometerKm:  entry.odometerKm,
    clientRef,
  });

  if (result.ok) {
    writeLocalCopy('SERVER');
    return { saved: true, mode: 'SERVER' };
  }

  if (result.retryable) {
    const queued = await queueRecord(userId, 'SERVICE_RECORD_ADD', vehicleId, clientRef, {
      vehicleId, clientRef,
      serviceKey:  entry.serviceKey,
      performedOn: entry.performedOn,
      odometerKm:  entry.odometerKm,
    });
    if (queued.queued) {
      const localOk = writeLocalCopy('QUEUED');
      return {
        saved: localOk, mode: 'QUEUED',
        error: localOk ? undefined : 'Cihaz deposuna yazılamadı.',
      };
    }
    const localOk = writeLocalCopy('LOCAL');
    return { saved: localOk, mode: 'SERVER_ERROR', error: queued.error };
  }

  const localOk = writeLocalCopy('LOCAL');
  return { saved: localOk, mode: 'SERVER_ERROR', error: modeForWriteFailure(result) };
}

/* ── Silme ────────────────────────────────────────────────────────────────── */

/** Silmenin NEREDE gerçekleştiği — ekran bunu göstermek zorundadır. */
export type DeleteScope = 'SERVER' | 'QUEUE' | 'LOCAL';

export interface RecordsDeleteResult {
  deleted: boolean;
  scope:   DeleteScope;
  error?:  string;
}

/**
 * Kuyrukta bekleyen kaydı iptal eder.
 *
 * ── NEDEN ZORUNLU ────────────────────────────────────────────────────────
 * "Sırada" bir kayıt yalnız yerelden silinseydi, kuyruk onu bağlantı gelince
 * yine de sunucuya gönderirdi: kullanıcının SİLDİĞİ kayıt birkaç dakika
 * sonra hesabında BELİRİRDİ. Silme, kaydın yaşadığı HER yerde yapılmalıdır.
 */
async function cancelQueuedRecord(userId: string, clientRef: string): Promise<boolean> {
  try {
    const queue = getQueue(userId);
    const items = await queue.all();
    const target = items.find((i) => i.idempotencyKey === clientRef);
    if (!target) return false;
    await queue.cancel(target.id);
    return true;
  } catch { return false; }
}

/** Yerel listeden kaydı çıkarır; `clientRef` yoksa kimlik/eşdeğerlik ile. */
function removeLocal<T extends { clientRef?: string | null }>(
  key: string,
  matches: (row: T) => boolean,
): boolean {
  const rows = readLocal<T>(key);
  const next = rows.filter((row) => !matches(row));
  if (next.length === rows.length) return false;
  return writeLocal(key, next);
}

async function deleteEntry<T extends { clientRef?: string | null }>(
  vehicleId: string,
  entry: { clientRef?: string | null; sync?: EntrySync; id?: string },
  storageKey: string,
  matches: (row: T) => boolean,
  serverDelete: (vehicleId: string, rowId: string) => Promise<ServerWriteResult>,
): Promise<RecordsDeleteResult> {
  const sync = entry.sync ?? 'LOCAL';

  // 1) Kuyrukta bekleyen kayıt — sunucuya HİÇ gitmedi; iptal + yerelden sil.
  if (sync === 'QUEUED') {
    const userId = await getSessionUserId();
    if (userId && typeof entry.clientRef === 'string') {
      await cancelQueuedRecord(userId, entry.clientRef);
    }
    const ok = removeLocal(storageKey, matches);
    return { deleted: ok, scope: 'QUEUE', error: ok ? undefined : 'Kayıt cihazdan silinemedi.' };
  }

  // 2) Yalnız cihazdaki kayıt — sunucuda yok, sunucuya gitmeye de çalışmaz.
  if (sync !== 'SERVER') {
    const ok = removeLocal(storageKey, matches);
    return { deleted: ok, scope: 'LOCAL', error: ok ? undefined : 'Kayıt cihazdan silinemedi.' };
  }

  // 3) Sunucudaki kayıt — kimlik yoksa silme İDDİA EDİLEMEZ.
  if (typeof entry.id !== 'string' || entry.id === '') {
    return { deleted: false, scope: 'SERVER', error: 'Kaydın sunucu kimliği bilinmiyor; silinemedi.' };
  }

  const result = await serverDelete(vehicleId, entry.id);
  if (!result.ok) {
    // Çevrimdışı silme KUYRUĞA ALINMAZ — "silindi" demek yalan olurdu.
    return {
      deleted: false, scope: 'SERVER',
      error: result.retryable && result.errorCode === 'network_error'
        ? 'Bağlantı yok — kayıt silinemedi. Silme işlemi çevrimdışı yapılamaz.'
        : modeForWriteFailure(result),
    };
  }

  // Sunucudan gitti → yerel kopyası da temizlenir (yoksa listede "yalnız
  // cihazda" olarak yeniden belirirdi).
  removeLocal(storageKey, matches);
  return { deleted: true, scope: 'SERVER' };
}

export function deleteFuelEntry(vehicleId: string, entry: FuelEntry): Promise<RecordsDeleteResult> {
  const ref = entry.clientRef ?? entry.id;
  return deleteEntry<FuelEntry>(
    vehicleId, entry, fuelKey(vehicleId),
    (row) => row.clientRef === ref || row.id === ref,
    deleteFuelLog,
  );
}

export function deleteServiceEntry(vehicleId: string, entry: ServiceEntry): Promise<RecordsDeleteResult> {
  const ref = entry.clientRef;
  return deleteEntry<ServiceEntry>(
    vehicleId, entry, serviceKey(vehicleId),
    /* Anahtarı olmayan eski kayıt kalem + tarih ile eşleşir. Aynı kalemin
       aynı gün iki kaydı varsa ikisi de gider — bu bilinçlidir: yanlış kaydı
       bırakıp kullanıcıyı "sildim ama duruyor" durumunda bırakmaktan iyidir. */
    (row) =>
      (typeof ref === 'string' && row.clientRef === ref) ||
      (row.serviceKey === entry.serviceKey && row.performedOn === entry.performedOn),
    deleteServiceRecord,
  );
}

/* ── Düzenleme ────────────────────────────────────────────────────────────
 *
 * ÖLÇÜLEN BOŞLUK (2026-08-14, devir belgesi B4): tablolarda UPDATE ayrıcalığı
 * ve politikası VARDI, ama ne yazma katmanı ne arayüz vardı. Kullanıcı yanlış
 * girdiği litreyi veya kilometreyi düzeltemiyordu — tek çare kaydı silip
 * yeniden girmekti ve bu, tarihi ve sunucudaki kimliği kaybettiriyordu.
 *
 * ── ÜÇ YOL, ÜÇ FARKLI GERÇEK ──────────────────────────────────────────────
 *  · `SERVER` — sunucuda UPDATE. Çevrimdışıysa REDDEDİLİR: kuyruğa alınmış bir
 *    düzenleme, aradan geçen sürede başka cihazdan yapılmış değişikliği sessizce
 *    ezerdi (last-write-wins). "Düzenlendi" demek tutulamayacak bir söz olurdu.
 *  · `QUEUED` — kayıt sunucuya HİÇ gitmedi. Düzenleme = kuyruktakini iptal edip
 *    yerine düzeltilmiş kaydı koymak. Sunucuda değiştirilecek bir satır yoktur.
 *  · `LOCAL`  — yalnız cihazda; yerinde güncellenir.
 */

/** Yerel listede TEK kaydı günceller; eşleşme yoksa `false`. */
function updateLocal<T>(
  key:     string,
  matches: (row: T) => boolean,
  apply:   (row: T) => T,
): boolean {
  const rows = readLocal<T>(key);
  let hit = false;
  const next = rows.map((row) => {
    if (hit || !matches(row)) return row;
    hit = true;
    return apply(row);
  });
  if (!hit) return false;
  return writeLocal(key, next);
}

/** Yakıt kaydının değiştirilebilir alanları. Kimlik alanları (`id`,
 *  `clientRef`, `sync`) DIŞARIDADIR — düzenleme kaydın kimliğini değiştirmez. */
export type FuelEntryEdit = Pick<FuelEntry, 'filledOn' | 'odometerKm' | 'liters' | 'pricePerL'>;

export async function updateFuelEntry(
  vehicleId: string,
  entry:     FuelEntry,
  edit:      FuelEntryEdit,
): Promise<RecordsSaveResult> {
  const sync = entry.sync ?? 'LOCAL';
  const ref  = entry.clientRef ?? entry.id;
  const matches = (row: FuelEntry) => row.clientRef === ref || row.id === ref;

  // Sunucuya hiç gitmemiş kayıt: kuyruktakini iptal et, düzeltilmişi yeniden gönder.
  if (sync === 'QUEUED') {
    const removed = await deleteFuelEntry(vehicleId, entry);
    if (!removed.deleted) {
      return { saved: false, mode: 'QUEUED', error: removed.error ?? 'Sıradaki kayıt güncellenemedi.' };
    }
    return addFuelEntry(vehicleId, edit);
  }

  if (sync !== 'SERVER') {
    const ok = updateLocal<FuelEntry>(fuelKey(vehicleId), matches, (row) => ({ ...row, ...edit }));
    return {
      saved: ok, mode: 'LOCAL_ONLY',
      error: ok ? undefined : 'Kayıt cihazda bulunamadı; güncellenemedi.',
    };
  }

  if (typeof entry.id !== 'string' || entry.id === '') {
    return { saved: false, mode: 'SERVER_ERROR', error: 'Kaydın sunucu kimliği bilinmiyor; güncellenemedi.' };
  }

  const result = await updateFuelLog(vehicleId, entry.id, edit);
  if (!result.ok) {
    return {
      saved: false, mode: 'SERVER_ERROR',
      error: result.retryable && result.errorCode === 'network_error'
        ? 'Bağlantı yok — kayıt güncellenemedi. Düzenleme çevrimdışı yapılamaz.'
        : modeForWriteFailure(result),
    };
  }
  // Sunucu kabul etti → yerel kopya da tazelenir (yoksa liste eski değeri gösterirdi).
  updateLocal<FuelEntry>(fuelKey(vehicleId), matches, (row) => ({ ...row, ...edit }));
  return { saved: true, mode: 'SERVER' };
}

/** Servis kaydının değiştirilebilir alanları. `serviceKey` DEĞİŞMEZ —
 *  başka bir kalem, başka bir kayıttır. */
export type ServiceEntryEdit = Pick<ServiceEntry, 'performedOn' | 'odometerKm'>;

export async function updateServiceEntry(
  vehicleId: string,
  entry:     ServiceEntry,
  edit:      ServiceEntryEdit,
): Promise<RecordsSaveResult> {
  const sync = entry.sync ?? 'LOCAL';
  const ref  = entry.clientRef;
  const matches = (row: ServiceEntry) =>
    (typeof ref === 'string' && row.clientRef === ref) ||
    (row.serviceKey === entry.serviceKey && row.performedOn === entry.performedOn);

  if (sync === 'QUEUED') {
    const removed = await deleteServiceEntry(vehicleId, entry);
    if (!removed.deleted) {
      return { saved: false, mode: 'QUEUED', error: removed.error ?? 'Sıradaki kayıt güncellenemedi.' };
    }
    return addServiceEntry(vehicleId, { serviceKey: entry.serviceKey, ...edit });
  }

  if (sync !== 'SERVER') {
    const ok = updateLocal<ServiceEntry>(serviceKey(vehicleId), matches, (row) => ({ ...row, ...edit }));
    return {
      saved: ok, mode: 'LOCAL_ONLY',
      error: ok ? undefined : 'Kayıt cihazda bulunamadı; güncellenemedi.',
    };
  }

  if (typeof entry.id !== 'string' || entry.id === '') {
    return { saved: false, mode: 'SERVER_ERROR', error: 'Kaydın sunucu kimliği bilinmiyor; güncellenemedi.' };
  }

  const result = await updateServiceRecord(vehicleId, entry.id, edit);
  if (!result.ok) {
    return {
      saved: false, mode: 'SERVER_ERROR',
      error: result.retryable && result.errorCode === 'network_error'
        ? 'Bağlantı yok — kayıt güncellenemedi. Düzenleme çevrimdışı yapılamaz.'
        : modeForWriteFailure(result),
    };
  }
  updateLocal<ServiceEntry>(serviceKey(vehicleId), matches, (row) => ({ ...row, ...edit }));
  return { saved: true, mode: 'SERVER' };
}

/** Düzenleme sonrası mesaj — kaydın GERÇEKTEN nereye yazıldığını söyler. */
export const UPDATE_MODE_MESSAGE: Readonly<Record<RecordsStorageMode, string>> = {
  SERVER:       'Kayıt hesabınızda güncellendi.',
  LOCAL_ONLY:   'Kayıt bu cihazda güncellendi.',
  QUEUED:       'Kayıt güncellendi ve sıraya alındı — bağlantı gelince gönderilecek.',
  SERVER_ERROR: 'Kayıt güncellenemedi.',
} as const;

export const DELETE_SCOPE_MESSAGE: Readonly<Record<DeleteScope, string>> = {
  SERVER: 'Kayıt hesabınızdan silindi.',
  QUEUE:  'Sıradaki kayıt iptal edildi — sunucuya gönderilmeyecek.',
  LOCAL:  'Kayıt bu cihazdan silindi.',
} as const;

/* ── Sunum yardımcıları (saf) ─────────────────────────────────────────────── */

export const STORAGE_MODE_LABEL: Readonly<Record<RecordsStorageMode, string>> = {
  SERVER:       'Hesabınıza kayıtlı',
  LOCAL_ONLY:   'Yalnız bu cihazda',
  QUEUED:       'Sırada — gönderilmeyi bekliyor',
  SERVER_ERROR: 'Sunucu okunamadı — yerel kopya',
} as const;

export const STORAGE_MODE_HINT: Readonly<Record<RecordsStorageMode, string>> = {
  SERVER:       'Kayıtlar hesabınıza bağlıdır; telefon değişse de korunur.',
  LOCAL_ONLY:   'Giriş yapmadığınız için kayıtlar yalnız bu telefonda tutuluyor. Tarayıcı verisi silinirse kaybolur.',
  QUEUED:       'Sunucuya ulaşılamadı. Kayıt cihazda saklandı ve bağlantı gelince otomatik gönderilecek — henüz hesabınıza işlenmedi.',
  SERVER_ERROR: 'Sunucudaki kayıtlar okunamadı; ekranda bu cihazdaki kopya gösteriliyor. Liste eksik olabilir.',
} as const;

/** Tek bir kaydın durum etiketi — liste satırında gösterilir. */
export const ENTRY_SYNC_LABEL: Readonly<Record<EntrySync, string>> = {
  SERVER: 'Hesapta',
  QUEUED: 'Sırada',
  LOCAL:  'Yalnız cihazda',
} as const;

/**
 * Ortalama tüketim — SAF. Kilometresi bilinmeyen kayıtlar hesaba GİRMEZ;
 * iki geçerli ölçüm yoksa sonuç `null`dur ("0 L/100km" bir iddiadır).
 */
export function averageConsumption(entries: readonly FuelEntry[]): number | null {
  const withKm = entries.filter((e) => e.odometerKm !== null && e.liters > 0);
  if (withKm.length < 2) return null;

  const kms = withKm.map((e) => e.odometerKm as number);
  const range = Math.max(...kms) - Math.min(...kms);
  if (range <= 0) return null;

  /* En eski dolum aradaki mesafeye harcanmamıştır (o depoyla gelinen yol
     ölçüm aralığının DIŞINDADIR) → toplamdan düşülür. Bu, klasik
     "tam depo" yöntemidir ve fazla iyimser tüketim üretmez. */
  const oldest = withKm.reduce((a, b) => ((a.odometerKm as number) <= (b.odometerKm as number) ? a : b));
  const liters = withKm.reduce((sum, e) => sum + e.liters, 0) - oldest.liters;
  if (liters <= 0) return null;

  return (liters / range) * 100;
}

/** Toplam harcama — fiyatı bilinmeyen kayıt hesaba GİRMEZ. */
export function totalCost(entries: readonly FuelEntry[]): number | null {
  const priced = entries.filter((e) => e.pricePerL !== null);
  if (priced.length === 0) return null;
  return priced.reduce((sum, e) => sum + e.liters * (e.pricePerL as number), 0);
}
