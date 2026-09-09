/**
 * navigationCoreSources.ts — CAROS LAB · Navigation Core TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter'lar, her biri kendi try/catch'i
 * içinde. HİÇBİR şey başlatmaz/durdurmaz, komut göndermez, timer kurmaz, ağa
 * çıkmaz. Navigasyonu BAŞLATAMAZ, DURDURAMAZ, DEĞİŞTİREMEZ.
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6 — pazarlıksız) ──────────
 * **KOORDİNAT (enlem/boylam) BU KATMANDAN GEÇMEZ.** Konum kişisel veridir ve
 * `LocationEngineScreen` ile aynı kararı uygular. Görev metni "raw GPS" ve
 * "matched position" göstermeyi istiyor; bunu koordinat SIZDIRMADAN karşılarız:
 * ham fix'in VAR/YOK'u, doğruluğu, yaşı ve eşleşen konuma olan DİK MESAFE
 * gösterilir. Tanı için gereken budur — koordinatın kendisi değil.
 * Hedef adı, adres ve rota geometrisi de TAŞINMAZ.
 */

import { getRouteState, getNavigationCoreSnapshot } from '../routingService';
/* G1 TEK KONUM KANIT OTORİTESİ (#527) + fix yaşı dağılımı (#537).
   GİZLİLİK: bu katmandan YALNIZ yaş/bayatlık/kaynak geçer — KOORDİNAT GEÇMEZ. */
import { getLocationEvidence, getFixAgeLedger } from '../gpsService';
import type { FixAgeSummary } from '../navigation/core/fixAgeLedger';
import {
  getNavigationState, getNavSessionId, getRouteRequestClaim, getEtaVerdict,
  getDestinationIntegritySnapshot,
} from '../navigationService';
import {
  getVoiceGuidanceSnapshot, type VoiceGuidanceSnapshot,
} from '../navigation/voiceGuidanceRuntime';
import type { EtaVerdict } from '../navigation/core/etaModel';
import {
  getRouteProviderLedger,
  type RouteAttempt, type RouteChainSummary,
} from '../navigation/core/routeProviderLedger';
import {
  getCommittedGeometry, getRejectedGeometryEvidence,
  type CommittedGeometryEvidence,
} from '../navigation/core/routeGeometryModel';
import {
  getProgressLedger, type ProgressLedgerSnapshot,
} from '../navigation/core/routeProgressLedger';
import {
  judgeRerouteHealth, type RerouteHealthVerdict,
} from '../navigation/core/rerouteStarvationModel';
import {
  getGuidanceAudit, type GuidanceAuditSnapshot,
} from '../navigation/core/voiceGuidanceAudit';
import {
  getNavTickCostSnapshot, type NavTickCostSnapshot,
} from '../navigation/core/navTickCostModel';
import {
  buildNavFailureMatrix, type NavFailureMatrix,
} from '../navigation/core/navFailureMatrixModel';
import { isGpsDecisionGrade } from '../navigation/core/hudPresentationModel';
import type {
  RouteDurationSource, RouteDurationIntegrity,
} from '../navigation/core/routeDurationModel';
import {
  getNavigationSessionRuntimeSnapshot,
  type NavigationSessionRuntimeSnapshot,
} from '../navigation/navigationSessionRuntime';
import {
  getCameraFollowSnapshot, type CameraFollowSnapshot,
} from '../navigation/cameraFollowAuthority';
import {
  classifySpeedLimit, type SpeedLimitVerdict,
} from '../navigation/core/speedLimitTruthModel';
import { getSpeedLimitObservation } from '../speedLimitService';
import {
  resolveRoadClass, type RoadClassVerdict,
} from '../navigation/policy/roadClassResolver';
import {
  POLICY_COUNTRY, POLICY_VERSION, POLICY_EFFECTIVE_FROM, POLICY_SOURCE_AUTHORITY,
} from '../navigation/policy/turkeySpeedPolicy';
import {
  computeEffectiveSpeedLimit, EMPTY_EFFECTIVE_SPEED_LIMIT,
  type EffectiveSpeedLimit,
} from '../navigation/core/vehicleAwareSpeedLimitAuthority';
import {
  getVehicleClassSnapshot, maskVehicleClassKey, type VehicleClassSnapshot,
} from '../vehicle/vehicleClassRuntime';
import { EMPTY_VEHICLE_CLASS_PROFILE } from '../vehicle/legalVehicleClass';
import {
  getMarkerMotionSnapshot, type MarkerMotionSnapshot,
} from '../navigation/navMarkerMotionRuntime';
import {
  decideCameraPolicy, CAMERA_POLICY_VERSION,
  type CameraPolicyDecision,
} from '../navigation/core/cameraPolicyModel';
import {
  getNavigationOrientationSnapshot, orientationOf,
} from '../navigation/navigationOrientation';
/* NAV v3 · F3 — L2 ego + L3 ufuk GÖZLEMİ (salt-okunur; koordinat TAŞIMAZ). */
import { getEgoAuthority, type EgoDiagnostics } from '../navigation/ego/egoAuthority';
import { getCehAuthority, type CehDiagnostics } from '../navigation/horizon/cehAuthority';
import {
  getNavOrientationFeedSnapshot, type NavOrientationFeedSnapshot,
} from '../navigation/navOrientationFeed';
import {
  getNavEgoHorizonBridgeSnapshot, type NavEgoHorizonBridgeSnapshot,
} from '../navigation/navEgoHorizonBridge';
import {
  getGraphResidencySnapshot, type GraphResidencySnapshot,
} from '../navigation/map/graph/graphResidencyRuntime';
import {
  getRegionalDistributionSnapshotSync, type RegionalDistributionSnapshot,
} from '../navigation/map/graph/regionalDataDistribution';
import { getCrossRegionSearchSnapshot, type CrossRegionSearchSnapshot }
  from '../offlineRoutingService';
import {
  getCehShadowSnapshot, type CehShadowSnapshot,
} from '../navigation/shadow/cehShadowRuntime';
/* F6 — sınırlı koridor + kenar-tabanlı denetim noktası eşleştirme GÖZLEMİ. */
import {
  getEnforcementHorizonPortSnapshot, type EnforcementHorizonPortSnapshot,
} from '../navigation/enforcementHorizonPort';
import { getMapInstance } from '../mapService';
import {
  getCameraShadowSnapshot, type CameraShadowSnapshot,
} from '../navigation/cameraShadowRuntime';
import {
  getCameraDampingSnapshot, type CameraDampingSnapshot,
} from '../cameraEngine';
import {
  getRouteColorSnapshot, type RouteColorSnapshot,
} from '../map/MapLayerManager';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import {
  getMapNight,
  isTunnelNightOverrideActive, getRequestedMapNight,
  getTileModeVerdict,
} from '../mapSourceManager';
import { getTunnelMode } from '../autoBrightnessService';
import {
  isTunnelNightRuntimeRunning, getTunnelNightTransitionCount,
} from '../map/tunnelNightRuntime';
import { getMapContrastProfile, type MapContrastProfile } from '../mapStyleBuilders';
import {
  getRerouteBlockStats,
  getRouteRequestSnapshot, type RouteRequestSnapshot,
} from '../navigation/core/routeRequestLedger';
import {
  getProviderReadinessSnapshot, type ProviderReadinessSnapshot,
} from '../navigation/core/routeProviderReadiness';
import { getOfflineRoutingStatus, type OfflineRoutingStatus } from '../navigation/offlineRoutingStatus';
import type { MapMatchState, MapMatchReason } from '../navigation/core/mapMatchModel';
import type { OffRouteState, OffRouteReason } from '../navigation/core/offRouteModel';
import type { RouteVerdict, RouteCheck } from '../navigation/core/routeValidationModel';
import type { RouteRationaleLedgerSnapshot } from '../navigation/core/routeRationaleModel';
import { getRouteRationaleLedger } from '../navigation/core/routeRationaleModel';
import type { AnchorMethod } from '../navigation/core/maneuverIndexModel';
import type { ManeuverDistanceSource } from '../routingService';
import {
  readPaintedArrowDiagnostics, type PaintedArrowDiagnostics,
} from '../map/core/paintedArrowAccess';
import { PAINTED_ARROW_POLICY_VERSION } from '../map/core/paintedArrowModel';

