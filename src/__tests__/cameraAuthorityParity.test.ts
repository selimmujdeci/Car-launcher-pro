/**
 * cameraAuthorityParity.test.ts — KAMERA OTORİTE SINIRI KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KANITLANAN SORU ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * *"`cameraPolicyModel` ile `cameraFollowAuthority` aynı gerçeği iki kez mi
 * üretiyor?"*
 *
 * **HAYIR.** Kod kanıtı (bu dosyada kilitlidir):
 *
 *  1. `cameraFollowAuthority._state` takip durumunun TEK üreticisidir;
 *     `canDriveCamera()` yalnız `FOLLOWING`de `true` (fail-closed).
 *  2. `decideCameraPolicy` takip durumunu **HESAPLAMAZ** — `followState`
 *     GİRDİDİR ve kanonik otoriteden gelir
 *     (`cameraShadowRuntime._mapFollow`: *"birebir eşleme, yeni durum YOK"*).
 *  3. Üretimde `cameraDriveAllowed` HİÇ tüketilmez (yalnız gölge + LAB);
 *     üretim kapısı `canDriveCamera()`tır.
 *
 * Yani: **projeksiyon var, ikinci otorite YOK.**
 *
 * ── TEK GERÇEK FARK: `RECENTERING` (BİLİNÇLİ) ─────────────────────────────
 * Ortalama uygulanırken kamerayı ORTALAMA İŞLEMİ sürer:
 *   · "sistem sürüyor mu?"      → EVET → `cameraDriveAllowed: true`
 *   · "rutin fix sürebilir mi?" → HAYIR → `canDriveCamera(): false`
 * İkisi de doğrudur. Fark `routineFixMayDriveCamera()` izdüşümüyle AÇIKÇA
 * ifade edilir; gölge karşılaştırması artık elmayla elmayı ölçer.
 *
 * Bu dosya PARİTE MATRİSİNİ deterministik ve SAF olarak kilitler.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  decideCameraPolicy, routineFixMayDriveCamera,
  type CameraPolicyInput, type CameraPolicyDecision,
} from '../platform/navigation/core/cameraPolicyModel';
import {
  CameraFollowState, canDriveCamera, getCameraFollowState,
  notifyUserPanStart, notifyUserPanEnd, beginRecenter, completeRecenter,
  resetCameraFollow, _resetCameraFollowForTest,
} from '../platform/navigation/cameraFollowAuthority';

/* ══════════════════════════════════════════════════════════════════════════
   YARDIMCI — politika girdisi (yalnız ilgili alanlar değişir)
   ══════════════════════════════════════════════════════════════════════════ */

