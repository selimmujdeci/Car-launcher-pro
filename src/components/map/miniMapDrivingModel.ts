/**
 * miniMapDrivingModel — mini haritanın "araç sürüyor mu" kararı (saf).
 *
 * ── #618 (korunur) ────────────────────────────────────────────────────────
 * Durur hâlde GPS sürüklenmesi hareket SAYILMAZ: yer değiştirme doğruluk
 * yarıçapını (taban 8 m) aşmadıkça hız ÜRETİLMEZ. GPS'in kendi hız bildirimi
 * ayrı kanıttır ve bu kapıya tabi değildir.
 *
 * ── SAHA KUSURU (2026-09-27, kullanıcı: "mini haritada yolda giderken konum
 * geride kalıyor, görünmüyor"; ekranda hız "— KM/H" = GPS hız bildirmiyor) ──
 * #618 kapısı sürüş dalında HER fix'te sıfırlanan çapaya uygulanıyordu. İki
 * fix arası yer değiştirme kapının altında kaldığında (sık fix: 5 Hz'de
 * 50 km/h ≈ 2,8 m; zayıf doğruluk: 15 m kapıda 1 Hz'de 40 km/h ≈ 11 m) türetilen
 * hız **0** çıkıyor → `< 3 km/h` → sürüş görünümü KAPANIYOR → park dalı kamerayı
 * ancak ~200 m sapmada ortaladığı için işaret mini harita kutusundan çıkıyor;
 * birkaç fix sonra yine "sürüş" → görünüm gidip geliyordu.
 *
 * KURAL: kapının altındaki yer değiştirme "DURDU" kanıtı DEĞİLDİR, yalnız
 * YETERSİZ kanıttır. Sürüşteyken yetersiz kanıt önceki durumu korur; çapa
 * yalnız yer değiştirme kapıyı aştığında ilerler (mesafe birikir, hız doğru
 * pencereden ölçülür). `STOP_CONFIRM_SEC` boyunca kapı aşılmazsa araç durmuştur.
 */

/** Yer değiştirme kapısının tabanı (m) — #618 ile aynı. */
export const MINIMAP_MOVE_GATE_FLOOR_M = 8;
/** Sürüşteyken bu süre boyunca kapı aşılmazsa "durdu" kararı verilir (s). */
export const MINIMAP_STOP_CONFIRM_SEC = 6;

export interface MiniMapMotionInput {
  /** GPS'in bildirdiği hız (km/h); bilinmiyorsa 0. */
  readonly gpsSpeedKmh: number;
  /** Çapadan bu fix'e yer değiştirme (m, haversine). */
  readonly movedM: number;
  /** GPS doğruluğu (m); bilinmiyorsa 0. */
  readonly accuracyM: number;
  /** Çapadan bu fix'e geçen süre (s). */
  readonly dtSec: number;
  readonly wasDriving: boolean;
  /** Önceki fix'in etkin hızı (km/h) — kanıt yetersizken kameraya taşınır. */
  readonly lastEffKmh: number;
}

export interface MiniMapMotionResult {
  readonly isDriving: boolean;
  /** Kamera politikasına verilen etkin hız (km/h). */
  readonly effKmh: number;
  /** Yer değiştirme kanıtı tüketildi mi → çapa bu fix'e taşınmalı. */
  readonly advanceAnchor: boolean;
}

export function classifyMiniMapMotion(i: MiniMapMotionInput): MiniMapMotionResult {
  const _accM = Number.isFinite(i.accuracyM) ? Math.abs(i.accuracyM) : 0;
  const _moveGate = Math.max(_accM, MINIMAP_MOVE_GATE_FLOOR_M);
  const _movedM = Number.isFinite(i.movedM) ? i.movedM : 0;
  const speedKmh = Number.isFinite(i.gpsSpeedKmh) && i.gpsSpeedKmh > 0 ? i.gpsSpeedKmh : 0;
  const _dtSec = i.dtSec;
  const _dispKmh = (_dtSec > 0.15 && _dtSec < 30 && _movedM > _moveGate)
    ? (_movedM / _dtSec) * 3.6
    : 0;
  const _effKmh = Math.max(speedKmh, _dispKmh);

  /* Kapı aşılmadı ve henüz durma penceresi dolmadı → kanıt yetersiz. */
  const inconclusive = _movedM <= _moveGate && _dtSec < MINIMAP_STOP_CONFIRM_SEC;

  /* Histerezis (giriş >5 / çıkış <3 km/h) #618 ile AYNI; yeni eşik yok. */
  const hold = i.wasDriving && inconclusive && !(_effKmh > 5);
  const isDriving = _effKmh > 5 ? true : hold ? true : _effKmh < 3 ? false : i.wasDriving;

  /* Tutulan sürüşte kameraya 0 km/h VERİLMEZ (kamera kendini durakta sanıp
     takibi dondururdu); son ÖLÇÜLEN hız taşınır — uydurma değil, önceki kanıt. */
  const lastEff = Number.isFinite(i.lastEffKmh) && i.lastEffKmh > 0 ? i.lastEffKmh : 0;
  return { isDriving, effKmh: hold ? Math.max(_effKmh, lastEff) : _effKmh, advanceAnchor: _movedM > _moveGate };
}
