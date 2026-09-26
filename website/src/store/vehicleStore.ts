import { create } from 'zustand';
import { fetchVehicles } from '@/lib/vehicles.service';
import { formatLastSeen } from '@/lib/utils';
import { getLocalVehicle } from '@/lib/pairingService';
import { TIMING, ALERT_THRESHOLDS } from '@/lib/constants';
import {
  buildVehicleFreshness,
  markVehicleOffline,
  applyFreshnessUpdate,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import type { LiveVehicle, VehicleUpdate, ConnectionStatus } from '@/types/realtime';
import {
  captureCleanupGeneration,
  isAccountAccessLocked,
  isCleanupGenerationCurrent,
} from '@/security/accountCleanup/cleanupLockdown';

// ── Automotive grade: render throttle (20Hz cap) ─────────────────────────────
// Module-level map — outside Zustand state to avoid triggering re-renders
const _lastRenderMs = new Map<string, number>();

// ── Sensor resiliency: reject physically impossible data ──────────────────────
function isValidSensorData(u: VehicleUpdate, existing: LiveVehicle): boolean {
  // NaN values pass through here — applyUpdate uses Number.isFinite() to
  // fall back to the last known good value, preserving sensor continuity.
  if (!Number.isFinite(u.speed))      return true;
  if (!Number.isFinite(u.rpm))        return true;
  if (!Number.isFinite(u.engineTemp)) return true;
  if (!Number.isFinite(u.fuel))       return true;

  // Absolute bounds
  if (u.speed < 0 || u.speed > 300) return false;
  if (u.rpm < 0 || u.rpm > 10_000) return false;
  if (u.engineTemp < -40 || u.engineTemp > 150) return false;
  if (u.fuel < 0 || u.fuel > 100) return false;

  // Ghost Jump: physically impossible speed change in <100 ms (sensor glitch / GPS bounce)
  const timeDelta = u.timestamp - existing.lastTimestamp;
  if (timeDelta > 0 && timeDelta < 100 && Math.abs(u.speed - existing.speed) > 40) return false;

  // Delta bounds — reject large jumps beyond plausible acceleration
  if (Math.abs(u.speed - existing.speed) > 80) return false;
  if (Math.abs(u.rpm - existing.rpm) > 5_000) return false;

  return true;
}

// ── localStorage keys (must match pairingService.ts) ────────────────────────
/* `caros_pair_*` anahtarlarının kopyası BURADAN KALDIRILDI (#632): okuma tek
   otoritededir (`pairingService.getLocalVehicle`). İki ayrı kopya, biri
   düzeltilip öteki eski kuralda kalınca sahada "eşleşti ama araç yok"
   kusurunu üretmişti. */

/**
 * `activeVehicleId` için kalıcı UX HINT'i — KESİNLİKLE bir yetkilendirme
 * otoritesi DEĞİLDİR. Her okuma (`getActiveVehicle`) bunu güncel eşleştirilmiş
 * araç listesine karşı YENİDEN DOĞRULAR; hesabın artık sahip olmadığı bir id
 * sessizce YOK SAYILIR (fail closed), asla komut hedefi olarak KULLANILMAZ.
 *
 * Hesap-kapsamlı storage temizlik sözleşmesine kayıtlıdır:
 * `security/accountCleanup/storage/knownStorageDescriptors.ts` →
 * `active-vehicle-preference` (PURGE_ON_LOGOUT + PURGE_ON_ACCOUNT_SWITCH).
 * Fiziksel temizlik `clearVehicleAuthority()` içinde yapılır — bu, zaten
 * `VehicleMemoryAuthorityCleanupParticipant` tarafından her cleanup'ta
 * çağrılan MEVCUT otoritedir; ikinci bir purge participant KURULMADI.
 */
export const ACTIVE_VEHICLE_STORAGE_KEY = 'caros_active_vehicle_id';

function readPersistedActiveVehicleId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY);
  } catch { return null; }
}

function writePersistedActiveVehicleId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_VEHICLE_STORAGE_KEY, id);
    else localStorage.removeItem(ACTIVE_VEHICLE_STORAGE_KEY);
  } catch { /* kota/SSR — best-effort; bellek-içi state otorite kalır */ }
}