/** Okuma patlarsa sahte "görünüyor" ÜRETİLMEZ — hüküm NOT_EVALUATED kalır. */
const PAINTED_ARROW_FALLBACK: PaintedArrowDiagnostics = {
  visible: false, reason: 'NOT_EVALUATED', shownCount: 0, appliedCount: 0,
  layerPresent: false, policyVersion: PAINTED_ARROW_POLICY_VERSION,
};

export interface NavigationCoreRawSnapshot {
  readonly readAt: number;

  /* ── NAV v3 · L2 EGO / L3 UFUK (F3) ────────────────────────────────────
   * KOORDİNAT TAŞIMAZ: yalnız hüküm, sayaç, yaş ve kalite göstergeleri.
   * `null` = otorite okunamadı → ekran UNAVAILABLE gösterir (sahte 0 YOK). */
  readonly ego: EgoDiagnostics | null;
  readonly ceh: CehDiagnostics | null;
  readonly yawFeed: NavOrientationFeedSnapshot | null;
  readonly egoHorizonBridge: NavEgoHorizonBridgeSnapshot | null;
  /** F4 — yol ağı grafının ana iş parçacığındaki sakinliği (koordinat YOK). */
  readonly graphResidency: GraphResidencySnapshot | null;
  /** Bölgesel veri dağıtım otoritesinin salt-okunur projeksiyonu. */
  readonly regionalDistribution: RegionalDistributionSnapshot | null;
  /**
   * RTG4 — son uzun-rota ARAMA PROFİLİ. Yalnız sayaç: bütçe kullanımı, ALT
   * kanıtının varlığı, ağırlık tırmanması ve sınıf dağılımı. Başlangıç, hedef,
   * geometri ve rota kimliği TAŞINMAZ.
   */
  readonly crossRegionSearch: CrossRegionSearchSnapshot | null;
  /**
   * F5 — legacy ↔ CEH gölge karşılaştırması + cutover kapısı. Yalnız sayaç ve
   * hüküm taşır; koordinat, talimat metni ve nokta kimliği TAŞIMAZ.
   */
  readonly cehShadow: CehShadowSnapshot | null;
  /**
   * F6 — sınırlı koridor genişleme + kenar-tabanlı denetim noktası
   * eşleştirme sayaçları. Yalnız SAYI/HÜKÜM taşır; koordinat, nokta
   * kimliği ve ham etiket TAŞIMAZ.
   */
  readonly enforcementHorizonPort: EnforcementHorizonPortSnapshot | null;

  /** Yola boyanmış manevra oku — hüküm + gerekçe + sayaçlar (konum TAŞIMAZ). */
  readonly paintedArrow: PaintedArrowDiagnostics;

  /* ── Navigasyon durumu ─────────────────────────────────────────────────── */
  readonly navStatus: string;
  readonly isNavigating: boolean;
  readonly isRerouting: boolean;
  readonly hasDestination: boolean;      // hedef ADI/koordinatı TAŞINMAZ
  readonly remainingDistanceM: number | null;
  readonly etaSeconds: number | null;

  /* ── Sağlayıcı ─────────────────────────────────────────────────────────── */
  readonly provider: ProviderReadinessSnapshot;
  readonly offlineGraph: OfflineRoutingStatus;
  readonly onlineHint: boolean | null;
  readonly serverUsed: string | null;
  readonly routeError: string | null;
  readonly routeLoading: boolean;
  readonly straightLineActive: boolean;

  /* ── Konum / eşleştirme (KOORDİNAT YOK) ────────────────────────────────── */
  readonly hasRawFix: boolean;
  /**
   * EŞLEŞTİRİLMİŞ fix'in yaşı (ms) — kaynak `routingService` map-match fix'i.
   *
   * ⚠️ #508'İN DAYANDIĞI SAYI BU DEĞİLDİR. Bu yaş, navigasyon çekirdeğinin son
   * işlediği fix'i ölçer (nav aktif değilken hiç tazelenmez). G1 kabul ölçütü
   * KONUM SAĞLAYICISININ fix yaşını ister → `locationFixAgeMs` alanı. İkisi
   * FARKLI olguları ölçer ve ayrışmaları bir ÇELİŞKİ DEĞİLDİR.
   */
  readonly fixAgeMs: number | null;
  /**
   * #508'in dayandığı sayı — G1 TEK OTORİTESİNDEN (`getLocationEvidence()`),
   * MONOTONİK saatten. Bu katman kendi hesabını YAPMAZ (kasa KİLİT 27).
   */
  readonly locationFixAgeMs: number | null;
  readonly locationStale: boolean;
  readonly locationSource: 'GPS' | 'DEAD_RECKONING' | 'NONE';
  /**
   * #537 — fix yaşı DAĞILIMI (p50/p95 + hüküm). Tek anlık örnek #508'i
   * kapatamaz; dağılım kapatır. Örnekleme modeli özet içinde beyan edilir.
   */
  readonly fixAgeDistribution: FixAgeSummary | null;
  /**
   * GPS gözleminin DUVAR SAATİ karşılığı (`readAt - fixAgeMs`).
   *
   * NEDEN TÜRETİLİYOR: `fix.tsMs` monotoniktir (`performance.now`), ekrandaki
   * yaş hesabı ise duvar saatiyle (`readAt`) yapılır. İkisini doğrudan
   * karşılaştırmak SAAT KARIŞTIRMAKtır ve anlamsız yaş üretir. Bu alan iki
   * saati tek noktada, açıkça uzlaştırır.
   *
   * `null` = henüz hiç fix işlenmedi → GPS türevli alanlar damgasız kalır.
   */
  readonly gpsObservedAtWall: number | null;
  readonly mapMatchState: MapMatchState | null;
  readonly mapMatchConfidence: number | null;
  readonly mapMatchSegIdx: number | null;
  readonly lateralM: number | null;
  readonly headingDeltaDeg: number | null;
  readonly alongRemainingM: number | null;
  readonly hasSnappedPosition: boolean;
  readonly matchReasons: readonly MapMatchReason[];
  /** null = nav oturumu yok → koridor BİLİNMİYOR (0 m DEĞİL). */
  readonly corridorM: number | null;

  /* ── Sapma ─────────────────────────────────────────────────────────────── */
  readonly offRouteState: OffRouteState;
  readonly offRouteEvidence: number | null;
  readonly offRouteRequired: number | null;
  readonly offRouteRequiredMs: number | null;
  readonly offRouteConfirmedAtMs: number | null;
  /**
   * Sapmanın doğrulanmasından bu yana geçen süre (ms).
   *
   * NEDEN: `offRouteConfirmedAtMs` monotonik (`performance.now`) bir sayıdır;
   * ekranda ham hâliyle ("1843271 ms") gösterilmesi insana HİÇBİR ŞEY
   * söylemez. Sürüş günü sorulan soru "ne zaman doğrulandı" değil,
   * "kaç saniye önce doğrulandı"dır. `null` = sapma doğrulanmadı.
   */
  readonly offRouteConfirmedAgeMs: number | null;
  readonly offRouteReasons: readonly OffRouteReason[];

