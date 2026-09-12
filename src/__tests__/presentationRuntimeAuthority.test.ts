/**
 * presentationRuntimeAuthority.test.ts — F0-B8 · SUNUM RUNTIME OTORİTE KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU FAZIN SORUSU ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * *"React/harita görünümleri kendi navigation runtime'ını mı çalıştırıyor?"*
 *
 * Amaç timer SAYISINI sıfırlamak DEĞİLDİR — `requestAnimationFrame` render ve
 * interpolasyon için MEŞRUDUR. Sıfır olması gereken şey **semantik otorite
 * sızıntısıdır**: görünüm navigation truth, tazelik, takip izni veya kamera
 * politikası ÜRETMEMELİDİR.
 *
 * ── BULUNAN VE KAPATILAN SIZINTI ──────────────────────────────────────────
 * `FullMapView`in rAF watchdog'u kameranın takıldığını ölçüp **takip iznini
 * kendisi veriyordu** (`beginRecenter` + `completeRecenter`) — `UNKNOWN`
 * durumundan `FOLLOWING` üretmek dâhil, yani otoritenin fail-closed hükmünü
 * görünüm bozuyordu. Karar `cameraFollowAuthority.noteCameraStalled()`e
 * BİREBİR taşındı; görünüm artık yalnız GÖZLEM bildirir.
 *
 * ── BİLİNÇLİ OLARAK GÖRÜNÜMDE KALAN ───────────────────────────────────────
 * · marker interpolasyonu + kamera çizimi (rAF) → PURE_VISUAL
 * · harita yüzeyi ömrü (WebGL zombi iyileştirme · hazır gözcüsü · resize) →
 *   görünüm MapLibre örneğinin SAHİBİDİR, sağlığı da onundur
 * · geçici UI zamanlayıcıları (kontrol otomatik gizleme) → PURE_VISUAL
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CameraFollowState, CAMERA_STALL_RECOVERY_MS,
  canDriveCamera, getCameraFollowState, noteCameraStalled,
  notifyUserPanStart, notifyUserPanEnd, beginRecenter,
  _resetCameraFollowForTest,
} from '../platform/navigation/cameraFollowAuthority';

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const FULL = 'components/map/FullMapView.tsx';
const MINI = 'components/map/MiniMapWidget.tsx';
const AUTHORITY = 'platform/navigation/cameraFollowAuthority.ts';

/* ══════════════════════════════════════════════════════════════════════════
   1) TAKILI KAMERA KURTARMASI — KARAR OTORİTEDE (davranış birebir korundu)
   ══════════════════════════════════════════════════════════════════════════ */

