/**
 * SystemOrchestrator — Araç olay akışının tek yetkili beyni.
 *
 * Sorumluluklar:
 *  1. onVehicleEvent'e TEK merkezden abone olur (UI bileşenleri direkt dinlemez)
 *  2. onTripState'e abone olarak sürüş özeti akışını yönetir
 *  3. Tüm iş mantığını burada işler → useSystemStore'a kararlı sonuçları yazar
 *  4. Alert zamanlayıcılarını (auto-dismiss) kendi içinde tutar
 *
 * Geri vites suppress kuralı:
 *  REVERSE_ENGAGED geldiğinde non-CRITICAL alertler ekrandan kaldırılır (suppressed).
 *  REVERSE_DISENGAGED geldiğinde geri gelir ve kalan süre kadar gösterilir.
 *
 * Harita açma kuralı:
 *  Her uygulama oturumunda ilk DRIVING_STARTED event'i haritayı tetikler.
 *  Dur-kalk trafiği (hız < 3 km/h) sonrası tekrar sürüş başlayınca tetiklenmez.
 *
 * startSystemOrchestrator() → App.tsx'de çağrılır, dönen fn cleanup'tır.
 */

import { onVehicleEvent } from '../vehicleDataLayer';
import { onTripState }    from '../tripLogService';
import { speakAlert }     from '../ttsService';
import { useSystemStore } from '../../store/useSystemStore';

/**
 * isUserOverrideActive — Kullanıcının manuel tema/parlaklık değişikliği
 * sonrası otomatik sistemlerin (Day/Night, ALS, OBD-brightness) susturulup
 * susturulmadığını kontrol eder.
 *
 * useDayNightManager ve diğer otomatik servisler her karar noktasında
 * bu fonksiyonu çağırmalıdır.
 */
export function isUserOverrideActive(): boolean {
  return Date.now() < useSystemStore.getState().userOverrideUntil;
}

const AUTO_DISMISS_WARNING_MS  = 8_000;
const AUTO_DISMISS_CRITICAL_MS = 12_000;

/* ── Zamanlayıcı haritası — id → timer handle ────────────── */
// Orchestrator lifecycle'ına bağlıdır; cleanup'ta tamamı iptal edilir.
const _timers = new Map<number, ReturnType<typeof setTimeout>>();

function _scheduleAutoDismiss(id: number, ms: number): void {
  const t = setTimeout(() => {
    _timers.delete(id);
    useSystemStore.getState().dismissAlert(id);
  }, ms);
  _timers.set(id, t);
}

function _cancelTimer(id: number): void {
  const t = _timers.get(id);
  if (t) { clearTimeout(t); _timers.delete(id); }
}

/* ── Oturum-düzeyi flag'ler ──────────────────────────────── */
// Modül-düzeyi değil, factory içinde tutulur → hot-reload güvenli.

/* ── Orchestrator factory ────────────────────────────────── */