  /* ── Rota ilerlemesi ───────────────────────────────────────────────────── */
  readonly geometryPoints: number | null;
  readonly stepCount: number;
  readonly currentStepIndex: number | null;
  readonly nextManeuverDistanceM: number | null;
  readonly nextManeuverDistanceSource: ManeuverDistanceSource;
  readonly totalRouteDistanceM: number | null;
  readonly anchorResolvedCount: number;
  readonly anchorUnresolvedCount: number;
  readonly anchorMethodCounts: Readonly<Record<AnchorMethod, number>>;

  /* ── Doğrulama ─────────────────────────────────────────────────────────── */
  readonly validationVerdict: RouteVerdict | null;
  readonly validationChecks: readonly RouteCheck[];
  /** NAV v3 · F7 — "neden bu rota?" defteri. Okunamazsa `null` (ölçülmedi). */
  readonly routeRationale: RouteRationaleLedgerSnapshot | null;

  /* ── İstek yaşam döngüsü ───────────────────────────────────────────────── */
  readonly requests: RouteRequestSnapshot;
  readonly fetchInFlight: boolean;

  /* ── Şerit dürüstlüğü ──────────────────────────────────────────────────── */
  readonly stepsWithRealLanes: number;
  readonly roundaboutStepCount: number;
  readonly roundaboutWithExitCount: number;

  /* ── Oturum sürekliliği (GÖRÜNÜMDEN BAĞIMSIZ motor) ─────────────────────
   * Sürüş günü sorulacak soru: "tam ekranı kapattım — navigasyon HÂLÂ
   * ilerliyor mu?" Bu blok o soruyu KANITLA yanıtlar: motorun ayakta olup
   * olmadığı, kaç fix işlediği ve son tick'in yaşı. Hiçbiri koordinat veya
   * hedef kimliği TAŞIMAZ. */
  /* ── Harita görünümü + kamera + hız limiti (MINI_MAP_…_P0) ──────────────
   * Hepsi SALT-OKUNUR. Kamera veya hız limiti buradan DEĞİŞTİRİLEMEZ. */
  readonly miniMapStyle: string;
  /** ETKİN gün/gece — tünel örtüsü DAHİL (`getMapNight()`). */
  readonly mapTheme: 'night' | 'day';
  readonly mapContrastProfile: MapContrastProfile;
  /**
   * TÜNEL GECE ÖRTÜSÜ — salt gözlem.
   *  · `tunnelMode`      → `autoBrightnessService` kararı (far + güneş fazı)
   *  · `tunnelOverride`  → örtü haritada FİİLEN uygulanıyor mu
   *  · `requestedNight`  → kullanıcı/saat isteği (örtü kalkınca dönülecek durum)
   *  · `tunnelTransitions` → uygulanan GERÇEK geçiş sayısı (tekrarlar sayılmaz;
   *    bu sayı hızla artıyorsa flicker VARDIR)
   */
  readonly tunnelMode: boolean;
  readonly tunnelOverride: boolean;
  readonly requestedNight: boolean;
  readonly tunnelTransitions: number;
  readonly tunnelBridgeRunning: boolean;
  readonly camera: CameraFollowSnapshot;
  readonly speedLimit: SpeedLimitVerdict;

  /* ── Araç sınıfı + uygulanabilir hız sınırı (VEHICLE_AWARE_SPEED_LIMIT P0) ──
   * SALT-OKUNUR. Buradan sınıf, politika veya limit DEĞİŞTİRİLEMEZ.
   * GİZLİLİK: tam VIN TAŞINMAZ — yalnız maskeli gösterim ve VAR/YOK. */
  readonly vehicleClass: VehicleClassSnapshot;
  /** Araç kanıt deposunun maskeli anahtarı — seri numarası taşımaz. */
  readonly vehicleKeyMasked: string | null;
  readonly roadClassVerdict: RoadClassVerdict;
  readonly effectiveLimit: EffectiveSpeedLimit;
  readonly policyCountry: string;
  readonly policyVersion: string;
  readonly policyEffectiveFrom: string;
  readonly policySourceAuthority: string;
  /** Kalıcı kanıt önbelleği var mı — çevrimdışıyken sınıf hâlâ bilinir mi. */
  readonly offlineCacheState: 'CACHED' | 'EMPTY';

  /* ── Teslim çekirdeği (NAVIGATION_DELIVERY_CORE_P0) — SALT-OKUNUR ────────
   * LAB bu runtime'ları BAŞLATAMAZ, DURDURAMAZ, DEĞİŞTİREMEZ. */
  readonly voice: VoiceGuidanceSnapshot;
  /** Rota süre modeli künyesi. */
  readonly routeDurationSource: RouteDurationSource;
  readonly durationIntegrityState: RouteDurationIntegrity;
  readonly totalRouteDurationSeconds: number | null;
  readonly remainingRouteDurationSeconds: number | null;
  readonly routeRevision: number | null;
  readonly durationRevision: number | null;
  /** ETA hükmü — sayı değil GEREKÇE taşır. */
  readonly eta: EtaVerdict;

  /* ── Hareket + kamera (NAVIGATION_MOTION_CAMERA_P0) — SALT-OKUNUR ────────
   * LAB hiçbir kamera veya hareket davranışını DEĞİŞTİREMEZ.
   * Koordinat TAŞINMAZ: konumlar yalnız VAR/YOK + doğruluk olarak maskelidir. */
  readonly markerMotion: MarkerMotionSnapshot;
  readonly cameraPolicy: CameraPolicyDecision;
  readonly cameraPolicyVersion: string;
  /** Canlı harita değerleri — okunamazsa `null` (uydurma yok). */
  readonly mapZoom: number | null;
  readonly mapPitch: number | null;
  readonly mapBearing: number | null;
  readonly orientation: 'PORTRAIT' | 'LANDSCAPE';
  readonly orientationMode: string;
  /**
   * Politikanın BASTIRACAĞI kamera güncellemesi sayısı — GERÇEK sayaç.
   * Kaynak: `cameraShadowRuntime`, her `setDrivingView` çağrısında artar.
   * (Önceki turda sabit 0 raporlanıyordu; o açık borç bu turda kapandı.)
   */
  readonly suppressedCameraUpdates: number;
  /** Gölge gözlem — legacy ↔ politika karşılaştırması (SALT-OKUNUR). */
  readonly cameraShadow: CameraShadowSnapshot;
  /**
   * Kamera SÖNÜMLEME KADANSI — ölçülen tick aralığı ve ondan türeyen gerçek
   * zaman sabiti. Sönümleme alfaları 150 ms'lik bir tempoda ayarlandığı için
   * tempo sapması doğrudan "kamera hissi" sapmasıdır; burası o sapmanın
   * GÖRÜNÜR olduğu tek yerdir (kaynak: gerçek `dampCameraToward` çağrıları).
   */
  readonly cameraDamping: CameraDampingSnapshot;
  /**
   * Rota RENK kararı — tek hakem (`map/core/routeColorModel`).
   * Boya henüz hiç yazılmadıysa `decision`/`input` `null` olur ve LAB
   * `UNAVAILABLE` gösterir; sahte karar ÜRETİLMEZ.
   */
  readonly routeColor: RouteColorSnapshot;