describe('F0-B8 · takılı kamera kurtarması', () => {
  beforeEach(() => _resetCameraFollowForTest());

  it('kullanıcı ŞU AN sürüklüyorsa kamera ASLA geri alınmaz', () => {
    notifyUserPanStart();
    expect(getCameraFollowState()).toBe(CameraFollowState.USER_PANNING);
    expect(noteCameraStalled(), 'pan sırasında kurtarma uygulandı').toBe(false);
    expect(getCameraFollowState()).toBe(CameraFollowState.USER_PANNING);
  });

  it('zaten takip ediliyorsa yapılacak iş YOKTUR (gereksiz durum yazımı yok)', () => {
    expect(canDriveCamera()).toBe(true);
    expect(noteCameraStalled()).toBe(false);
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
  });

  it('takip ASKIDA takılı kaldıysa takibe dönülür', () => {
    notifyUserPanStart();
    notifyUserPanEnd();                      // geri çağrı YOK → otomatik dönüş kurulmaz
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOW_SUSPENDED);
    expect(noteCameraStalled()).toBe(true);
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
  });

  it('ORTALAMA yarıda kalmışsa (RECENTERING takılı) takibe dönülür', () => {
    beginRecenter('USER_BUTTON');            // `completeRecenter` HİÇ gelmedi
    expect(getCameraFollowState()).toBe(CameraFollowState.RECENTERING);
    expect(noteCameraStalled()).toBe(true);
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
  });

  it('eşik KANONİKTİR ve görünüm kendi sayısını yazmaz', () => {
    expect(CAMERA_STALL_RECOVERY_MS).toBe(8_000);
    const view = strip(readSrc(FULL));
    expect(view).toContain('CAMERA_STALL_RECOVERY_MS');
    expect(view, 'görünüm hâlâ kendi 8 sn sabitini taşıyor')
      .not.toMatch(/lastCameraUpdate\s*>\s*8_?000/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) OTORİTE SIZINTISI YASAĞI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F0-B8 · görünüm otorite üretmez', () => {
  it('B1 — görünüm takip İZNİ ÜRETMEZ (durum yazan API çağırmaz)', () => {
    const view = strip(readSrc(FULL));
    /* `requestFollow` kullanıcı NİYETİDİR (düğme/ortala) — meşru. Yasak olan,
       rAF/zaman aşımı ölçümünden izin üretmektir; o yol artık `noteCameraStalled`
       üzerinden otoriteye gider. */
    expect(view).toContain('noteCameraStalled()');
    expect(view, 'watchdog hâlâ doğrudan durum yazıyor')
      .not.toMatch(/lastCameraUpdate[\s\S]{0,400}beginRecenter\(/);
  });

  it('B2 — görünüm takip DURUMUNU okuyup karar vermez', () => {
    const view = strip(readSrc(FULL));
    expect(view, 'görünüm takip durumunu okuyup dallanıyor')
      .not.toContain('getCameraFollowState(');
    expect(view, 'görünüm takip durum sabitlerini karşılaştırıyor')
      .not.toContain('CameraFollowState.');
  });

  it('B3 — görünümler kamera POLİTİKASI hesaplamaz', () => {
    for (const f of [FULL, MINI]) {
      const src = strip(readSrc(f));
      for (const bad of ['decideCameraPolicy', 'resolveSpeedBand', 'resolveManeuverBand',
        'resolveMaxZoomHint', 'resolveTopPadForAnchor', 'cameraDriveAllowed']) {
        expect(src, `${f} kamera politikası üretiyor: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('B4 — görünümler navigation truth ÜRETMEZ', () => {
    for (const f of [FULL, MINI]) {
      const src = strip(readSrc(f));
      for (const bad of ['stepOffRoute(', 'matchToRoute(', 'buildHorizon(',
        'pickBestRoute(', 'resolveDeclutter(', 'validateRoute(']) {
        expect(src, `${f} navigation truth üretiyor: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('B5 — görünümler İKİNCİ GPS aboneliği açmaz', () => {
    for (const f of [FULL, MINI]) {
      const src = strip(readSrc(f));
      expect(src, `${f} doğrudan konum aboneliği açıyor`).not.toContain('watchPosition(');
      expect(src, `${f} doğrudan geolocation okuyor`).not.toContain('navigator.geolocation');
    }
  });

  it('B6 — görünümler kendi tazelik EŞİĞİNİ tanımlamaz (tek otorite #529)', () => {
    for (const f of [FULL, MINI]) {
      const src = strip(readSrc(f));
      /* Yerel `const X_STALE_MS = 5000` gibi ikinci eşik YASAK. */
      expect(src, `${f} kendi bayatlık eşiğini tanımlıyor`)
        .not.toMatch(/const\s+\w*STALE\w*_MS\s*=/);
    }
    /* Kilit kör değil: `FullMapView` kanonik eşiği GERÇEKTEN kullanıyor. */
    expect(strip(readSrc(FULL))).toContain('LOCATION_STALE_MS');
  });

  it('B7 — otorite kendi başına ZAMANLAYICI FIRTINASI kurmaz (tek auto timer)', () => {
    const src = strip(readSrc(AUTHORITY));
    /* Tek `setTimeout` (otomatik dönüş) — ikinci lifecycle FSM yok. */
    expect((src.match(/setTimeout\(/g) ?? []).length).toBe(1);
    expect(src).toContain('_clearAutoTimer');
    expect(src, 'otorite rAF döngüsü kuruyor').not.toContain('requestAnimationFrame');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) PURE_VISUAL rAF SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F0-B8 · rAF yalnız render', () => {
  it('C1 — rAF döngüsü navigation ilerlemesi BESLEMEZ (tünel dersi korunuyor)', () => {
    const view = strip(readSrc(FULL));
    /* `navigationSessionRuntime`in 1 Hz beslemesi devraldı; görünüm YALNIZ çizer. */
    for (const bad of ['updateRouteProgress(', 'feedDeadReckoning(', 'advanceRouteStep(']) {
      expect(view, `rAF döngüsü ilerleme besliyor: ${bad}`).not.toContain(bad);
    }
  });

  it('C2 — mini harita rAF DONGUSU yalniz cizim yapar', () => {
    /* Kapsam DONGUNUN KENDISIDIR — dosyanin tamami degil. Mini harita kamerayi
       GPS yolunda ayrica surer (`setDrivingView`, kanonik yurutme yolu) ve bu
       mesrudur; yasak olan, rAF cizim dongusunun navigation isi yapmasidir. */
    const src = readSrc(MINI);
    const s0 = src.indexOf('const draw = (now: number) => {');
    const s1 = src.indexOf('return () => { if (rafId) cancelAnimationFrame(rafId); };', s0);
    expect(s0, 'mini rAF cizim dongusu bulunamadi — kilit bayat').toBeGreaterThan(0);
    expect(s1).toBeGreaterThan(s0);
    const loop = strip(src.slice(s0, s1));
    for (const bad of ['setDrivingView(', 'updateRouteProgress(', 'beginRecenter(',
      'completeRecenter(', 'notifyUserPan']) {
      expect(loop, `mini rAF dongusu navigation isi yapiyor: ${bad}`).not.toContain(bad);
    }
    /* Kilit kor degil: dongu GERCEKTEN cizim yapiyor. */
    expect(loop).toContain('updateUserMarker(');
  });

  it('C3 — YENİ zamanlayıcı/scheduler servisi EKLENMEDİ', () => {
    for (const f of [FULL, MINI, AUTHORITY]) {
      const src = strip(readSrc(f));
      for (const bad of ['new IntervalService', 'TimerManager', 'AnimationScheduler',
        'createScheduler(']) {
        expect(src, `${f} yeni scheduler kuruyor: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('C4 — her rAF/timer TEMİZLENİR (Zero-Leak · unmount)', () => {
    for (const f of [FULL, MINI]) {
      const src = readSrc(f);
      const raf = (src.match(/requestAnimationFrame\(/g) ?? []).length;
      const cancel = (src.match(/cancelAnimationFrame\(/g) ?? []).length;
      expect(cancel, `${f}: rAF ${raf} kurulmuş ama iptal yolu yok`).toBeGreaterThan(0);
      const set = (src.match(/set(Timeout|Interval)\(/g) ?? []).length;
      const clear = (src.match(/clear(Timeout|Interval)\(/g) ?? []).length;
      expect(clear, `${f}: ${set} zamanlayıcıya karşılık ${clear} temizleme`)
        .toBeGreaterThanOrEqual(Math.ceil(set / 2));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ÖNCEKİ FAZLARIN KAZANIMLARI KORUNUYOR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F0-B8 · üst otoriteler değişmedi', () => {
  it('D1 — Faz 1 manevra kaynağı kapısı + Faz 2 zoom tavanı yerinde', () => {
    const mim = strip(readSrc('platform/map/MapInteractionManager.ts'));
    expect(mim).toContain('resolveManeuverBand(');
    expect(mim).toContain('_gatedTurnM');
    expect(mim).toContain('resolveMaxZoomHint(');
    expect(mim).toContain('Math.min(_zoom, _maxZoom)');
  });

  it('D2 — `cameraFollowAuthority` kanonik üretim otoritesi olarak KALDI', () => {
    const hits = [AUTHORITY, FULL, MINI, 'platform/map/MapInteractionManager.ts']
      .filter((f) => readSrc(f).includes('export function canDriveCamera'));
    expect(hits).toEqual([AUTHORITY]);
    /* Görünümler onu TÜKETİR (kör kilit değil). */
    expect(strip(readSrc(FULL))).toContain('canDriveCamera()');
    expect(strip(readSrc(MINI))).toContain('canDriveCamera()');
  });

  it('D3 — kamera politikası sınırı korunuyor (izdüşüm gölgede kalır)', () => {
    const shadow = strip(readSrc('platform/navigation/core/cameraShadowModel.ts'));
    expect(shadow).toContain('routineFixMayDriveCamera(policy)');
  });

  it('D4 — CEH hâlâ SHADOW', () => {
    expect(readSrc('platform/navigation/shadow/cehCutoverGate.ts'))
      .toContain('CEH_CUTOVER_DEFAULT_OPEN: boolean = false');
  });
});
