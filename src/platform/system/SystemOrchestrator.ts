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

import { onVehicleEvent }                          from '../vehicleDataLayer';
import { onTripState }                             from '../tripLogService';
import { speakAlert }                              from '../ttsService';
import { useSystemStore }                          from '../../store/useSystemStore';
import { startCognitiveEngine, stopCognitiveEngine } from './CognitivePriorityEngine';
import { onThermalLevelChange, getThermalSnapshot } from '../thermalWatchdog';
import type { ThermalSnapshot }                    from '../thermalWatchdog';
import { runtimeManager }                          from '../../core/runtime/AdaptiveRuntimeManager';
import { setCommunityThermalLevel, stopCommunityService } from '../communityService';
import { useCognitiveStore }                        from '../../store/useCognitiveStore';
import { showToast }                               from '../errorBus';
import { thermalJournal }                          from './ThermalJournal';
import { startRemoteConfigService }               from '../remoteConfigService';

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
  let _lastResumeAt        = 0;     // en son foreground dönüşü (visibilitychange visible)

  // RESUME-GUARD (saha 2026-07-07): app arka plan/uykudan dönünce birikmiş GPS
  // tek tick'te işlenip hız spike'ı (≥DRIVE_ON_KMH) üretiyor → worker sahte
  // DRIVING_STARTED/STOPPED → park halde sahte "Yolculuk Tamamlandı" banner (0.1km/2dk).
  // Gerçek yolculuk resume anında bitmez → dönüşten sonraki bu pencerede finalize
  // edilen trip artefakt sayılıp banner bastırılır (trip yine kaydedilir, yalnız modal yok).
  const RESUME_TRIP_GRACE_MS = 5_000;
  const _onOrchVisibility = () => {
    if (typeof document !== 'undefined' && !document.hidden) _lastResumeAt = Date.now();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', _onOrchVisibility);
  }

  startCognitiveEngine();
  thermalJournal.start();
  const stopRemoteConfig = startRemoteConfigService();

  /* ── Termal Action Matrix ────────────────────────────────── */
  // Sadece event-driven — poll yok, overhead sıfır.
  // Eskalasyon: anlık (L yükseliyor). Recovery: 30s hysteresis AdaptiveRuntimeManager içinde.

  // Sahte bildirim koruması: aynı seviye tekrar ederse toast atma; ilk açılışta
  // sessizce state senkronize et (kullanıcı bot mesajı görmesin).
  let _lastThermalLevel: number = -1;
  let _thermalFirstCall = true;

  function _handleThermalLevel(snap: ThermalSnapshot): void {
    const level = snap.level;
    runtimeManager.setThermalConstraint(level);
    setCommunityThermalLevel(level);
    thermalJournal.record(level);

    // Toast bastırma:
    //   - Startup'taki ilk çağrı (state sync, gerçek değişim değil)
    //   - Aynı veya daha düşük seviye (yalnızca yükseliş anlarında bildir)
    const shouldSuppress = _thermalFirstCall || level <= _lastThermalLevel;
    _thermalFirstCall   = false;
    _lastThermalLevel    = level;
    if (shouldSuppress) return;

    if (level === 3) {
      // L3: Sistem Tahliyesi — CRITICAL bellek baskısı + LIMP_HOME + non-critical alertleri temizle
      runtimeManager.handleMemoryPressure('CRITICAL');
      useCognitiveStore.getState().setMode('LIMP_HOME');
      // Non-critical alertleri ekrandan kaldır — yalnızca CRITICAL kalır
      useSystemStore.getState().activeAlerts
        .filter((a) => a.severity !== 'CRITICAL')
        .forEach((a) => {
          _cancelTimer(a.id);
          useSystemStore.getState().dismissAlert(a.id);
        });
      showToast({
        type:     'error',
        title:    'Kritik Isı — Sistem Tahliyesi',
        message:  'Sistem kritik sıcaklıkta — arka plan servisleri durduruldu.',
        duration: 10_000,
      });
      speakAlert('Sistem sıcaklığı kritik seviyede. Lütfen araçta uygun koşullar sağlayın.');
    } else if (level === 2) {
      // L2: CRM senkronizasyonu tamamen durdur (L1'de yalnızca kısıtlanıyordu)
      stopCommunityService();
      showToast({
        type:     'warning',
        title:    'Yüksek Sıcaklık',
        message:  'Termal koruma aktif — topluluk senkronizasyonu durduruldu.',
        duration: 8_000,
      });
    } else if (level === 1) {
      // L1: yalnızca ilk girişte bildir (tekrarda suppress)
      showToast({
        type:     'warning',
        title:    'Sıcaklık Yükseliyor',
        message:  'Termal throttling başladı — performans kısıtlaması uygulandı.',
        duration: 6_000,
      });
    }
    // L0: kısıt kaldırma, bildirim yok — kullanıcıyı yormama prensibi
  }

  // Açılışta anlık seviye uygula (watchdog başlamış olabilir)
  _handleThermalLevel(getThermalSnapshot());
  const unsubThermal = onThermalLevelChange(_handleThermalLevel);

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

      /* ── Motor aşırı ısınma (P1 — reverse'i ezmez, konfor/temayı ezer) ──── */

      case 'ENGINE_OVERHEAT': {
        const tempC = Math.round(e.coolantTempC);
        store().addAlert({
          type:     'ENGINE_OVERHEAT',
          severity: 'CRITICAL',
          label:    `Motor Aşırı Isındı: ${tempC}°C`,
          sublabel: 'Güvenli bir yere çekin',
          ts:       e.ts,
        });
        // Metin BİREBİR voiceClips.ts CLIP_MANIFEST anahtarıyla eşleşmeli —
        // premium kayıtlı klip (public/voice/safety-overheat.wav) çalınsın.
        speakAlert('Motor sıcaklığı yüksek, lütfen güvenli yerde durun.');
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
      // Resume-guard: foreground dönüşünün hemen ardından biten "trip" = arka-plan/
      // uyku resume artefaktı → banner gösterme (gerçek yolculuk resume anında bitmez).
      if (Date.now() - _lastResumeAt < RESUME_TRIP_GRACE_MS) return;
      useSystemStore.getState().setTripSummary(state.history[0]);
    }
  });

  /* ── Cleanup ─────────────────────────────────────────────── */
  return () => {
    stopRemoteConfig();
    stopCognitiveEngine();
    thermalJournal.stop();
    unsubThermal();
    unsubVehicle();
    unsubTrip();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', _onOrchVisibility);
    }
    _timers.forEach((t) => clearTimeout(t));
    _timers.clear();
  };
}