  readonly sessionId: number;
  /** Rota isteği sahiplenilmiş mi — hedef KİMLİĞİ taşınmaz, yalnız VAR/YOK. */
  readonly hasRouteClaim: boolean;
  readonly runtime: NavigationSessionRuntimeSnapshot;

  /* ── P0-NAV-09 · HEDEF BÜTÜNLÜĞÜ — SALT-OKUNUR ──────────────────────────
   * GİZLİLİK: hedefin ADI ve KOORDİNATI buradan GEÇMEZ. Yalnız hüküm,
   * sebep sınıfı, kesinlik, sayaçlar ve MASKELİ kimlik taşınır. */
  /** Son hedefin bütünlük hükmü — `null` = bu oturumda hiç hedef konmadı. */
  readonly destinationOk: boolean | null;
  /** İlk red sebebi (varsa). */
  readonly destinationRejection: string | null;
  /** Tüm ihlallerin sayısı. */
  readonly destinationRejectionCount: number;
  /** Bu oturumda REDDEDİLEN hedef sayısı — fail-closed kapının etkisi. */
  readonly destinationRejectedTotal: number;
  /** Enlem/boylam takas ŞÜPHESİ sayısı (koordinat ASLA düzeltilmez). */
  readonly destinationSwapSuspectTotal: number;
  /** Son hedefte takas şüphesi var mı ve mesafe asimetrisi. */
  readonly destinationSwapSuspected: boolean;
  readonly destinationSwapAsGivenKm: number | null;
  readonly destinationSwapIfSwappedKm: number | null;
  /** Koordinat kesinliği — sağlayıcı söylemediyse `UNKNOWN`. */
  readonly destinationPrecision: string | null;
  /** Hedefi üreten sağlayıcı/katman etiketi. Bildirilmediyse `null`. */
  readonly destinationProvider: string | null;
  /** Çözümden bu yana geçen süre (ms). Ölçülemezse `null`. */
  readonly destinationAgeMs: number | null;
  /**
   * Rota isteğine GİDEN kimliğin MASKELİ hâli — zincirin son halkası.
   * Tam kimlik PII taşıyabilir (arama sonucu kimliği), bu yüzden yalnız
   * uzunluk + ilk/son karakter gösterilir.
   */
  readonly destinationIdMasked: string | null;

  /* ── P0-NAV-10 · ROTA SAĞLAYICI SİCİLİ — SALT-OKUNUR ────────────────────
   * GİZLİLİK: koordinat ve tam URL taşınmaz — yalnız ana makine etiketi,
   * sınıf, adet ve süre. */
  readonly routeChain: RouteChainSummary;
  /** Sağlayıcı × sonuç sayacı (`provider|outcome` → adet). */
  readonly routeAttemptCounts: Readonly<Record<string, number>>;
  /** Yedek katmanın kurtardığı istek sayısı — GİZLİ DEGRADASYONun ölçüsü. */
  readonly routeFallbackSuccessCount: number;
  /** Düz hatta düşen istek sayısı — GERÇEK ROTA ÜRETİLEMEDİ. */
  readonly routeStraightLineChainCount: number;
  /** Son isteğin denemeleri (en fazla halka kadar). */
  readonly routeAttempts: readonly RouteAttempt[];

  /* ── P0-NAV-11 · GEOMETRİ BÜTÜNLÜĞÜ — SALT-OKUNUR ───────────────────────
   * GİZLİLİK: koordinat TAŞINMAZ. bbox yalnız DERECE GENİŞLİĞİ olarak gelir,
   * köşe noktaları DEĞİL — rota geometrisi sürücünün gittiği yeri açık eder. */
  /** Haritaya UYGULANAN geometrinin künyesi. Hiç rota yoksa `null`. */
  readonly committedGeometry: CommittedGeometryEvidence | null;
  /** REDDEDİLEN aday sayısı — kanıt silinmez (halka taşsa bile toplam korunur). */
  readonly rejectedGeometryTotal: number;
  /** Son reddedilen adayın bozukluk sınıfları. Yoksa boş dizi. */
  readonly lastRejectedFlaws: readonly string[];
  /** Son reddedilen adayın FAIL veren denetim kimlikleri. */
  readonly lastRejectedCheckIds: readonly string[];

  /* ── P0-NAV-12 · İLERLEME DÜRÜSTLÜĞÜ — SALT-OKUNUR ──────────────────────
   * Koordinat TAŞIMAZ: yalnız metre · km/h · derece · sınıf. */
  readonly progress: ProgressLedgerSnapshot;

  /* ── P0-NAV-13 · REROUTE SAĞLIĞI + ENGEL SEBEPLERİ — SALT-OKUNUR ────────
   * ÖLÇÜLEN KUSUR: `getRerouteBlockStats()` ürünün HİÇBİR yerinden
   * okunmuyordu (tek çağıranı bir testti) — engellenen reroute'ların sebebi
   * yazılıyor ama hiçbir ekrana TAŞINMIYORDU. */
  readonly rerouteHealth: RerouteHealthVerdict;
  readonly rerouteBlockedCount: number;
  readonly rerouteBlockByReason: Readonly<Record<string, number>>;
  readonly rerouteLastBlockReason: string | null;

  /* ── P0-NAV-16 · SESLİ YÖNLENDİRME DENETİMİ — SALT-OKUNUR ───────────────
   * Runtime yalnız SÖYLENENİ sayıyordu; "hiç söylenmedi" ve "geç söylendi"
   * hiçbir yerde görünmüyordu. GİZLİLİK: talimat METNİ taşınmaz. */
  readonly guidanceAudit: GuidanceAuditSnapshot;

  /* ── P0-NAV-19 · SICAK YOL MALİYETİ — SALT-OKUNUR ───────────────────────
   * Rota uzadıkça pahalılaşan tek iş harita eşleştirmedir; maliyeti üründe
   * hiçbir yerde ölçülmüyordu. */
  readonly tickCost: NavTickCostSnapshot;

