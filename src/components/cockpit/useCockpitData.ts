/**
 * useCockpitData — Digital Cockpit'in KANONİK VERİ ADAPTÖRÜ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ KURAL: BU DOSYA HİÇBİR ŞEY BAŞLATMAZ ───────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Yeni GPS aboneliği · yeni OBD poll turu · yeni CAN dinleyici · yeni müzik
 * oturumu · yeni navigasyon oturumu · yeni timer AÇILMAZ. Yalnız CarOS'un
 * ZATEN çalışan otoritelerinden OKUR. Kokpit bir PROJEKSİYONDUR; ikinci bir
 * araç/navigasyon/müzik gerçeği üretmez (CLAUDE.md §6).
 *
 * Okunan otoriteler (hepsi mevcut, hiçbiri bu tur eklenmedi):
 *   hız            → `useDisplaySpeed`            (gösterim hızının TEK otoritesi)
 *   hız limiti     → `useEffectiveSpeedLimit`     (SpeedLimitCard ile AYNI hüküm)
 *   devir          → `useOBDRPM`
 *   motor ısısı    → `useCanonicalVehicleSignal`  (CAN → OBD → yok)
 *   ortam ısısı    → `useAmbientTemp`
 *   yakıt/menzil   → `useOBDState` + `isObdReadingLive` (tema kartlarıyla AYNI kapı)
 *   odometre       → `UnifiedVehicleStore.odometer`
 *   vites          → `UnifiedVehicleStore.canGearPos`
 *   manevra        → `useNavigation` + `useRouteState`
 *   müzik          → `useMediaState` (kanonik oynatma durumu)
 *   sürüş modu     → aktif araç profili tercihi
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * Ölçülmemiş her alan `null` döner. Sahte `0`/tarih/"hazır" ÜRETİLMEZ. Bayat
 * ölçüm canlı gibi gösterilmez: motor ısısı `LIVE` değilse değer `null`dır
 * (`useLiveVehicleSignal` kapısı), yakıt/menzil `isObdReadingLive` kapısından
 * geçmezse `null`dır — bu kapı sahada ölçülmüş bir kusurun (12 saat öncesinin
 * "kurtarılmış" yakıt seviyesini canlı sanmak) düzeltmesidir.
 */

import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useDisplaySpeed } from '../../hooks/useDisplaySpeed';
import { useCanonicalVehicleSignal, useAmbientTemp } from '../../hooks/useCanonicalVehicleSignal';
import { useOBDRPM, useOBDState } from '../../platform/obdService';
import { isObdReadingLive } from '../../platform/vehicleStatusModel';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useNavigation } from '../../platform/navigationService';
import { useRouteState } from '../../platform/routingService';
import { useEffectiveSpeedLimit } from '../../platform/navigation/useEffectiveSpeedLimit';
import {
  isEffectiveLimitDisplayable, isEffectiveLimitDefinitive,
} from '../../platform/navigation/core/vehicleAwareSpeedLimitAuthority';
import { useMediaState } from '../../platform/mediaService';
import {
  bandOrNull, gearLabel, driveModeLabel, COCKPIT_BANDS,
  type CockpitState, type CockpitFreshness, type CockpitManeuver,
} from './cockpitDataModel';

/** `-1` OBD katmanında "desteklenmiyor" sentinel'idir — sayı DEĞİLDİR. */
function obdOrNull(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return v;
}

