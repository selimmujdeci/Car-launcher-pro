/**
 * smartCardEngine.ts — Proactive Smart Card Decision Engine (H-1/H-2/H-3 Refactor)
 *
 * Veri kaynağı değişikliği:
 *   ESKİ: onOBDData + onGPSLocation  (iki ayrı servis, yerel jitter guard)
 *   YENİ: useVehicleStore.subscribe  (VehicleSignalResolver'ın temizlenmiş tek kaynağı)
 *         + onVehicleEvent            (kritik olaylarda 8s'yi beklemeden anında tepki)
 *
 * Bu sayede:
 *   - Jitter/outlier filtreleme → VehicleSignalResolver'a devredildi (H-3)
 *   - Abonelik sayısı 2 → 1 (H-1, daha az listener overhead)
 *   - CRITICAL_FUEL / LOW_FUEL gibi olaylar anında _compute() tetikler (H-2)
 *   - Render Guard (_cardsEqual) ve 8s poll korunur (CLAUDE.md §3)
 *
 * Kart öncelik sıralaması:
 *    90 maintenance-urgent — Bakım gecikti / acil
 *    85 fuel-warning       — Yakıt < %15
 *    65 route-work         — Sabah rutini 07-09
 *    65 route-home         — Akşam rutini 18+
 *    50 maintenance-soon   — Bakım yaklaşıyor
 *    30 music-suggestion   — Akşam müzik önerisi
 *
 * Not: engine-warning kartı VehicleState'de engineTemp yokluğu nedeniyle
 * bu motordan çıkarıldı. VehicleEventHub'a ENGINE_OVERHEAT eventi eklendiğinde
 * aşağıdaki onVehicleEvent aboneliğine eklemek yeterli olacak.
 *
 * CLAUDE.md §1 (Memory): tüm abonelikler stopSmartCardEngine'de temizlenir.
 * CLAUDE.md §3 (Performance): poll 8s, subscribe callback O(1) field assign.
 */

import { useVehicleStore }        from '../vehicleDataLayer/VehicleStateStore';
import { onVehicleEvent }         from '../vehicleDataLayer/VehicleEventHub';
import { computeReminders }       from '../vehicleReminderService';
import { getLocationCtx, getTimeCtx } from '../contextEngine';
import { useStore, type SmartCard } from '../../store/useStore';

/* ── Sabitler ────────────────────────────────────────────────── */

const POLL_MS         = 8_000;  // 8 saniye — CLAUDE.md §3
const FUEL_THRESHOLD  = 15;     // %15 altında yakıt uyarısı
const MORNING_START_H = 7;
const MORNING_END_H   = 9;
const EVENING_START_H = 18;

/* ── Modül state ─────────────────────────────────────────────── */

const EVENT_DEBOUNCE_MS = 150;  // 150ms içinde gelen olayları tek _compute()'a indir

let _pollTimer:     ReturnType<typeof setInterval> | null = null;
let _debounceTimer: ReturnType<typeof setTimeout>  | null = null;
let _unsubVehicle:  (() => void) | null                   = null;
let _unsubEvent:    (() => void) | null                   = null;
let _started        = false;

/**
 * VehicleSignalResolver tarafından zaten temizlenmiş araç anlık görüntüsü.
 * Sadece smartCardEngine'in ihtiyaç duyduğu alanlar tutulur.
 */
interface VehicleSnap {
  speedKmh: number;
  fuelPct:  number | null;  // null = OBD verisi yok
  lat:      number | null;
  lng:      number | null;
}

let _vehicle: VehicleSnap = { speedKmh: 0, fuelPct: null, lat: null, lng: null };

/* ── Yardımcılar ─────────────────────────────────────────────── */

function _haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Render Guard — CLAUDE.md §3 (Performance)
 * Kart listesinin içerik olarak değişip değişmediğini kontrol eder.
 * Aynıysa store.setSmartCards() çağrısını atlar → gereksiz re-render yok.
 * Karşılaştırılan alanlar: id, subtitle (ETA dahil), badge, priority.
 */
function _cardsEqual(a: SmartCard[], b: SmartCard[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (
      x.id       !== y.id       ||
      x.subtitle !== y.subtitle ||
      x.badge    !== y.badge    ||
      x.eta      !== y.eta      ||
      x.priority !== y.priority
    ) return false;
  }
  return true;
}

function _etaLabel(distKm: number, avgKmh: number): string {
  const min = Math.round((distKm / Math.max(15, avgKmh)) * 60);
  if (min < 1)  return '<1 dk';
  if (min > 90) return `~${Math.round(min / 60)} sa`;
  return `~${min} dk`;
}

/* ── Karar motoru ────────────────────────────────────────────── */