  /* ── P0-NAV-20 · ARIZA TABLOSU — SALT-OKUNUR ────────────────────────────
   * Yeni ölçüm YOK: bu gece kurulan otoritelerin hükümlerini TEK tabloda
   * toplar. **OBD durumu bilinçli olarak GİRDİ DEĞİLDİR.** */
  readonly failureMatrix: NavFailureMatrix;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const _EMPTY_PROVIDER: ProviderReadinessSnapshot = {
  localState: 'UNKNOWN', localProbedAtMs: null, localProbeCount: 0,
  localSkippedCount: 0, lastSource: 'NONE', lastProviderLabel: null,
  straightLineCount: 0, remoteFailureCount: 0,
};

const _EMPTY_OFFLINE: OfflineRoutingStatus = {
  state: 'UNKNOWN', attemptCount: 0, lastAttemptAt: null,
  /* NAV v3 · F2.0 — monotonik tazelik damgası (duvar saatinden AYRI). */
  lastAttemptAtMonoMs: null, usable: false,
};

const _EMPTY_CAMERA: CameraFollowSnapshot = {
  cameraMode: 'UNKNOWN', isVehicleCentered: false, lastUserPanAgeMs: null,
  recenterAvailable: false, lastRecenterAgeMs: null, recenterReason: 'NONE',
  followZoom: null, autoRecenterPending: false, autoRecenterDelayMs: 0, listenerCount: 0,
};

const _EMPTY_SPEED_LIMIT: SpeedLimitVerdict = {
  state: 'UNKNOWN', kmh: null, source: null, ageMs: null,
  distanceFromFixM: null, confidence: 0, reason: 'okunamadı',
};

const _EMPTY_SHADOW: CameraShadowSnapshot = {
  enabled: false, policyVersion: CAMERA_POLICY_VERSION,
  policyEvaluationCount: 0, policyAcceptedCount: 0, policySuppressedCount: 0,
  legacyCameraApplyCount: 0, legacyCameraSkipCount: 0,
  duplicateEquivalentUpdateCount: 0, lastSuppressionReason: null,
  maxAnchorYDelta: 0, maxZoomDelta: 0, maxPitchDelta: 0, last: null,
};

/** Okunamazsa: sayı UYDURULMAZ — ölçüm yok demek `null`/0 demektir. */
const _EMPTY_DAMPING: CameraDampingSnapshot = {
  calibrationDtMs: 0, lastDtMs: null, tickCount: 0, offCadenceTicks: 0,
  effectivePitchTauSec: null, calibrationPitchTauSec: 0,
  cruiseMs: 0, inCruise: false,
};

/** Okunamazsa: karar UYDURULMAZ — `null` "henüz yazılmadı" demektir. */
const _EMPTY_ROUTE_COLOR: RouteColorSnapshot = {
  policyVersion: 'UNAVAILABLE', decision: null, input: null,
};

const _EMPTY_CAMERA_DECISION: CameraPolicyDecision = {
  state: 'UNKNOWN', profileId: 'STOPPED', policyVersion: CAMERA_POLICY_VERSION,
  speedBand: 'STOPPED', maneuverBand: 'NONE', anchorY: 0.5, anchorX: 0.5,
  cameraDriveAllowed: false, applyManeuverCamera: false, maxZoomHint: null,
  updateReason: 'okunamadı',
};

const _EMPTY_MOTION: MarkerMotionSnapshot = {
  state: 'UNKNOWN', interpolationProgress: 0, sourceAgeMs: 0, confidence: 0,
  rawPositionMasked: 'YOK', renderedPositionMasked: 'YOK',
  sampleCount: 0, snapCorrectionCount: 0, duplicateMotionRuntimeCount: 0,
  reason: 'okunamadı',
};

const _EMPTY_ROAD_CLASS: RoadClassVerdict = {
  roadClass: 'UNKNOWN', confidence: 0, motorwayOperatorKnown: false,
  reason: 'okunamadı',
};

const _EMPTY_VEHICLE_CLASS: VehicleClassSnapshot = {
  key: null, profile: EMPTY_VEHICLE_CLASS_PROFILE, researchOutcome: 'IDLE',
  researchAttemptedAt: null, researchFailureReason: null, promptDismissedAt: null,
  vinMasked: null, hasVin: false,
};

const _EMPTY_VOICE: VoiceGuidanceSnapshot = {
  state: 'IDLE', owner: 'NAV_SESSION_RUNTIME', lastSpokenManeuverId: null,
  lastSpokenStage: null, spokenCount: 0, duplicateSuppressed: 0,
  trackedManeuvers: 0, routeKey: '',
};

const _EMPTY_ETA: EtaVerdict = {
  etaSeconds: null, state: 'UNKNOWN', source: 'NONE',
  correctionFactor: 1, baseSeconds: null, reason: 'okunamadı',
};

const _EMPTY_RUNTIME: NavigationSessionRuntimeSnapshot = {
  running: false, tickCount: 0, lastTickAgeMs: null, lastObservedStatus: null,
  skippedNoFix: 0, skippedInactive: 0, errorCount: 0, lastErrorAgeMs: null,
  uptimeMs: null,
  drState: 'IDLE', drOwner: 'NAV_SESSION_RUNTIME', drTickCount: 0,
  drDistanceMeters: 0, drConfidence: 0, drTimerRunning: false,
  /* Okunamadı → eksen/mesafe/segment UYDURULMAZ. */
  drProjectionMode: 'HEADING_FALLBACK', drConsumedRouteM: null, drProjectionSegIdx: null,
};

/** Tek senkron okuma — çağrıldığı anın anlık görüntüsü. */
/** Kimliği maskele — uzunluk + uçlar. Tam kimlik LAB'a TAŞINMAZ. */
function _maskId(id: string | null): string | null {
  if (id === null || id.length === 0) return null;
  if (id.length <= 4) return `${id.length} karakter`;
  return `${id.slice(0, 2)}…${id.slice(-2)} (${id.length})`;
}

/**
 * P0-NAV-09 hedef bütünlüğü alanları. Okuma başarısızsa hepsi "bilinmiyor"
 * döner — sahte "sağlıklı" ÜRETİLMEZ.
 */
function _destinationIntegrityFields(): Pick<NavigationCoreRawSnapshot,
  | 'destinationOk' | 'destinationRejection' | 'destinationRejectionCount'
  | 'destinationRejectedTotal' | 'destinationSwapSuspectTotal'
  | 'destinationSwapSuspected' | 'destinationSwapAsGivenKm'
  | 'destinationSwapIfSwappedKm' | 'destinationPrecision'
  | 'destinationProvider' | 'destinationAgeMs' | 'destinationIdMasked'> {
  const snap = _safe(() => getDestinationIntegritySnapshot(), null);
  const last = snap?.last ?? null;
  return {
    destinationOk:               last === null ? null : last.ok,
    destinationRejection:        last?.rejection ?? null,
    destinationRejectionCount:   last?.allRejections.length ?? 0,
    destinationRejectedTotal:    snap?.rejectedCount ?? 0,
    destinationSwapSuspectTotal: snap?.swapSuspectCount ?? 0,
    destinationSwapSuspected:    last?.swap.suspected ?? false,
    destinationSwapAsGivenKm:    last?.swap.asGivenKm ?? null,
    destinationSwapIfSwappedKm:  last?.swap.ifSwappedKm ?? null,
    destinationPrecision:        last?.identity?.precision ?? null,
    destinationProvider:         last?.identity?.provider ?? null,
    destinationAgeMs:            last?.ageMs ?? null,
    destinationIdMasked:         _maskId(snap?.committed?.placeId ?? null),
  };
}

const _EMPTY_CHAIN: RouteChainSummary = {
  outcome: 'UNKNOWN', winner: null, winnerLabel: null,
  fallbackReason: null, degradedSteps: 0, attemptedCount: 0,
  why: 'defter okunamadı',
};

/** P0-NAV-10 sağlayıcı sicili. Okuma başarısızsa "bilinmiyor" döner. */
function _routeProviderFields(): Pick<NavigationCoreRawSnapshot,
  | 'routeChain' | 'routeAttemptCounts' | 'routeFallbackSuccessCount'
  | 'routeStraightLineChainCount' | 'routeAttempts'> {
  const led = _safe(() => getRouteProviderLedger(), null);
  return {
    routeChain:                  led?.lastChain ?? _EMPTY_CHAIN,
    routeAttemptCounts:          led?.counts ?? {},
    routeFallbackSuccessCount:   led?.fallbackSuccessCount ?? 0,
    routeStraightLineChainCount: led?.straightLineChainCount ?? 0,
    routeAttempts:               led?.attempts ?? [],
  };
}

const _EMPTY_MATRIX: NavFailureMatrix = {
  axes: [], overall: 'UNKNOWN', worstAxis: null, summary: 'tablo okunamadı',
};

const _EMPTY_TICK_STATS = {
  samples: 0, total: 0, p50Ms: null, p95Ms: null, maxMs: null,
} as const;
const _EMPTY_TICK_COST: NavTickCostSnapshot = {
  mapMatch: _EMPTY_TICK_STATS, progressTick: _EMPTY_TICK_STATS,
};

const _EMPTY_GUIDANCE_AUDIT: GuidanceAuditSnapshot = {
  timing: { ON_TIME: 0, LATE: 0, VERY_LATE: 0, UNKNOWN: 0 },
  missed: { NONE: 0, MISSED_IMMINENT: 0, MISSED_ALL: 0, SILENCE_JUSTIFIED: 0 },
  recent: [], announcementCount: 0, maneuverCount: 0,
};

const _EMPTY_PROGRESS: ProgressLedgerSnapshot = {
  counts: {
    PLAUSIBLE: 0, STATIONARY: 0, IMPLAUSIBLE_FORWARD: 0, REAL_BACKTRACK: 0,
    IMPLAUSIBLE_BACKWARD: 0, ROUTE_CHANGED: 0, UNKNOWN: 0,
  },
  anomalies: [], lastVerdict: null,
  maxForwardJumpM: null, maxBackwardJumpM: null, totalSamples: 0,
};

/**
 * P0-NAV-13 reroute sağlığı + engel sebepleri.
 *
 * ⚠️ SAAT BİRLİĞİ: `offRoute.confirmedAtMs` ve `routeRequestLedger`in
 * `committedAtMs` alanı İKİSİ DE `performance.now()` mertebesindedir
 * (monotonik). Duvar saatiyle karıştırmak açlık süresini saçmalatırdı —
 * bu yüzden `nowMs` olarak `nowPerf` verilir.
 */
function _rerouteHealthFields(
  confirmedAtMs: number | null, offRouteState: string, nowPerf: number,
): Pick<NavigationCoreRawSnapshot,
  | 'rerouteHealth' | 'rerouteBlockedCount'
  | 'rerouteBlockByReason' | 'rerouteLastBlockReason'> {
  const stats = _safe(() => getRerouteBlockStats(), null);
  const reqs  = _safe(() => getRouteRequestSnapshot(), null);
  return {
    rerouteHealth: _safe(() => judgeRerouteHealth({
      confirmedAtMs,
      lastCommitAtMs: reqs?.current?.committedAtMs ?? null,
      offRouteState,
      lastBlock: stats?.last ?? null,
      nowMs: nowPerf,
    }), {
      health: 'UNKNOWN', offRouteForMs: null, blockedBy: null,
      why: 'okuma başarısız',
    }),
    rerouteBlockedCount:    stats?.blockedCount ?? 0,
    rerouteBlockByReason:   stats?.byReason ?? {},
    rerouteLastBlockReason: stats?.last?.reason ?? null,
  };
}

/** P0-NAV-11 geometri kanıtı. Okuma başarısızsa "bilinmiyor" döner. */
function _routeGeometryFields(): Pick<NavigationCoreRawSnapshot,
  | 'committedGeometry' | 'rejectedGeometryTotal'
  | 'lastRejectedFlaws' | 'lastRejectedCheckIds'> {
  const committed = _safe(() => getCommittedGeometry(), null);
  const rejected  = _safe(() => getRejectedGeometryEvidence(), null);
  const last = rejected && rejected.recent.length > 0
    ? rejected.recent[rejected.recent.length - 1] : null;
  return {
    committedGeometry:     committed,
    rejectedGeometryTotal: rejected?.total ?? 0,
    lastRejectedFlaws:     last?.flaws ?? [],
    lastRejectedCheckIds:  last?.failedCheckIds ?? [],
  };
}

export function readNavigationCoreSnapshot(): NavigationCoreRawSnapshot {
  const readAt = Date.now();
  const paintedArrow = _safe(() => readPaintedArrowDiagnostics(), PAINTED_ARROW_FALLBACK);
  const nowPerf = _safe(() => performance.now(), 0);

  const route = _safe(() => getRouteState(), null);
  const core  = _safe(() => getNavigationCoreSnapshot(), null);
  const nav   = _safe(() => getNavigationState(), null);

  const fix = core?.fix ?? null;
  const anchors = route?.maneuverAnchors ?? [];
  const fixAgeMs = fix ? Math.max(0, Math.round(nowPerf - fix.tsMs)) : null;

  const anchorMethodCounts: Record<AnchorMethod, number> = {
    CONCATENATION: 0, NEAREST: 0, UNRESOLVED: 0,
  };
  for (const a of anchors) anchorMethodCounts[a.method]++;

  const steps = route?.steps ?? [];
  let stepsWithRealLanes = 0;
  let roundaboutStepCount = 0;
  let roundaboutWithExitCount = 0;
  for (const s of steps) {
    if (s.lanes && s.lanes.length > 0) stepsWithRealLanes++;
    const t = s.maneuverType;
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') {
      roundaboutStepCount++;
      if (s.roundaboutExit != null) roundaboutWithExitCount++;
    }
  }