interface VehicleStoreState {
  vehicles: Record<string, LiveVehicle>;
  connectionStatus: ConnectionStatus;
  loading: boolean;
  error: string | null;
  /**
   * TEK OTORİTE: Kumanda/vehicle-control işlemlerinin hedeflediği araç.
   * `vehicles` (eşleştirilmiş + online liste) ile KARIŞTIRILMAZ — birden
   * fazla araç aynı anda ONLINE olabilir, ama komutlar yalnız BURADA
   * işaretli araca gider. `null` = belirsiz → control command FAIL CLOSED.
   */
  activeVehicleId: string | null;
  /** Instant load from localStorage — no network, no auth. Call first. */
  initializeFromLocal: () => void;
  initializeFromSupabase: () => Promise<void>;
  applyUpdate: (update: VehicleUpdate) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  startWatchdog: () => () => void; // returns cleanup fn
  getList: () => LiveVehicle[];
  /** Replace entire vehicle map (used when loading from Supabase). */
  setVehicles: (vehicles: LiveVehicle[]) => void;
  /** Add or upsert a single vehicle (used after linking a new device). */
  addVehicle: (vehicle: LiveVehicle) => void;
  /** Remove a vehicle by id (used after unlinking). */
  removeVehicle: (id: string) => void;
  /**
   * Araç kimliğini (plaka · isim · sürücü) yerelde tazeler — #661.
   * YALNIZCA sunucu yazması BAŞARILI döndükten sonra çağrılır;
   * bu fonksiyon kendi başına hiçbir şey KAYDETMEZ.
   */
  patchVehicleIdentity: (
    id: string,
    patch: { plate?: string | null; name?: string | null; driver?: string | null },
  ) => void;
  clearVehicleAuthority: () => void;
  isVehicleAuthorityEmpty: () => boolean;
  /**
   * Aktif aracı değiştirir. FAIL CLOSED: hedef `vehicles` içinde yoksa
   * (kullanıcının eşleştirilmiş listesinde değil / henüz yüklenmedi)
   * SESSİZCE REDDEDİLİR — mevcut seçim korunur, yanlış/hayalet araç
   * asla aktif olmaz.
   */
  setActiveVehicleId: (id: string | null) => void;
  /**
   * Kanonik aktif araç okuması — TÜM vehicle-scoped ekranlar (Kumanda,
   * Harita, Seyir, Teşhis, Kayıtlar) buradan okur.
   *
   * - `activeVehicleId` geçerliyse (hâlâ eşleştirilmiş listede) o araç.
   * - Tek eşleştirilmiş araç varsa UX'i zorlaştırmadan o araç (madde 7).
   * - Birden fazla araç var ve seçim yok/geçersizse `null` — ekran
   *   "araç seçilmedi" der, HİÇBİR komut ilk/online/last araca gitmez.
   */
  getActiveVehicle: () => LiveVehicle | null;
}