function _compute(): void {
  if (!_started) return;

  const store     = useStore.getState();
  const settings  = store.settings;
  const dismissed = new Set(store._dismissedCardIds);

  if (!settings.smartContextEnabled) {
    if (store.activeSmartCards.length > 0) store.setSmartCards([]);
    return;
  }

  // Temizlenmiş araç snapshot'ını kullan (jitter guard zaten resolver'da)
  const { speedKmh, fuelPct, lat, lng } = _vehicle;

  const h        = new Date().getHours();
  const timeCtx  = getTimeCtx();
  const isMoving = speedKmh > 5;

  const locationCtx = (lat !== null && lng !== null)
    ? getLocationCtx(
        { latitude: lat, longitude: lng, speed: speedKmh / 3.6, accuracy: 10, timestamp: Date.now() },
        settings.homeLocation,
        settings.workLocation,
      )
    : 'away';

  const cards: SmartCard[] = [];

  /* ── Kart 1: Bakım (acil veya yakında) ───────────────────── */
  if (!isMoving) {
    const reminders = computeReminders(settings.maintenance);
    const urgent    = reminders.find((r) => r.urgency === 'urgent' || r.urgency === 'overdue');
    const soon      = !urgent && reminders.find((r) => r.urgency === 'soon');
    const target    = urgent ?? soon;

    if (target) {
      cards.push({
        id:       `maintenance-${target.id}`,
        kind:     'maintenance-warning',
        title:    target.label,
        subtitle: target.detail,
        color:    urgent ? '#ef4444' : '#f59e0b',
        priority: urgent ? 90 : 50,
        badge:    urgent ? 'Gecikti' : 'Yakında',
        cta:      'Hatırlatıcıya Git',
        action:   { type: 'open-drawer', drawer: 'vehicle-reminder' },
      });
    }
  }

  /* ── Kart 2: Yakıt uyarısı ────────────────────────────────── */
  // fuelPct === null → OBD bağlı değil; kart gösterilmez
  if (fuelPct !== null && fuelPct < FUEL_THRESHOLD) {
    cards.push({
      id:       'fuel-warning',
      kind:     'fuel-warning',
      title:    'Yakıt Azalıyor',
      subtitle: `%${Math.round(fuelPct)} kaldı`,
      color:    '#f59e0b',
      priority: 85,
      badge:    `%${Math.round(fuelPct)}`,
      cta:      'İstasyon Bul',
      action:   { type: 'search-poi', query: 'yakın benzin istasyonu' },
    });
  }

  /* ── Kart 3: Sabah rutini — İşe git ──────────────────────── */
  if (
    !isMoving &&
    timeCtx === 'morning' &&
    h >= MORNING_START_H && h < MORNING_END_H &&
    settings.workLocation &&
    (locationCtx === 'home' || locationCtx === 'near-home')
  ) {
    const distKm = (lat !== null && lng !== null)
      ? _haversineKm(lat, lng, settings.workLocation.lat, settings.workLocation.lng)
      : null;
    const eta = distKm !== null ? _etaLabel(distKm, 45) : null;

    cards.push({
      id:       'route-work-morning',
      kind:     'route-work',
      title:    'İşe Git',
      subtitle: eta ? `Tahmini varış: ${eta}` : 'Sabah rotası hazır — günaydın!',
      color:    '#3b82f6',
      priority: 65,
      eta:      eta ?? undefined,
      cta:      'Evet, Git',
      action:   { type: 'navigate', destination: 'work' },
    });
  }

  /* ── Kart 4: Akşam rutini — Eve git ──────────────────────── */
  if (
    timeCtx === 'evening' &&
    h >= EVENING_START_H &&
    settings.homeLocation &&
    (locationCtx === 'work' || locationCtx === 'near-work' || locationCtx === 'away')
  ) {
    const distKm = (lat !== null && lng !== null)
      ? _haversineKm(lat, lng, settings.homeLocation.lat, settings.homeLocation.lng)
      : null;
    const eta = distKm !== null ? _etaLabel(distKm, 35) : null;

    cards.push({
      id:       'route-home-evening',
      kind:     'route-home',
      title:    'Eve Git',
      subtitle: eta ? `Tahmini varış: ${eta}` : 'Hoş geldin, eve gidelim mi?',
      color:    '#22c55e',
      priority: 65,
      eta:      eta ?? undefined,
      cta:      'Eve Götür',
      action:   { type: 'navigate', destination: 'home' },
    });
  }

  /* ── Kart 5: Akşam müzik önerisi ─────────────────────────── */
  if (isMoving && timeCtx === 'evening' && h >= EVENING_START_H && h < 23) {
    cards.push({
      id:       'music-evening',
      kind:     'music-suggestion',
      title:    'Akşam Müziği',
      subtitle: 'Sakin bir playlist açayım mı?',
      color:    '#8b5cf6',
      priority: 30,
      cta:      'Müziği Aç',
      action:   { type: 'launch', appId: settings.defaultMusic || 'spotify' },
    });
  }

  // Yakıt istasyonu önerisi — fuelAdvisorService tarafından store üzerinden enjekte edilir
  const fuelSuggestion = store.fuelSuggestionCard;
  if (fuelSuggestion && !dismissed.has(fuelSuggestion.id)) {
    cards.push(fuelSuggestion);
  }

  // Theater Mode önerisi — theaterModeService tarafından enjekte edilir
  const theaterSuggestion = store.theaterSuggestionCard;
  if (theaterSuggestion && !dismissed.has(theaterSuggestion.id)) {
    cards.push(theaterSuggestion);
  }

  // Önceliğe göre azalan sıra → dismissed filtrele → max 3 kart
  const result = cards
    .sort((a, b) => b.priority - a.priority)
    .filter((c) => !dismissed.has(c.id))
    .slice(0, 3);

  // Render Guard: içerik aynıysa store'u güncelleme → re-render yok
  if (_cardsEqual(result, store.activeSmartCards)) return;
  store.setSmartCards(result);
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Motoru başlatır.
 * - useVehicleStore.subscribe: VehicleSignalResolver'ın temizlenmiş verisini izler.
 * - onVehicleEvent: kritik olaylarda 8s'yi beklemeden anında _compute() tetikler.
 * App.tsx içinde bir kez çağrılmalı. Tekrar çağrı güvenli (idempotent).
 */
export function startSmartCardEngine(): void {
  if (_started) return;
  _started = true;

  // Başlangıç snapshot'ı: mevcut store değerlerini oku (ilk _compute() için)
  const vs = useVehicleStore.getState();
  _vehicle = {
    speedKmh: vs.speed ?? 0,
    fuelPct:  vs.fuel,
    lat:      vs.location?.lat ?? null,
    lng:      vs.location?.lng ?? null,
  };

  // Merkezi araç durumu aboneliği — O(1) field assign, compute tetiklemez
  // Jitter/outlier temizliği VehicleSignalResolver'a aittir; burada güvenilir veri gelir.
  _unsubVehicle = useVehicleStore.subscribe((state) => {
    _vehicle = {
      speedKmh: state.speed ?? 0,
      fuelPct:  state.fuel,
      lat:      state.location?.lat ?? null,
      lng:      state.location?.lng ?? null,
    };
  });

  // Araç olayları → severity triage ile _compute() tetikle.
  //
  // CRITICAL  → debounce kuyruğunu temizle, anında _compute() (bypass)
  // WARNING   → 150ms debounce kuyruğuna al
  // INFO      → 150ms debounce kuyruğuna al
  //
  // Aynı 150ms penceresinde birden fazla WARNING/INFO gelirse (örn. LOW_FUEL +
  // DRIVING_STOPPED) yalnızca tek bir _compute() çalışır (deduplicate).
  _unsubEvent = onVehicleEvent((e) => {
    switch (e.type) {
      case 'CRITICAL_FUEL':
      case 'LOW_FUEL':
      case 'DRIVING_STARTED':
      case 'DRIVING_STOPPED':
        break;
      default:
        return; // REVERSE_ENGAGED/DISENGAGED → smartCardEngine kart göstermiyor
    }

    if (e.severity === 'CRITICAL') {
      // Bypass: bekleyen debounce'u iptal et ve anında çalıştır
      if (_debounceTimer !== null) { clearTimeout(_debounceTimer); _debounceTimer = null; }
      _compute();
    } else {
      // WARNING / INFO: kuyruğa al; 150ms içinde yeni olay gelirse süre sıfırlanır
      if (_debounceTimer !== null) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        _compute();
      }, EVENT_DEBOUNCE_MS);
    }
    // ENGINE_OVERHEAT: VehicleEventHub'a eklendiğinde case listesine dahil edilecek
  });

  // İlk hesaplama hemen, sonrası 8s'de bir
  _compute();
  _pollTimer = setInterval(_compute, POLL_MS);
}

/**
 * Motoru durdurur ve tüm kaynakları temizler.
 * CLAUDE.md §1: sızıntı yok — her abonelik explicit olarak iptal edilir.
 */
export function stopSmartCardEngine(): void {
  if (!_started) return;
  _started = false;

  if (_pollTimer)     { clearInterval(_pollTimer);    _pollTimer     = null; }
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  _unsubVehicle?.(); _unsubVehicle = null;
  _unsubEvent?.();   _unsubEvent   = null;

  useStore.getState().setSmartCards([]);
}