  /* Hız limiti zinciri LAB'da da ÜRÜNLE AYNI saf modellerden geçirilir — ekran
     kendi sınıflandırmasını YAPMAZ (ikinci doğruluk kaynağı olmaz). Konum
     TAŞINMAZ: modeller yalnız mesafe/yaş türevlerini döndürür. */
  const slObs = _safe(() => getSpeedLimitObservation(), null);
  const speedLimit = _safe(() => classifySpeedLimit(
    getSpeedLimitObservation(),
    { lat: null, lon: null, nowMs: nowPerf },
    false,
  ), _EMPTY_SPEED_LIMIT);
  const roadClass = _safe(() => resolveRoadClass({
    highway: slObs?.highway ?? null,
    postedKmh: slObs?.kmh ?? null,
    postedSource: slObs?.source ?? null,
  }), _EMPTY_ROAD_CLASS);
  const vehicleClass = _safe(() => getVehicleClassSnapshot(), _EMPTY_VEHICLE_CLASS);

  /* Kamera kararı LAB'da da ÜRÜNLE AYNI saf modelden geçirilir — ekran kendi
     kamera mantığını KURMAZ (ikinci otorite olmaz). */
  const _orientation = _safe(() => (typeof window !== 'undefined'
    ? orientationOf(window.innerWidth, window.innerHeight) : 'LANDSCAPE'), 'LANDSCAPE');
  const _motionNow = _safe(() => getMarkerMotionSnapshot(nowPerf), _EMPTY_MOTION);
  const _camFollow = _safe(() => getCameraFollowSnapshot(), _EMPTY_CAMERA);
  const _shadow = _safe(() => getCameraShadowSnapshot(), _EMPTY_SHADOW);
  /* SAHTE SIFIR YASAĞI (envanter denetimi E-10): hız bilinmiyorken `?? 0`
     yazmak kamera kararını "DURUYOR" bandına sokuyordu → LAB, ürünün gerçek
     kararından AYRIŞMIŞ bir hüküm gösteriyordu (üstelik "ürünle aynı saf
     modelden geçer" iddiasıyla). Hız yoksa LAB da KARAR ÜRETMEZ. */
  const _speedForCamera = _safe(() => useUnifiedVehicleStore.getState().speed ?? null, null);
  const _cameraDecision = _speedForCamera === null
    ? { ..._EMPTY_CAMERA_DECISION, updateReason: 'hız bilinmiyor — karar üretilmedi' }
    : _safe(() => decideCameraPolicy({
      speedKmh: _speedForCamera,
      prevBand: null,
      nextManeuverM: route?.distanceToNextTurnMeters ?? null,
      maneuverDistanceSource: route?.distanceToNextTurnSource ?? 'UNKNOWN',
      secondManeuverM: null,
      followState: (_camFollow.cameraMode as never) ?? 'UNKNOWN',
      motionState: _motionNow.state,
      orientation: _orientation,
      viewport: 'FULL',
    }), _EMPTY_CAMERA_DECISION);