export function startSystemOrchestrator(): () => void {
  let _navFiredThisSession = false; // oturum başına bir kez harita aç
  let _pendingTripSummary  = false; // DRIVING_STOPPED → trip bitmesini bekle
  let _prevTripActive      = false; // onTripState geçiş tespiti için

  /* ── VehicleEvent aboneliği ─────────────────────────────── */
  const unsubVehicle = onVehicleEvent((e) => {
    const store = useSystemStore.getState;

    switch (e.type) {

      /* ── Geri vites ─────────────────────────────────────── */

      case 'REVERSE_ENGAGED': {
        // Non-critical alert zamanlayıcılarını iptal et (suppressed kalacaklar)
        store().activeAlerts.forEach((a) => {
          if (a.severity !== 'CRITICAL') _cancelTimer(a.id);
        });
        store().setReverse(true);
        store().suppressNonCritical();
        break;
      }

      case 'REVERSE_DISENGAGED': {
        store().setReverse(false);
        store().unsuppressAll();
        // Geri dönen alertler için taze zamanlayıcı başlat
        useSystemStore.getState().activeAlerts.forEach((a) => {
          if (!_timers.has(a.id)) {
            _scheduleAutoDismiss(
              a.id,
              a.severity === 'CRITICAL' ? AUTO_DISMISS_CRITICAL_MS : AUTO_DISMISS_WARNING_MS,
            );
          }
        });
        break;
      }

      /* ── Sürüş durumu ────────────────────────────────────── */

      case 'DRIVING_STARTED': {
        store().setDriving(true);
        // Oturum başına yalnızca ilk sürüşte haritayı aç
        if (!_navFiredThisSession) {
          _navFiredThisSession = true;
          store().triggerNavOpen();
        }
        break;
      }

      case 'DRIVING_STOPPED': {
        store().setDriving(false);
        _pendingTripSummary  = true;
        break;
      }

      /* ── Yakıt uyarıları ─────────────────────────────────── */

      case 'CRITICAL_FUEL': {
        const fuelPct = Math.round(e.fuelPct);
        store().addAlert({
          type:     'CRITICAL_FUEL',
          severity: 'CRITICAL',
          label:    `Yakıt Kritik: %${fuelPct}`,
          sublabel: 'En yakın istasyona gidin',
          ts:       e.ts,
        });
        speakAlert(`Yakıt kritik seviyede, yüzde ${fuelPct}`);
        // Yeni eklenen alert'in id'sini al
        const latest = useSystemStore.getState().activeAlerts.at(-1);
        if (latest) _scheduleAutoDismiss(latest.id, AUTO_DISMISS_CRITICAL_MS);
        break;
      }

      case 'CRASH_DETECTED': {
        const g = e.peakG.toFixed(1);
        store().addAlert({
          type:     'CRASH_DETECTED',
          severity: 'CRITICAL',
          label:    `Kaza Tespit Edildi: ${g}G`,
          sublabel: 'Kaza anı kaydedildi — yardım gerekiyor mu?',
          ts:       e.ts,
        });
        speakAlert(`Dikkat! Kaza tespit edildi, ${g} G kuvveti`);
        // Kaza uyarısı uzun süre ekranda kalsın (AUTO_DISMISS_CRITICAL_MS = 12s)
        const latest = useSystemStore.getState().activeAlerts.at(-1);
        if (latest) _scheduleAutoDismiss(latest.id, AUTO_DISMISS_CRITICAL_MS);
        break;
      }

      case 'MAINTENANCE_REQUIRED': {
        const score = Math.round(e.healthScore);
        store().addAlert({
          type:     'MAINTENANCE_REQUIRED',
          severity: 'WARNING',
          label:    `Araç Bakımı Gerekli: Sağlık %${score}`,
          sublabel: 'Servis randevusu alın',
          ts:       e.ts,
        });
        speakAlert(`Araç bakımı gerekiyor, sağlık skoru yüzde ${score}`);
        const latest = useSystemStore.getState().activeAlerts.at(-1);
        if (latest) _scheduleAutoDismiss(latest.id, AUTO_DISMISS_WARNING_MS);
        break;
      }

      case 'LOW_FUEL': {
        // Geri vites sırasında yeni uyarı ekleme — zaten kamera kaplıyor
        if (store().isReverseActive) break;
        const fuelPct = Math.round(e.fuelPct);
        store().addAlert({
          type:     'LOW_FUEL',
          severity: 'WARNING',
          label:    `Yakıt Azalıyor: %${fuelPct}`,
          sublabel: 'Yakıt ikmali önerilir',
          ts:       e.ts,
        });
        const latest = useSystemStore.getState().activeAlerts.at(-1);
        if (latest) _scheduleAutoDismiss(latest.id, AUTO_DISMISS_WARNING_MS);
        break;
      }
    }
  });

  /* ── Trip Log aboneliği ──────────────────────────────────── */
  // Trip aktif → pasif geçişini yakala; pending flag varsa banneri göster.
  const unsubTrip = onTripState((state) => {
    const justEnded = _prevTripActive && !state.active;
    _prevTripActive = state.active;

    if (justEnded && _pendingTripSummary && state.history.length > 0) {
      _pendingTripSummary = false;
      useSystemStore.getState().setTripSummary(state.history[0]);
    }
  });

  /* ── Cleanup ─────────────────────────────────────────────── */
  return () => {
    unsubVehicle();
    unsubTrip();
    _timers.forEach((t) => clearTimeout(t));
    _timers.clear();
  };
}