export const useVehicleStore = create<VehicleStoreState>((set, get) => ({
  vehicles: {},
  connectionStatus: 'disconnected',
  loading: true,
  error: null,
  activeVehicleId: null,

  initializeFromLocal: () => {
    const generation = captureCleanupGeneration();
    if (isAccountAccessLocked()) {
      set({ vehicles: {}, connectionStatus: 'disconnected', loading: false, error: null });
      return;
    }
    try {
      /* ── TEK OKUMA OTORİTESİ (#632) ────────────────────────────────────
       * Burası eskiden `localStorage`ı KENDİ okuyordu ve `api_key` yoksa
       * erken dönüyordu. Kanonik eşleştirme rotası ham anahtar DÖNDÜRMEDİĞİ
       * için (eski rota döndürdüğü için kapatılmıştı) yeni akışla eşleşen
       * araç burada SESSİZCE DÜŞÜYORDU: eşleştirme "başarılı" diyor, liste
       * boş kalıyor, sayfa kullanıcıyı otomatik eşleştirme sekmesine geri
       * atıyordu — kullanıcı bunu *"eşleşti diyor yine bu ekran çıkıyor"*
       * diye tarif etti.
       *
       * Kusurun asıl sebebi İKİNCİ OTORİTEYDİ: aynı `caros_pair_*`
       * anahtarlarını `pairingService.getLocalVehicle` ve burası ayrı ayrı
       * okuyordu; biri düzeltilince öteki eski kuralla kaldı. Artık okuma
       * TEK yerdedir. */
      const local = getLocalVehicle();
      if (!local) { set({ loading: false }); return; }
      const id = local.id;

      const existing = get().vehicles[id];
      if (existing) return; // already loaded (Supabase may have beaten us)

      const vehicle: LiveVehicle = {
        id,
        plate:         local.plate,
        name:          local.name,
        driver:        '—',
        status:        'offline',
        /* ⚠️ Eski sayısal yüzey — yalnız geriye uyumluluk. Bu araç henüz
           SUNUCUDAN OKUNMADI; hiçbir ölçüm yapılmadı. Gösterim `telemetry`
           alanından yapılır ve orada her şey `NEVER_SEEN`'dir. */
        lat:           0,
        lng:           0,
        speed:         0,
        fuel:          0,
        engineTemp:    0,
        rpm:           0,
        odometer:      0,
        location:      '—',
        lastSeen:      '—',
        lastTimestamp: 0,
        /* Yerelden kurulan araç: ölçüm YOK → "Veri yok" (0 DEĞİL). */
        telemetry: buildVehicleFreshness({ now: Date.now(), row: null, readable: true }),
      };
      if (!isCleanupGenerationCurrent(generation)) return;
      /* ÇOKLU ARAÇ KUSURU (bu turda bulundu): önceden `vehicles: { [id]: vehicle }`
         yazılıyordu — bu, o ANDAKİ TÜM `state.vehicles`i tek yeni kayıtla
         DEĞİŞTİRİYORDU. İkinci bir araç eşleştirildiğinde (`handlePaired` bunu
         her pairing sonrası çağırır) önceden Supabase'ten yüklenmiş diğer
         araçlar (ör. Megane) ekrandan ANLIK olarak siliniyordu — yalnız
         ardından gelen `initializeFromSupabase()` tamamlanınca kendini
         onarıyordu (çevrimdışıyken onarmıyordu). Artık mevcut kayıt SPREAD
         edilir; ikinci otorite kurulmaz, yalnız eksik giriş eklenir. */
      set((state) => ({ vehicles: { ...state.vehicles, [id]: vehicle }, loading: false }));
    } catch { set({ loading: false }); }
  },

  initializeFromSupabase: async () => {
    const generation = captureCleanupGeneration();
    if (isAccountAccessLocked()) return;
    set({ loading: true, error: null });
    try {
      const vehicles = await fetchVehicles();
      if (!isCleanupGenerationCurrent(generation)) return;
      // Supabase boş döndürdüğünde (auth yok / RLS) localStorage araçlarını silme
      if (vehicles.length === 0) {
        set({ loading: false });
        return;
      }
      const map: Record<string, LiveVehicle> = {};
      for (const vehicle of vehicles) {
        map[vehicle.id] = vehicle;
      }
      set({ vehicles: map, loading: false });
    } catch (error) {
      if (!isCleanupGenerationCurrent(generation)) return;
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Araçlar yüklenemedi.',
      });
    }
  },

  applyUpdate: (update: VehicleUpdate) => {
    if (isAccountAccessLocked()) return;
    const { vehicleId, lat, lng, speed, fuel, engineTemp, rpm, timestamp } = update;
    const now = Date.now();

    // 20Hz throttle — skip update if last render was < RENDER_THROTTLE_MS ago
    const lastMs = _lastRenderMs.get(vehicleId) ?? 0;
    if (now - lastMs < TIMING.RENDER_THROTTLE_MS) return;

    // Sensor resiliency — reject before touching state
    const existing = get().vehicles[vehicleId];
    if (!existing) return;
    if (!isValidSensorData(update, existing)) return;

    _lastRenderMs.set(vehicleId, now);

    const nextSpeed = Number.isFinite(speed) ? speed : existing.speed;
    const nextEngineTemp = Number.isFinite(engineTemp) ? engineTemp : existing.engineTemp;
    const isAlarm = nextEngineTemp > ALERT_THRESHOLDS.ENGINE_TEMP_HIGH_C || nextSpeed > ALERT_THRESHOLDS.SPEED_LIMIT_KMH;

    set((state) => ({
      vehicles: {
        ...state.vehicles,
        [vehicleId]: {
          ...state.vehicles[vehicleId],
          lat: Number.isFinite(lat) ? lat : state.vehicles[vehicleId].lat,
          lng: Number.isFinite(lng) ? lng : state.vehicles[vehicleId].lng,
          speed: Number.isFinite(speed) ? speed : state.vehicles[vehicleId].speed,
          fuel: Number.isFinite(fuel) ? fuel : state.vehicles[vehicleId].fuel,
          engineTemp: Number.isFinite(engineTemp) ? engineTemp : state.vehicles[vehicleId].engineTemp,
          rpm: Number.isFinite(rpm) ? rpm : state.vehicles[vehicleId].rpm,
          status: isAlarm ? 'alarm' : 'online',
          lastSeen: formatLastSeen(timestamp),
          lastTimestamp: timestamp,
          /* Canlı güncelleme geldi → gerçek katmanı da tazelenir.
             `Number.isFinite` geçmeyen alan GÜNCELLENMEZ ve ÖNCEKİ gerçeği
             (null dahil) korur — bilinmeyen 0'a çevrilmez. */
          telemetry: applyFreshnessUpdate(
            state.vehicles[vehicleId].telemetry,
            { lat, lng, speed, fuel, engineTemp, rpm, timestamp },
          ),
        },
      },
    }));
  },

  setConnectionStatus: (status) => {
    if (isAccountAccessLocked()) return;
    set({ connectionStatus: status });
  },

  startWatchdog: () => {
    /* MRI F-08: buradaki `push-notify` çağrısı KALDIRILDI. O slug ARAÇ
       UYANDIRMA otoritesidir (FCM); "araç çevrimdışı" bir İNSAN bildirimidir
       (`consumer-push-notify`, Web Push). Üstelik çağrı Authorization
       taşımıyordu (her zaman 401) ve tüketici fonksiyonu tarayıcıdan
       ÇAĞRILAMAZ (service_role). Tarayıcı "kendime bildirim gönder"
       diyemez; üretici sunucudur (`consumer-notify-scan`). vehicle_offline
       için sunucu üreticisi HENÜZ BAĞLI DEĞİL — CODE READY / NOT WIRED;
       burada sahte-çalışan bir çağrı bırakmak yerine dürüstçe yok. */
    const interval = setInterval(() => {
      const now = Date.now();
      set((state) => {
        let changed = false;
        const next = { ...state.vehicles };

        for (const [id, v] of Object.entries(next)) {
          if (v.status !== 'offline' && now - v.lastTimestamp > TIMING.OFFLINE_TIMEOUT_MS) {
            /* ⚠️ ÖNCEDEN: `speed: 0, rpm: 0` yazılıyordu — araç çevrimdışına
               düşünce UI "0 km/h · 0 rpm" gösteriyordu. Bu UYDURMA ölçümdür:
               araç 90 km/h giderken bağlantı koptuysa hız 0 DEĞİL, BİLİNMİYOR.
               Artık son ölçüm KORUNUR, durum `offline` olur ve gerçek katmanı
               (`telemetry`) bunu "araç çevrimdışı" diye ETİKETLER. */
            next[id] = {
              ...v,
              status: 'offline',
              lastSeen: formatLastSeen(v.lastTimestamp),
              telemetry: v.telemetry
                ? markVehicleOffline(v.telemetry)
                : v.telemetry,
            };
            changed = true;
          }
        }

        return changed ? { vehicles: next } : state;
      });
    }, TIMING.WATCHDOG_INTERVAL_MS);

    return () => clearInterval(interval);
  },

  getList: () => Object.values(get().vehicles),

  setVehicles: (vehicles: LiveVehicle[]) => {
    if (isAccountAccessLocked()) return;
    const map: Record<string, LiveVehicle> = {};
    for (const v of vehicles) map[v.id] = v;
    set({ vehicles: map });
  },

  addVehicle: (vehicle: LiveVehicle) => {
    if (isAccountAccessLocked()) return;
    set((state) => ({
      vehicles: { ...state.vehicles, [vehicle.id]: vehicle },
    }));
  },

  removeVehicle: (id: string) => {
    if (isAccountAccessLocked()) return;
    // Kaldırılan araç kalıcı tercih hint'iyse (unpair), o hint invalidate
    // edilir — aksi halde artık var olmayan bir araca işaret eden bir
    // "yetim" tercih storage'da kalır. `getActiveVehicle` bunu zaten
    // varlık kontrolüyle görmezden gelirdi; bu satır yalnız hijyen içindir.
    if (readPersistedActiveVehicleId() === id) writePersistedActiveVehicleId(null);
    set((state) => {
      const next = { ...state.vehicles };
      delete next[id];
      return { vehicles: next };
    });
  },

  patchVehicleIdentity: (id, patch) => {
    if (isAccountAccessLocked()) return;
    set((state) => {
      const existing = state.vehicles[id];
      if (!existing) return state;
      return {
        vehicles: {
          ...state.vehicles,
          [id]: {
            ...existing,
            plate:  patch.plate  !== undefined ? patch.plate  ?? '' : existing.plate,
            name:   patch.name   !== undefined ? patch.name   ?? '' : existing.name,
            driver: patch.driver !== undefined ? patch.driver ?? '—' : existing.driver,
          },
        },
      };
    });
  },

  clearVehicleAuthority: () => {
    _lastRenderMs.clear();
    /* Kalıcı tercih hint'i de temizlenir — bir sonraki hesap (logout/account
       switch) bu hesabın aktif araç seçimini MİRAS ALMAZ. Bu fonksiyon zaten
       `VehicleMemoryAuthorityCleanupParticipant` tarafından HER cleanup'ta
       (`LOCAL_PRIVATE_DATA_PURGE` fazı) çağrılan tek otoritedir — ikinci bir
       storage-purge participant kurulmadı. */
    writePersistedActiveVehicleId(null);
    set({
      vehicles: {},
      connectionStatus: 'disconnected',
      loading: false,
      error: null,
      activeVehicleId: null,
    });
  },

  isVehicleAuthorityEmpty: () => {
    const state = get();
    return Object.keys(state.vehicles).length === 0 &&
      state.connectionStatus === 'disconnected' &&
      state.error === null &&
      state.activeVehicleId === null;
  },

  setActiveVehicleId: (id) => {
    if (isAccountAccessLocked()) return;
    const state = get();
    // FAIL CLOSED: kullanıcının eşleştirilmiş/erişimli listesinde olmayan
    // hedef asla aktif olamaz — sessizce reddedilir, mevcut seçim kalır.
    if (id !== null && !state.vehicles[id]) return;
    // Kalıcı hint yalnız UX tercihi olarak yazılır — bkz. `getActiveVehicle`
    // yorumu: bu değer hiçbir zaman doğrudan bir authorization kararı
    // ÜRETMEZ, yalnız bir sonraki okumada YENİDEN doğrulanacak bir ipucudur.
    writePersistedActiveVehicleId(id);
    set({ activeVehicleId: id });
  },

  getActiveVehicle: () => {
    const state = get();
    if (state.activeVehicleId && state.vehicles[state.activeVehicleId]) {
      return state.vehicles[state.activeVehicleId];
    }
    const list = Object.values(state.vehicles);
    // Tek araç varsa doğal olarak aktif (madde 7) — belirsiz seçim asla
    // ilk/online/son-bağlanan araca otomatik düşmez (fail closed).
    if (list.length === 1) return list[0];
    if (list.length > 1) {
      /* Kalıcı UX hint'i restore edilir — ANCAK yalnız güncel eşleştirilmiş
         listeye karşı YENİDEN DOĞRULANDIKTAN sonra. Hesabın artık sahip
         olmadığı / hiç var olmamış bir id (bozuk değer, başka hesabın
         eskiden kalan tercihi, unpair edilmiş araç) burada SESSİZCE
         reddedilir — asla komut hedefi olarak kullanılmaz, crash da üretmez
         (salt bir obje-anahtarı bakışıdır). */
      const persisted = readPersistedActiveVehicleId();
      if (persisted && state.vehicles[persisted]) return state.vehicles[persisted];
    }
    return null;
  },
}));