  return {
    paintedArrow,
    readAt,

    navStatus:    nav?.status ?? 'UNKNOWN',
    isNavigating: nav?.isNavigating ?? false,
    isRerouting:  nav?.isRerouting ?? false,
    hasDestination: !!nav?.destination,
    remainingDistanceM: (nav?.distanceMeters != null && Number.isFinite(nav.distanceMeters))
      ? nav.distanceMeters : null,
    etaSeconds: (nav?.etaSeconds != null && Number.isFinite(nav.etaSeconds)) ? nav.etaSeconds : null,

    provider:     _safe(() => getProviderReadinessSnapshot(), _EMPTY_PROVIDER),
    offlineGraph: _safe(() => getOfflineRoutingStatus(), _EMPTY_OFFLINE),
    onlineHint:   _safe(() => (typeof navigator !== 'undefined' ? navigator.onLine : null), null),
    serverUsed:   route?.serverUsed ?? null,
    routeError:   route?.error ?? null,
    routeLoading: route?.loading ?? false,
    straightLineActive: route?.serverUsed === 'straight-line',

    hasRawFix:  fix !== null,
    fixAgeMs,
    /* #508: G1 otoritesinden — koordinat TAŞINMAZ, yalnız yaş/bayatlık/kaynak. */
    locationFixAgeMs: _safe(() => getLocationEvidence().fixAgeMs, null),
    locationStale:    _safe(() => getLocationEvidence().stale, false),
    locationSource:   _safe(() => getLocationEvidence().source, 'NONE'),
    /* #537: dağılım okuma ucu ÖRNEK ALMAZ → LAB'ı açmak ölçümü kirletmez. */
    fixAgeDistribution: _safe(() => getFixAgeLedger().summary, null),
    gpsObservedAtWall: fixAgeMs != null ? readAt - fixAgeMs : null,
    mapMatchState:      fix?.state ?? null,
    mapMatchConfidence: fix ? fix.confidence : null,
    mapMatchSegIdx:     fix ? fix.segIdx : null,
    lateralM:           fix?.lateralM ?? null,
    headingDeltaDeg:    fix?.headingDeltaDeg ?? null,
    alongRemainingM:    fix?.alongRemainingM ?? null,
    hasSnappedPosition: !!(fix && fix.snappedLat !== null && fix.snappedLon !== null),
    matchReasons:       fix?.reasons ?? [],
    /* SAHTE SIFIR YASAĞI (E-11): nav oturumu yokken 0 yazmak "koridor 0 m"
       demekti — okuyan araç HER ZAMAN koridor dışında sanırdı. */
    corridorM:          core?.corridorM ?? null,

    offRouteState:         core?.offRoute.state ?? 'UNKNOWN',
    offRouteEvidence:      core?.offRoute.evidenceCount ?? null,
    offRouteRequired:      core?.offRoute.requiredEvidence ?? null,
    offRouteRequiredMs:    core?.offRoute.requiredEvidenceMs ?? null,
    offRouteConfirmedAtMs: core?.offRoute.confirmedAtMs ?? null,
    offRouteConfirmedAgeMs: core?.offRoute.confirmedAtMs != null
      ? Math.max(0, Math.round(nowPerf - core.offRoute.confirmedAtMs))
      : null,
    offRouteReasons:       core?.offRoute.reasons ?? [],

    geometryPoints:   route?.geometry?.length ?? null,
    stepCount:        steps.length,
    currentStepIndex: route?.currentStepIndex ?? null,
    nextManeuverDistanceM: (route && Number.isFinite(route.distanceToNextTurnMeters))
      ? route.distanceToNextTurnMeters : null,
    nextManeuverDistanceSource: route?.distanceToNextTurnSource ?? 'UNKNOWN',
    totalRouteDistanceM: route?.totalDistanceMeters ?? null,
    anchorResolvedCount:   anchors.filter(a => a.geometryIndex >= 0).length,
    anchorUnresolvedCount: anchors.filter(a => a.geometryIndex < 0).length,
    anchorMethodCounts,

    validationVerdict: route?.validation?.verdict ?? null,
    validationChecks:  route?.validation?.checks ?? [],
    /* F7 — salt okuma; defteri KİRLETMEZ (yalnız anlık görüntü). */
    routeRationale:    _safe(() => getRouteRationaleLedger(), null),

    requests:      _safe(() => getRouteRequestSnapshot(), {
      currentId: 0, current: null, history: [], committedCount: 0,
      staleRejectedCount: 0, invalidRejectedCount: 0, supersededCount: 0,
      failedCount: 0, suppressedDuplicateCount: 0,
      latency: {
        offRouteDetectedAtMs: null, requestStartedAtMs: null, responseReceivedAtMs: null,
        routeCommittedAtMs: null, firstNewInstructionAtMs: null,
        detectToCommitMs: null, detectToFirstInstructionMs: null, requestToResponseMs: null,
      },
      lastCompletedLatency: {
        offRouteDetectedAtMs: null, requestStartedAtMs: null, responseReceivedAtMs: null,
        routeCommittedAtMs: null, firstNewInstructionAtMs: null,
        detectToCommitMs: null, detectToFirstInstructionMs: null, requestToResponseMs: null,
      },
    }),
    fetchInFlight: core?.fetchInFlight ?? false,

    stepsWithRealLanes,
    roundaboutStepCount,
    roundaboutWithExitCount,

    /* KÖK 2 (2026-08-18): eskiden `st.tileRender` (NİYET) okunuyordu — vektör
       kaynağı reddedip `buildVectorStyle` sessizce raster'a düştüğünde bu alan
       hâlâ "vector" yazıyordu, LAB yalancı tanıklık ediyordu. `getResolvedTileMode()`
       `getMapStyle()`in GERÇEKTEN döndürdüğü modu taşır — tek doğruluk kaynağı. */
    /* #640: mod YETMEZ, SEBEP de görünmeli. Sahada "harita neden gri?" sorusu
       yalnız "raster" bilgisiyle cevaplanamadı — hangi kapıdan düşüldüğü
       (termal kilit / AR / niyet / vektör kapısı / kaynak yok) ekranda yazar. */
    miniMapStyle: _safe(() => {
      const v = getTileModeVerdict();
      return v.reason
        ? `${v.mapMode}/${v.resolved} · sebep: ${v.reason}`
        : `${v.mapMode}/${v.resolved}`;
    }, 'UNKNOWN'),
    mapTheme:           _safe(() => (getMapNight() ? 'night' : 'day'), 'night'),
    mapContrastProfile: _safe(() => getMapContrastProfile(getMapNight()), 'NIGHT_READABLE'),
    /* Okunamazsa örtü YOK sayılır (fail-safe: sahte tünel ilan edilmez). */
    tunnelMode:          _safe(() => getTunnelMode(), false),
    tunnelOverride:      _safe(() => isTunnelNightOverrideActive(), false),
    requestedNight:      _safe(() => getRequestedMapNight(), false),
    tunnelTransitions:   _safe(() => getTunnelNightTransitionCount(), 0),
    tunnelBridgeRunning: _safe(() => isTunnelNightRuntimeRunning(), false),
    camera:             _safe(() => getCameraFollowSnapshot(), _EMPTY_CAMERA),
    /* Hız limiti hükmü LAB'da da AYNI saf modelden geçirilir — ekran kendi
       sınıflandırmasını yapmaz (ikinci doğruluk kaynağı olmaz). Konum
       TAŞINMAZ: model yalnız mesafe/yaş türevlerini döndürür. */
    speedLimit,

    vehicleClass,
    vehicleKeyMasked: _safe(() => maskVehicleClassKey(vehicleClass.key), null),
    roadClassVerdict: roadClass,
    effectiveLimit: _safe(() => computeEffectiveSpeedLimit({
      road: speedLimit, roadClass, vehicleClass: vehicleClass.profile,
    }), EMPTY_EFFECTIVE_SPEED_LIMIT),
    policyCountry: POLICY_COUNTRY,
    policyVersion: POLICY_VERSION,
    policyEffectiveFrom: POLICY_EFFECTIVE_FROM,
    policySourceAuthority: POLICY_SOURCE_AUTHORITY,
    offlineCacheState: vehicleClass.profile.resolutionState === 'UNAVAILABLE' ? 'EMPTY' : 'CACHED',

    ..._destinationIntegrityFields(),
    ..._routeProviderFields(),
    ..._routeGeometryFields(),
    progress: _safe(() => getProgressLedger(), _EMPTY_PROGRESS),
    guidanceAudit: _safe(() => getGuidanceAudit(), _EMPTY_GUIDANCE_AUDIT),
    tickCost: _safe(() => getNavTickCostSnapshot(), _EMPTY_TICK_COST),
    failureMatrix: _safe(() => buildNavFailureMatrix({
      navActive: nav?.isNavigating ?? false,
      gpsUsable: core?.fix != null,
      fixAgeMs: fix ? Math.max(0, Math.round(nowPerf - fix.tsMs)) : null,
      /* Doğruluk `location`dan gelir (map-match fix'i doğruluğu taşımaz);
         eşik HUD ile AYNI otoriteden okunur — ikinci eşik İCAT EDİLMEZ. */
      gpsDecisionGrade: isGpsDecisionGrade(
        core?.fix != null,
        _safe(() => useUnifiedVehicleStore.getState().location?.accuracy ?? null, null),
      ),
      online: typeof navigator === 'undefined' ? null : navigator.onLine,
      searchVerdict: null,   // arama hükmü ayrı ekranda (Adres Arama Kanıtı)
      routeChainOutcome: _safe(() => getRouteProviderLedger().lastChain.outcome, null),
      geometryIntegrity: _safe(() => getCommittedGeometry()?.integrity ?? null, null),
      progressVerdict: _safe(() => getProgressLedger().lastVerdict, null),
      rerouteHealth: _safe(() => judgeRerouteHealth({
        confirmedAtMs: core?.offRoute.confirmedAtMs ?? null,
        lastCommitAtMs: getRouteRequestSnapshot().current?.committedAtMs ?? null,
        offRouteState: core?.offRoute.state ?? 'UNKNOWN',
        lastBlock: getRerouteBlockStats().last,
        nowMs: nowPerf,
      }).health, null),
      routeRequestPending: _safe(
        () => getRouteRequestSnapshot().current?.outcome === 'PENDING', false),
    }), _EMPTY_MATRIX),
    ..._rerouteHealthFields(core?.offRoute.confirmedAtMs ?? null,
      core?.offRoute.state ?? 'UNKNOWN', nowPerf),
    sessionId:     _safe(() => getNavSessionId(), 0),
    hasRouteClaim: _safe(() => getRouteRequestClaim() !== null, false),
    runtime:       _safe(() => getNavigationSessionRuntimeSnapshot(), _EMPTY_RUNTIME),

    voice: _safe(() => getVoiceGuidanceSnapshot(), _EMPTY_VOICE),
    routeDurationSource:    route?.routeDurationSource ?? 'NONE',
    durationIntegrityState: route?.durationIntegrityState ?? 'MISSING',
    totalRouteDurationSeconds: (route?.totalDurationSeconds != null
      && Number.isFinite(route.totalDurationSeconds) && route.totalDurationSeconds > 0)
      ? route.totalDurationSeconds : null,
    remainingRouteDurationSeconds: route?.remainingRouteDurationSeconds ?? null,
    /* Aynı dosyada İKİ farklı "bilinmiyor" dili vardı (0 ve -1) — ikisi de
       `null`a toplandı (E-11). */
    routeRevision:    route?.routeRevision ?? null,
    durationRevision: route?.durationRevision ?? null,
    eta: _safe(() => getEtaVerdict(), _EMPTY_ETA),

    markerMotion: _safe(() => getMarkerMotionSnapshot(nowPerf), _EMPTY_MOTION),
    cameraPolicy: _cameraDecision,
    cameraPolicyVersion: CAMERA_POLICY_VERSION,
    mapZoom:    _safe(() => { const m = getMapInstance(); return m ? Number(m.getZoom().toFixed(2)) : null; }, null),
    mapPitch:   _safe(() => { const m = getMapInstance(); return m ? Math.round(m.getPitch()) : null; }, null),
    mapBearing: _safe(() => { const m = getMapInstance(); return m ? Math.round(m.getBearing()) : null; }, null),
    orientation: _orientation,
    orientationMode: _safe(() => getNavigationOrientationSnapshot().mode, 'LOCKED_LANDSCAPE'),
    /* GERÇEK sayaç — `cameraShadowRuntime` her legacy kamera çağrısında
       politikayı gölgede değerlendirir ve bastırma kararını sayar. */
    suppressedCameraUpdates: _shadow.policySuppressedCount,
    cameraShadow: _shadow,
    cameraDamping: _safe(() => getCameraDampingSnapshot(), _EMPTY_DAMPING),
    routeColor:    _safe(() => getRouteColorSnapshot(), _EMPTY_ROUTE_COLOR),

    /* NAV v3 · F3 — her okuma kendi try/catch'inde; bir otorite patlarsa
       diğerleri görünmeye devam eder (`<x>Sources.ts` deseni). */
    ego:              _safe(() => getEgoAuthority().getDiagnostics(), null),
    ceh:              _safe(() => getCehAuthority().getDiagnostics(), null),
    yawFeed:          _safe(() => getNavOrientationFeedSnapshot(), null),
    egoHorizonBridge: _safe(() => getNavEgoHorizonBridgeSnapshot(), null),
    graphResidency:   _safe(() => getGraphResidencySnapshot(), null),
    regionalDistribution: _safe(() => getRegionalDistributionSnapshotSync(), null),
    crossRegionSearch: _safe(() => getCrossRegionSearchSnapshot(), null),
    /* F5 — gölge okuması SAYAÇLARI KİRLETMEZ: `getCehShadowSnapshot` yalnız
       okur, gölge tikini tetiklemez (ölçüm gözlemden etkilenmez). */
    cehShadow:        _safe(() => getCehShadowSnapshot(), null),
    /* F6 — port okuması da salt-okunur; koridor/eşleştirme TETİKLEMEZ. */
    enforcementHorizonPort: _safe(() => getEnforcementHorizonPortSnapshot(), null),
  };
}