function policy(over: Partial<CameraPolicyInput> = {}): CameraPolicyDecision {
  return decideCameraPolicy({
    speedKmh: 50,
    prevBand: null,
    nextManeuverM: null,
    maneuverDistanceSource: 'UNKNOWN',
    secondManeuverM: null,
    followState: 'FOLLOWING',
    motionState: 'TRACKING',
    orientation: 'LANDSCAPE',
    viewport: 'FULL',
    ...over,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   1) PARİTE MATRİSİ — iki otorite AYNI soruda AYNI hükmü verir mi?
   ══════════════════════════════════════════════════════════════════════════ */

type ParityClass = 'AGREE' | 'INTENTIONAL_DIFFERENCE';

interface ParityRow {
  readonly scenario: string;
  readonly follow: CameraFollowState;
  readonly over: Partial<CameraPolicyInput>;
  /** `canDriveCamera()`in bu takip durumundaki hükmü. */
  readonly authorityAllows: boolean;
  /** `routineFixMayDriveCamera()`in hükmü — AYNI soru. */
  readonly projectionAllows: boolean;
  readonly klass: ParityClass;
}

/**
 * Matris. Her satır GERÇEK bir sürüş durumudur ve iki sistemin hükmü
 * YAN YANA yazılıdır — sapma sessizce oluşamaz.
 */
const PARITY: readonly ParityRow[] = [
  { scenario: 'navigasyon kapalı / duruyor (takip açık)',
    follow: CameraFollowState.FOLLOWING, over: { speedKmh: 0 },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'düşük hız — şehir içi',
    follow: CameraFollowState.FOLLOWING, over: { speedKmh: 25 },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'şehir hızı',
    follow: CameraFollowState.FOLLOWING, over: { speedKmh: 55 },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'otoyol hızı',
    follow: CameraFollowState.FOLLOWING, over: { speedKmh: 130 },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'sağlıklı GPS',
    follow: CameraFollowState.FOLLOWING, over: { motionState: 'TRACKING' },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'GPS bozuk — kamera SÜRÜLÜR ama zoom tavanlı',
    follow: CameraFollowState.FOLLOWING, over: { motionState: 'GPS_DEGRADED' },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'GPS bayat',
    follow: CameraFollowState.FOLLOWING, over: { motionState: 'STALE' },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'hareket durumu bilinmiyor',
    follow: CameraFollowState.FOLLOWING, over: { motionState: 'UNKNOWN' },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'manevra yaklaşıyor (yol-boyu)',
    follow: CameraFollowState.FOLLOWING,
    over: { nextManeuverM: 120, maneuverDistanceSource: 'ALONG_ROUTE' },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'manevra kaynağı GEÇERSİZ (kuş uçuşu)',
    follow: CameraFollowState.FOLLOWING,
    over: { nextManeuverM: 120, maneuverDistanceSource: 'STRAIGHT_LINE' },
    authorityAllows: true, projectionAllows: true, klass: 'AGREE' },
  { scenario: 'KULLANICI haritayı sürüklüyor',
    follow: CameraFollowState.USER_PANNING, over: { followState: 'USER_PANNING' },
    authorityAllows: false, projectionAllows: false, klass: 'AGREE' },
  { scenario: 'kullanıcı bıraktı — takip askıda (browse)',
    follow: CameraFollowState.FOLLOW_SUSPENDED, over: { followState: 'FOLLOW_SUSPENDED' },
    authorityAllows: false, projectionAllows: false, klass: 'AGREE' },
  { scenario: 'takip durumu BİLİNMİYOR — fail-closed',
    follow: CameraFollowState.UNKNOWN, over: { followState: 'UNKNOWN' },
    authorityAllows: false, projectionAllows: false, klass: 'AGREE' },
  /* ── TEK BİLİNÇLİ FARK ───────────────────────────────────────────────── */
  { scenario: 'ORTALAMA uygulanıyor — kamerayı ortalama işlemi sürer',
    follow: CameraFollowState.RECENTERING, over: { followState: 'RECENTERING' },
    /* `canDriveCamera()` HAYIR der: rutin fix uçuştaki ortalamayla YARIŞMAZ.
       Ham `cameraDriveAllowed` EVET der: sistem gerçekten kamerayı sürüyor.
       İzdüşüm (`routineFixMayDriveCamera`) AYNI soruyu sorar → HAYIR. */
    authorityAllows: false, projectionAllows: false, klass: 'INTENTIONAL_DIFFERENCE' },
];

describe('Kamera otorite paritesi · matris', () => {
  beforeEach(() => _resetCameraFollowForTest());

  it('MATRİS TAM: her takip durumu en az bir satırda temsil edilir', () => {
    const covered = new Set(PARITY.map((r) => r.follow));
    expect([...covered].sort()).toEqual(
      Object.values(CameraFollowState).slice().sort(),
    );
  });

  it('İZDÜŞÜM ile ÜRETİM OTORİTESİ her satırda AYNI hükmü verir', () => {
    for (const row of PARITY) {
      const p = policy(row.over);
      expect(routineFixMayDriveCamera(p), `${row.scenario}: izdüşüm sapmış`)
        .toBe(row.projectionAllows);
      /* Matriste beyan edilen otorite hükmü, otoritenin GERÇEK kuralıyla
         (`yalnız FOLLOWING`) tutarlı olmalı — beyan çürürse kilit düşer. */
      expect(row.authorityAllows, `${row.scenario}: otorite beyanı tutarsız`)
        .toBe(row.follow === CameraFollowState.FOLLOWING);
      /* Sınıflandırma dürüst: AGREE satırında ikisi AYNI olmalı. */
      if (row.klass === 'AGREE') {
        expect(row.projectionAllows, `${row.scenario}: AGREE ama farklı`)
          .toBe(row.authorityAllows);
      }
    }
  });

  it('BİLİNÇLİ FARK yalnız RECENTERING satırındadır (ve HAM alanda görünür)', () => {
    const diff = PARITY.filter((r) => r.klass === 'INTENTIONAL_DIFFERENCE');
    expect(diff.map((r) => r.follow)).toEqual([CameraFollowState.RECENTERING]);
    /* Farkın KAYNAĞI: ham alan EVET der, izdüşüm HAYIR — ikisi ayrı sorudur. */
    const p = policy({ followState: 'RECENTERING' });
    expect(p.cameraDriveAllowed, 'ham alan artık EVET demiyor — sözleşme kaydı bayat').toBe(true);
    expect(routineFixMayDriveCamera(p)).toBe(false);
  });

  it('ÜRETİM OTORİTESİ canlı davranışta matrisle uyumludur', () => {
    /* Gerçek otorite makinesi — beyan değil, ÇALIŞTIRILARAK doğrulanır. */
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
    expect(canDriveCamera()).toBe(true);

    notifyUserPanStart();
    expect(getCameraFollowState()).toBe(CameraFollowState.USER_PANNING);
    expect(canDriveCamera()).toBe(false);

    notifyUserPanEnd();
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOW_SUSPENDED);
    expect(canDriveCamera()).toBe(false);

    beginRecenter('USER_BUTTON');
    expect(getCameraFollowState()).toBe(CameraFollowState.RECENTERING);
    expect(canDriveCamera(), 'ortalama uçuşurken rutin fix kamerayı sürmemeli').toBe(false);

    completeRecenter();
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
    expect(canDriveCamera()).toBe(true);

    resetCameraFollow('NAV_END');
    expect(canDriveCamera()).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) SINIR KİLİTLERİ — ikinci otorite doğmasın
   ══════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const POLICY = 'platform/navigation/core/cameraPolicyModel.ts';
const AUTHORITY = 'platform/navigation/cameraFollowAuthority.ts';

describe('Kamera otorite paritesi · sınır kilitleri', () => {
  it('A1 — takip durumunun TEK üreticisi `cameraFollowAuthority`dir', () => {
    const hits = [AUTHORITY, POLICY, 'platform/map/MapInteractionManager.ts',
      'components/map/FullMapView.tsx', 'components/map/MiniMapWidget.tsx']
      .filter((f) => readSrc(f).includes('export function canDriveCamera'));
    expect(hits).toEqual([AUTHORITY]);
  });

  it('A2 — politika takip durumunu HESAPLAMAZ, GİRDİ olarak alır', () => {
    const src = strip(readSrc(POLICY));
    /* Girdi alanı var… */
    expect(src).toContain('followState');
    /* …ama otoriteyi kendisi OKUMAZ (import yok → bağımsız hesap yok). */
    expect(src, 'politika kanonik otoriteyi doğrudan okuyor')
      .not.toContain('cameraFollowAuthority');
    expect(src, 'politika kendi pan/interaction kararını üretiyor')
      .not.toContain('notifyUserPan');
  });

  it('A3 — üretim kapısı `canDriveCamera`dır; `cameraDriveAllowed` ÜRETİMDE tüketilmez', () => {
    for (const f of ['components/map/FullMapView.tsx', 'components/map/MiniMapWidget.tsx',
      'platform/map/MapInteractionManager.ts']) {
      expect(strip(readSrc(f)), `${f} gölge alanını üretimde tüketiyor`)
        .not.toContain('cameraDriveAllowed');
    }
    /* Kilit kör değil: üretim kapısı GERÇEKTEN kullanılıyor. */
    expect(strip(readSrc('components/map/FullMapView.tsx'))).toContain('canDriveCamera()');
    expect(strip(readSrc('components/map/MiniMapWidget.tsx'))).toContain('canDriveCamera()');
  });

  it('A4 — aynı izin İKİ bağımsız if-zinciriyle hesaplanmaz', () => {
    const authority = strip(readSrc(AUTHORITY));
    /* Otorite yalnız KENDİ durumuna bakar; GPS/hız/navigasyon kuralı KURMAZ. */
    for (const foreign of ['accuracy', 'speedKmh', 'GPS_DEGRADED', 'nextManeuver']) {
      expect(authority, `otorite yabancı kural içeriyor: ${foreign}`)
        .not.toContain(foreign);
    }
  });

  it('A5 — gölge karşılaştırması KARŞILAŞTIRILABİLİR izdüşümü kullanır', () => {
    const src = strip(readSrc('platform/navigation/core/cameraShadowModel.ts'));
    expect(src).toContain('routineFixMayDriveCamera(policy)');
    expect(src, 'gölge hâlâ ham alanla kıyaslıyor — RECENTERING sahte ayrışma üretir')
      .not.toContain('legacy.applied !== policy.cameraDriveAllowed');
  });

  it('A6 — gölge/LAB üretim kamerasını SÜREMEZ', () => {
    const shadow = strip(readSrc('platform/navigation/cameraShadowRuntime.ts'));
    for (const bad of ['easeTo(', 'jumpTo(', 'flyTo(', 'setDrivingView(']) {
      expect(shadow, `gölge kamerayı sürüyor: ${bad}`).not.toContain(bad);
    }
  });

  it('A7 — YENİ kamera FSM / zamanlayıcı / GPS aboneliği YOK', () => {
    const src = strip(readSrc(POLICY));
    for (const bad of ['setInterval(', 'setTimeout(', 'requestAnimationFrame(',
      'watchPosition(', 'navigator.geolocation', 'Date.now(', 'performance.now(']) {
      expect(src, `politika modeli SAF değil: ${bad}`).not.toContain(bad);
    }
  });

  it('A8 — Faz 1/Faz 2 kazanımları korunuyor', () => {
    const mim = strip(readSrc('platform/map/MapInteractionManager.ts'));
    /* Faz 1: manevra kaynağı kapısı. */
    expect(mim).toContain('resolveManeuverBand(');
    expect(mim).toContain('_gatedTurnM');
    /* Faz 2: GPS bozukken zoom tavanı. */
    expect(mim).toContain('resolveMaxZoomHint(');
    expect(mim).toContain('Math.min(_zoom, _maxZoom)');
  });

  it('A9 — CEH hâlâ SHADOW (kapsam dışı otorite değişmedi)', () => {
    expect(readSrc('platform/navigation/shadow/cehCutoverGate.ts'))
      .toContain('CEH_CUTOVER_DEFAULT_OPEN: boolean = false');
  });
});