export function useCockpitData(): CockpitState {
  /* ── Hız + limit ─────────────────────────────────────────────────────── */
  const speedKmh = useDisplaySpeed();
  const limit = useEffectiveSpeedLimit();

  /* ── Motor ───────────────────────────────────────────────────────────── */
  const rpmRaw = useOBDRPM();
  const coolant = useCanonicalVehicleSignal('coolantTemp');
  const ambientTempC = useAmbientTemp();

  /* ── Yakıt / menzil / odometre ───────────────────────────────────────── */
  const obd = useOBDState();
  const odometerRaw = useUnifiedVehicleStore((s) => s.odometer);
  const canGearPos = useUnifiedVehicleStore((s) => s.canGearPos);

  /* ── Navigasyon ──────────────────────────────────────────────────────── */
  /* Rehberlik ACTIVE/REROUTING'de vardır; rota ÖNİZLEMESİ dönüş işareti göstermez (#416). */
  const { isGuidanceActive } = useNavigation();
  const route = useRouteState();

  /* ── Müzik ───────────────────────────────────────────────────────────── */
  const media = useMediaState();

  /* ── Araç profili (kırmızı çizgi + sürüş modu tercihi) ───────────────── */
  const profile = useStore((s) =>
    s.settings.vehicleProfiles.find((p) => p.id === s.settings.activeVehicleProfileId) ?? null,
  );

  return useMemo<CockpitState>(() => {
    /* Yakıt/menzil CANLI kapısı — kurtarılmış snapshot burada elenir. */
    const live = isObdReadingLive(obd);
    const fuelLevelPct = live ? bandOrNull(obdOrNull(obd.fuelLevel), COCKPIT_BANDS.fuel) : null;
    const rangeKm = live ? bandOrNull(obdOrNull(obd.estimatedRangeKm), COCKPIT_BANDS.range) : null;

    /* Motor ısısı: YALNIZ LIVE okuma sayı olarak gösterilir. */
    const coolantFreshness: CockpitFreshness =
      coolant.source === 'NONE' ? 'UNAVAILABLE'
        : coolant.state === 'LIVE' ? 'LIVE'
          : coolant.state === 'STALE' ? 'STALE' : 'UNAVAILABLE';
    const coolantTempC = coolantFreshness === 'LIVE'
      ? bandOrNull(coolant.value, COCKPIT_BANDS.coolant)
      : null;

    /* Manevra: navigasyon AKTİF DEĞİLSE manevra YOKTUR (eski adım gösterilmez). */
    let maneuver: CockpitManeuver | null = null;
    if (isGuidanceActive) {
      const step = route.steps[route.currentStepIndex + 1] ?? null;
      const d = route.distanceToNextTurnMeters;
      const distanceMeters = typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : null;
      if (step !== null || distanceMeters !== null) {
        maneuver = {
          distanceMeters,
          label: step?.streetName?.trim() || step?.instruction?.trim() || null,
          type: step?.maneuverType ?? null,
          modifier: step?.maneuverModifier ?? null,
          roundaboutExit: step?.roundaboutExit ?? null,
          then: route.pendingManeuver
            ? { type: route.pendingManeuver.maneuverType ?? null, modifier: route.pendingManeuver.maneuverModifier ?? null }
            : null,
        };
      }
    }

    /* Hız limiti: gösterilebilir DEĞİLSE levha hiç çizilmez (sahte sayı yok). */
    const showLimit = isEffectiveLimitDisplayable(limit);

    return {
      speedKmh: bandOrNull(speedKmh, COCKPIT_BANDS.speed),
      speedLimitKmh: showLimit ? bandOrNull(limit.effectiveLimitKmh, COCKPIT_BANDS.speed) : null,
      speedLimitDefinitive: showLimit && isEffectiveLimitDefinitive(limit),
      rpm: bandOrNull(obdOrNull(rpmRaw), COCKPIT_BANDS.rpm),
      rpmRedline: bandOrNull(profile?.maxRpm ?? null, COCKPIT_BANDS.rpm),
      coolantTempC,
      coolantFreshness,
      rangeKm,
      fuelLevelPct,
      /* Ortalama tüketim araç profilinin YAPILANDIRILMIŞ değeridir (menzil hesabı
         da onu kullanır — `setObdFuelConfig`). Yapılandırılmamışsa `null` → `—`. */
      avgConsumptionL100: bandOrNull(profile?.avgConsumptionL100 ?? null, COCKPIT_BANDS.consum),
      odometerKm: bandOrNull(odometerRaw, COCKPIT_BANDS.odo),
      ambientTempC: bandOrNull(ambientTempC, COCKPIT_BANDS.ambient),
      maneuver,
      media: {
        title: media.track.title?.trim() || null,
        artist: media.track.artist?.trim() || null,
        artworkUrl: media.track.albumArt || null,
        playing: media.playing === true,
        /* İzin yoksa transport hiçbir şeyi sürmez → kart pasif çizilir. */
        available: media.permissionRequired !== true,
      },
      gear: gearLabel(canGearPos),
      driveMode: driveModeLabel(profile?.driveMode ?? null),
      /* ADAS: bu üründe GERÇEK şerit/takip sinyali YOK → rozetler gizlenir. */
      laneAssist: null,
      followingAssist: null,
    };
  }, [
    speedKmh, limit, rpmRaw, coolant, ambientTempC, obd,
    odometerRaw, canGearPos, isGuidanceActive, route, media, profile,
  ]);
}
