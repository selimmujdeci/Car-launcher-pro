/**
 * audioService.ts — Crystal Cabin DSP Engine v3 + SVC + AGC + 3D Spatializer
 *
 * Signal chain:
 *   connectSource(node)
 *     → eq[0] → … → eq[9]
 *     → compressor (AGC — DynamicsCompressorNode)
 *     → channelSplitter[L,R]
 *         L ──────────────────────────→ channelMerger[L]
 *         R → haasDelay (0–20ms) ──────→ channelMerger[R]
 *     → panner (StereoPannerNode, Driver Focus)
 *     → masterGain → ctx.destination
 *                 └──→ analyser (opt-in)
 *
 * SVC (Speed Volume Compensation):
 *   < 40 km/h  : etki yok
 *   40–120 km/h: lineer dB rampı 0 → +6 dB
 *   > 120 km/h : sabit +6 dB (~2× kazanç)
 *   Hysteresis : ±3 km/h Schmidt trigger — anlık dalgalanmaları filtreler
 *   Native     : STREAM_MUSIC Android sistem sesi de senkronize edilir
 *
 * Audio Ducking (ISO 22262 uyumlu):
 *   TTS/navigasyon sırasında müziği %30 seviyeye indirir.
 *   Referans sayacı (_duckCount): çakışan duck çağrıları düzgün işlenir.
 *
 * Zero-Leak:
 *   destroy() → _unsubSpeed iptal → AudioNode bağlantıları kes → ctx.close()
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';

/* ── Tipler ──────────────────────────────────────────────────────────────── */

export type AudioProfile = 'flat' | 'cinema' | 'speech' | 'dynamic' | 'classic';

export interface PresetInfo {
  id:    AudioProfile;
  label: string;
  bands: readonly [number, number, number, number, number, number, number, number, number, number];
}

/* ── EQ sabitleri ────────────────────────────────────────────────────────── */

const BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16_000] as const;
const BAND_Q     = 1.41;

/* ── Gain ramp sabitleri ─────────────────────────────────────────────────── */

const GAIN_CLICK_RAMP_S = 0.05;
const SVC_RAMP_S        = 1.5;
/** Duck geçişi: 0.10 s — <20ms hardware buffer ile algılanabilir örtüşme sıfır */
const DUCK_RAMP_S       = 0.10;
/** Unduck geçişi: 0.40 s — TTS bitti, müziği yumuşakça geri getir */
const UNDUCK_RAMP_S     = 0.40;
/** ISO 22262: TTS sırasında müzik %30 seviyeye iner */
const DUCK_LEVEL        = 0.30;

/* ── SVC algoritma sabitleri ─────────────────────────────────────────────── */

/** Bu hızın altında SVC devreye girmez */
const SVC_SPEED_LOW_KMH  = 40;
/** Bu hızın üstünde maksimum boost uygulanır */
const SVC_SPEED_HIGH_KMH = 120;
/** Maksimum kazanç artışı — +6 dB = 10^(6/20) ≈ ×2.0 */
const SVC_MAX_DB         = 6;
/**
 * Schmidt trigger eşiği — küçük hız dalgalanmalarını filtreler.
 * Yalnızca |Δhız| ≥ 3 km/h ise SVC yeniden hesaplanır.
 */
const SVC_HYSTERESIS_KMH = 3;

/* ── Persistence anahtarları ─────────────────────────────────────────────── */

const EQ_PERSIST_KEY    = 'audio-eq-bands';
const SVC_PERSIST_KEY   = 'audio-svc-enabled';
const AGC_PERSIST_KEY   = 'audio-agc-enabled';
const FOCUS_PERSIST_KEY = 'audio-driver-focus';

/* ── Preset tablosu ──────────────────────────────────────────────────────── */
//    Frekanslar:  31   62  125  250  500  1k   2k   4k   8k  16k

export const PRESETS: readonly PresetInfo[] = [
  { id: 'flat',    label: 'Düz',     bands: [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0] },
  { id: 'cinema',  label: 'Sinema',  bands: [ +4, +3, +2, -1, -2, -1, +1, +3, +4, +3] },
  { id: 'speech',  label: 'Konuşma', bands: [ -4, -3, -2,  0, +2, +5, +5, +4, +2, -1] },
  { id: 'dynamic', label: 'Dinamik', bands: [ +6, +5, +3, +1,  0, -1,  0, +1, +2, +3] },
  { id: 'classic', label: 'Klasik',  bands: [ +3, +2, +2, +1,  0, -1, -1,  0, +1, +2] },
];

/* ── Modül state ─────────────────────────────────────────────────────────── */

let _ctx:        AudioContext | null          = null;
let _eqNodes:    BiquadFilterNode[]          = [];
let _gainNode:   GainNode | null             = null;
let _analyser:   AnalyserNode | null         = null;
let _profile:    AudioProfile                = 'flat';
let _volume      = 1.0;

// AGC — DynamicsCompressorNode
let _compressor: DynamicsCompressorNode | null = null;
let _agcEnabled  = true;

// 3D Spatializer — Driver Focus (Haas Effect)
let _panner:    StereoPannerNode | null    = null;
let _splitter:  ChannelSplitterNode | null = null;
let _merger:    ChannelMergerNode | null   = null;
let _haasDelay: DelayNode | null           = null;
let _driverFocusEnabled = false;

// Termal koruma bayrağı — thermal lock aktifken AGC gevşetilir
let _thermalLow = false;

let _eqBands: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// SVC state
let _svcEnabled         = true;
let _svcSpeedKmh        = 0;
/** Son SVC uygulamasındaki hız — Schmidt trigger referansı */
let _svcLastAppliedKmh  = 0;

// Native sistem sesi entegrasyonu
/** Kullanıcının seçtiği baz sistem ses yüzdesi (0–100); null = henüz ayarlanmadı */
let _baseSystemVolumePct: number | null = null;

// Zero-Leak: hız aboneliği cleanup thunk
let _unsubSpeed: (() => void) | null = null;

// Audio Ducking referans sayacı
// Birden fazla TTS/uyarı aynı anda isteyebilir; sayaç sıfıra inince unduck yapılır
let _isDucked  = false;
let _duckCount = 0;

/* ── AudioContext fabrikası ──────────────────────────────────────────────── */

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function _resolveAC(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (typeof AudioContext !== 'undefined') return AudioContext;
  return (window as WindowWithWebkit).webkitAudioContext ?? null;
}

/* ── Persistence yardımcıları ────────────────────────────────────────────── */

function _saveEqBands(): void {
  safeSetRaw(EQ_PERSIST_KEY, JSON.stringify(_eqBands));
}

/** Kalıcı durum bir kez yüklenir — getter'lar AudioContext başlatmadan da doğru değeri görür. */
let _persistLoaded = false;

function _loadPersistedState(): void {
  if (_persistLoaded) return;
  _persistLoaded = true;

  const eqRaw = safeGetRaw(EQ_PERSIST_KEY);
  if (eqRaw) {
    try {
      const parsed = JSON.parse(eqRaw) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length === 10 &&
        (parsed as unknown[]).every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        _eqBands = parsed as number[];
      }
    } catch { /* bozuk JSON — varsayılan (flat) korunur */ }
  }

  const svcRaw   = safeGetRaw(SVC_PERSIST_KEY);
  if (svcRaw !== null) _svcEnabled = svcRaw !== 'false';

  const agcRaw   = safeGetRaw(AGC_PERSIST_KEY);
  if (agcRaw !== null) _agcEnabled = agcRaw !== 'false';

  const focusRaw = safeGetRaw(FOCUS_PERSIST_KEY);
  if (focusRaw !== null) _driverFocusEnabled = focusRaw === 'true';
}

/* ── SVC hesaplama ve uygulama ───────────────────────────────────────────── */

/**
 * Hıza göre SVC kazanç çarpanını döndürür (linear).
 *
 *   40 km/h  → +0.0 dB → ×1.00
 *   80 km/h  → +3.0 dB → ×1.41 (√2)
 *  120 km/h  → +6.0 dB → ×1.995 (~2×)
 */
function _computeSvcMultiplier(speedKmh: number): number {
  if (!_svcEnabled) return 1.0;
  if (speedKmh <= SVC_SPEED_LOW_KMH) return 1.0;

  const t  = Math.min(1.0, (speedKmh - SVC_SPEED_LOW_KMH) / (SVC_SPEED_HIGH_KMH - SVC_SPEED_LOW_KMH));
  const dB = t * SVC_MAX_DB;
  return Math.pow(10, dB / 20);  // dB → linear amplitude
}

/**
 * Web Audio master gain'i SVC + base volume ile hedef değere taşır.
 * Duck aktifken çağrı görmezden gelinir — unduck sonrası gain kendi güncelleşir.
 */
function _applySvcGain(rampS = SVC_RAMP_S): void {
  if (_isDucked) return;
  if (!_gainNode || !_ctx || _ctx.state === 'closed') return;

  const svcMul = _computeSvcMultiplier(_svcSpeedKmh);
  const target = Math.max(0.0001, _volume * svcMul);
  const now    = _ctx.currentTime;

  _gainNode.gain.cancelScheduledValues(now);
  _gainNode.gain.setValueAtTime(Math.max(0.0001, _gainNode.gain.value), now);
  _gainNode.gain.exponentialRampToValueAtTime(target, now + rampS);
}

/**
 * Android STREAM_MUSIC (0–15 adım) ses düzeyini SVC ile senkronize eder.
 * Yalnızca native platform + SVC aktif + baz ses ayarlandığında çalışır.
 * Duck aktifken sessizce ertelenir; unduck sonrası tekrar çağrılır.
 */
function _applySvcSystemVolume(): void {
  if (!Capacitor.isNativePlatform()) return;
  if (!_svcEnabled || _isDucked) return;
  if (_baseSystemVolumePct === null) return;

  const mul       = _computeSvcMultiplier(_svcSpeedKmh);
  const pct       = Math.min(100, Math.round(_baseSystemVolumePct * mul));
  const streamIdx = Math.round((pct / 100) * 15);  // 0–15 STREAM_MUSIC index

  CarLauncher.setVolume({ value: streamIdx }).catch(() => {/* non-fatal */});
}

/* ── Audio Ducking ───────────────────────────────────────────────────────── */

/**
 * Navigasyon anonsu / sistem uyarısı başladığında müziği %30 seviyeye indirir.
 *
 * Referans sayacı: birden fazla TTS kaynağı aynı anda duck isteyebilir.
 * Kazanç yalnızca ilk duck çağrısında değişir; sayaç negatife düşmez.
 */
export function duckMedia(): void {
  _duckCount++;
  if (_duckCount > 1) return;  // zaten duck'landı
  _isDucked = true;

  if (!_gainNode || !_ctx || _ctx.state === 'closed') return;

  // Suspended context'te gain rampi işlemez — önce resume et
  if (_ctx.state === 'suspended') void _ctx.resume();

  const svcMul = _computeSvcMultiplier(_svcSpeedKmh);
  // Exponential ramp sıfıra/sıfırdan gidemez — 0.0001 floor zorunlu
  const target = Math.max(0.0001, _volume * svcMul * DUCK_LEVEL);
  const now    = _ctx.currentTime;

  _gainNode.gain.cancelScheduledValues(now);
  _gainNode.gain.setValueAtTime(Math.max(0.0001, _gainNode.gain.value), now);
  _gainNode.gain.exponentialRampToValueAtTime(target, now + DUCK_RAMP_S);
}

/**
 * Navigasyon anonsu / sistem uyarısı bitti — müziği geri aç.
 *
 * Sayaç sıfıra inince unduck yapılır; önceki her duck için bir unduck gerekir.
 * Çift unduck çağrısı güvenli (guard: sayaç 0'ın altına düşmez).
 * SVC çarpanı unduck anındaki güncel hıza göre hesaplanır.
 */
export function unduckMedia(): void {
  if (_duckCount === 0) return;
  _duckCount = Math.max(0, _duckCount - 1);
  if (_duckCount > 0) return;

  _isDucked = false;

  if (!_gainNode || !_ctx || _ctx.state === 'closed') return;

  const svcMul = _computeSvcMultiplier(_svcSpeedKmh);
  // Exponential ramp sıfıra/sıfırdan gidemez — 0.0001 floor zorunlu
  const target = Math.max(0.0001, _volume * svcMul);
  const now    = _ctx.currentTime;

  _gainNode.gain.cancelScheduledValues(now);
  _gainNode.gain.setValueAtTime(Math.max(0.0001, _gainNode.gain.value), now);
  _gainNode.gain.exponentialRampToValueAtTime(target, now + UNDUCK_RAMP_S);
  // Sayaç uyuşmazlığında bile final gain kesin olarak doğru değere sabitlenir.
  // Float precision drift'ini ve yarım kalan ramp'ları engeller.
  _gainNode.gain.setValueAtTime(target, now + UNDUCK_RAMP_S + 0.001);

  // Duck süresince hız değişmiş olabilir — sistem sesini güncelle
  _applySvcSystemVolume();
}

/* ── Hız aboneliği (dynamic import — döngüsel bağımlılık önlemi) ─────────── */

/**
 * Zustand store'a abone olur; Schmidt trigger ile her hız güncellemesinde
 * Web Audio gain ve Android sistem sesini günceller.
 * İlk initAudio() çağrısında başlatılır; destroy()+HMR dispose'da iptal edilir.
 */
function _startSpeedSubscription(): void {
  if (_unsubSpeed) return;

  void import('./vehicleDataLayer/UnifiedVehicleStore')
    .then(({ useUnifiedVehicleStore: useVehicleStore }) => {
      if (_unsubSpeed) return;
      _unsubSpeed = useVehicleStore.subscribe((state) => {
        const kmh = state.speed;
        if (kmh == null) return;

        // Schmidt trigger: ±3 km/h bant içini yoksay
        if (Math.abs(kmh - _svcLastAppliedKmh) < SVC_HYSTERESIS_KMH) return;

        _svcSpeedKmh       = kmh;
        _svcLastAppliedKmh = kmh;

        if (_svcEnabled && _gainNode) {
          _applySvcGain();
          _applySvcSystemVolume();
        }
      });
    })
    .catch(() => {/* notifySpeed() yedek yol olarak çalışır */});
}

/* ── DSP zincir kurulumu ─────────────────────────────────────────────────── */

function _buildChain(ctx: AudioContext): void {
  // ── 1. EQ bant dizisi ──────────────────────────────────────────────────────
  _eqNodes = (BAND_FREQS as readonly number[]).map((freq, i) => {
    const node = ctx.createBiquadFilter();
    if (i === 0)                          node.type = 'lowshelf';
    else if (i === BAND_FREQS.length - 1) node.type = 'highshelf';
    else { node.type = 'peaking'; node.Q.value = BAND_Q; }
    node.frequency.value = freq;
    node.gain.value      = 0;
    return node;
  });
  for (let i = 0; i < _eqNodes.length - 1; i++) _eqNodes[i].connect(_eqNodes[i + 1]);

  // ── 2. AGC — DynamicsCompressorNode ───────────────────────────────────────
  // Leveling mode: threshold -24dB, knee 30, ratio 3:1
  // Farklı kaynakları (YouTube, Spotify) sürücüye hissettirmeden eşitler.
  _compressor = ctx.createDynamicsCompressor();
  _compressor.threshold.value = _agcEnabled ? -24 : 0;   // 0 = etkin sıkıştırma yok
  _compressor.knee.value      = 30;
  _compressor.ratio.value     = _agcEnabled ? 3 : 1;     // 1:1 = bypass
  _compressor.attack.value    = 0.003;
  _compressor.release.value   = 0.25;
  _eqNodes[_eqNodes.length - 1].connect(_compressor);

  // ── 3. Haas Effect — ChannelSplitter → DelayNode(R) → ChannelMerger ───────
  // Sol kanal (sürücü) gecikme yok; sağ kanala 15ms gecikme → ses sürücü önünde odaklanır.
  _splitter  = ctx.createChannelSplitter(2);
  _merger    = ctx.createChannelMerger(2);
  _haasDelay = ctx.createDelay(0.1);   // max 100ms buffer
  _haasDelay.delayTime.value = _driverFocusEnabled ? 0.015 : 0; // 15ms Haas / bypass

  _compressor.connect(_splitter);
  _splitter.connect(_merger, 0, 0);        // L → merger[0]
  _splitter.connect(_haasDelay, 1);        // R → delay
  _haasDelay.connect(_merger, 0, 1);       // delay → merger[1]

  // ── 4. StereoPanner — Driver Focus kaydırması ──────────────────────────────
  _panner = ctx.createStereoPanner();
  _panner.pan.value = _driverFocusEnabled ? -0.2 : 0; // -0.2 = hafif sol (direksiyon tarafı)
  _merger.connect(_panner);

  // ── 5. Master Gain ─────────────────────────────────────────────────────────
  _gainNode = ctx.createGain();
  _gainNode.gain.value = Math.max(0.0001, _volume);
  _panner.connect(_gainNode);
  _gainNode.connect(ctx.destination);

  _writeEQ(_eqBands);
}

/** AGC compressor parametrelerini mevcut moda göre uygula (smooth ramp). */
function _applyAGCParams(): void {
  if (!_compressor || !_ctx || _ctx.state === 'closed') return;
  const now = _ctx.currentTime;
  const RAMP = 0.1; // 100ms smooth geçiş — çatlama önleme

  if (_agcEnabled && !_thermalLow) {
    // Normal leveling mode
    _compressor.threshold.exponentialRampToValueAtTime(-24 + 0.001, now + RAMP);
    _compressor.ratio.exponentialRampToValueAtTime(3, now + RAMP);
  } else if (_agcEnabled && _thermalLow) {
    // Termal koruma: AGC gevşetilir (ratio düşer, threshold yükselir → daha az işlem)
    _compressor.threshold.exponentialRampToValueAtTime(-12 + 0.001, now + RAMP);
    _compressor.ratio.exponentialRampToValueAtTime(1.5, now + RAMP);
  } else {
    // AGC kapalı — 1:1 oranı = bypass efekti
    _compressor.ratio.exponentialRampToValueAtTime(1, now + RAMP);
  }
}

function _writeEQ(bands: readonly number[]): void {
  _eqNodes.forEach((node, i) => { node.gain.value = bands[i] ?? 0; });
}

function _getOrInit(): AudioContext | null {
  if (_ctx && _ctx.state !== 'closed') return _ctx;

  _loadPersistedState();

  const AC = _resolveAC();
  if (!AC) return null;

  try {
    // 'interactive' → minimum hardware buffer (≤20ms) — gain değişimleri anlık hissedilir.
    // 'playback' geniş buffer kullanır ve duck rampi kulağa geç gelirdi.
    _ctx = new AC({ latencyHint: 'interactive' });
  } catch {
    return null;
  }

  _buildChain(_ctx);
  _startSpeedSubscription();
  return _ctx;
}

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════════════════ */

/**
 * DSP motorunu başlatır ve AudioContext'i döner.
 * Autoplay Policy nedeniyle ilk kullanıcı etkileşimi sonrasında çağrılmalı.
 */
export function initAudio(): AudioContext | null {
  return _getOrInit();
}

export async function resumeAudio(): Promise<void> {
  if (_ctx?.state === 'suspended') await _ctx.resume();
}

/**
 * Bir ses kaynağını DSP zincirine bağlar.
 * @returns Bağlantıyı kesen thunk — kaynak unmount olduğunda çağrılmalı (Zero-Leak).
 */
export function connectSource(source: AudioNode): () => void {
  const ctx = _getOrInit();
  if (!ctx || _eqNodes.length === 0) return () => {/* DSP yok */};

  source.connect(_eqNodes[0]);
  return () => { try { source.disconnect(_eqNodes[0]); } catch {/* zaten kesilmiş */} };
}

export function setPreset(profile: AudioProfile): void {
  _profile  = profile;
  const preset = PRESETS.find(p => p.id === profile) ?? PRESETS[0];
  _eqBands  = [...preset.bands];

  if (_ctx && _ctx.state !== 'closed' && _eqNodes.length > 0) _writeEQ(_eqBands);
  _saveEqBands();

  if (profile === 'flat') {
    document.documentElement.style.removeProperty('--audio-profile');
  } else {
    document.documentElement.style.setProperty('--audio-profile', profile);
  }
}

export function getPreset(): AudioProfile   { return _profile; }
export function getPresets(): readonly PresetInfo[] { return PRESETS; }

export function setEqBand(index: number, db: number): void {
  if (index < 0 || index >= 10 || !Number.isFinite(db)) return;
  _eqBands[index] = Math.max(-12, Math.min(12, db));
  if (_eqNodes[index] && _ctx && _ctx.state !== 'closed') {
    _eqNodes[index].gain.value = _eqBands[index];
  }
  _saveEqBands();
}

export function getEqBands(): readonly number[] { return _eqBands; }

/**
 * DSP master gain (0–100 %).
 * exponentialRamp: slider hızlı sürüklenirken ses patlaması olmaz.
 */
export function setDSPVolume(percent: number): void {
  _volume = Math.max(0, Math.min(100, percent)) / 100;
  _applySvcGain(GAIN_CLICK_RAMP_S);
}

export function getDSPVolume(): number { return Math.round(_volume * 100); }

export function setSvcEnabled(enabled: boolean): void {
  _svcEnabled = enabled;
  safeSetRaw(SVC_PERSIST_KEY, String(enabled));
  // SVC kapatılınca _svcLastAppliedKmh sıfırla — tekrar açılınca hemen hesaplansın
  if (!enabled) _svcLastAppliedKmh = -SVC_HYSTERESIS_KMH * 2;
  _applySvcGain(SVC_RAMP_S);
  _applySvcSystemVolume();
}

export function getSvcEnabled(): boolean { _loadPersistedState(); return _svcEnabled; }

/**
 * Native platform için SVC baz sistem sesini ayarlar (0–100).
 * Bu değer kullanıcının Settings'te seçtiği seviye olmalıdır.
 * SVC bu değer üzerine hıza göre boost uygular; max ×2.0 (120 km/h).
 */
export function setSvcBaseSystemVolume(pct: number): void {
  _baseSystemVolumePct = Math.max(0, Math.min(100, pct));
  _applySvcSystemVolume();
}

/**
 * Harici hız besleme — VehicleStateStore aboneliği kurulamazsa veya test için.
 * Schmidt trigger burada da uygulanır.
 */
export function notifySpeed(kmh: number): void {
  const safeKmh = Math.max(0, kmh);
  if (Math.abs(safeKmh - _svcLastAppliedKmh) < SVC_HYSTERESIS_KMH) return;

  _svcSpeedKmh       = safeKmh;
  _svcLastAppliedKmh = safeKmh;

  if (_svcEnabled && _gainNode) {
    _applySvcGain();
    _applySvcSystemVolume();
  }
}

/**
 * Opt-in AnalyserNode — görselleştirme bileşenleri için.
 * Lazy oluşturulur; kullanılmıyorsa sıfır CPU maliyeti.
 */
export function getOrCreateAnalyser(): AnalyserNode | null {
  const ctx = _getOrInit();
  if (!ctx || !_gainNode) return null;

  if (!_analyser) {
    _analyser = ctx.createAnalyser();
    _analyser.fftSize               = 256;
    _analyser.smoothingTimeConstant = 0.85;
    _gainNode.connect(_analyser);
  }
  return _analyser;
}

export function getAudioContext(): AudioContext | null { return _ctx; }

/**
 * Tüm kaynakları serbest bırakır (Zero-Leak).
 * Sıra: abonelik → analyser → gain → EQ → context.close()
 */
export function destroy(): void {
  if (!_ctx || _ctx.state === 'closed') return;

  _unsubSpeed?.();
  _unsubSpeed = null;

  _analyser?.disconnect();    _analyser   = null;
  _gainNode?.disconnect();    _gainNode   = null;
  _panner?.disconnect();      _panner     = null;
  _haasDelay?.disconnect();   _haasDelay  = null;
  _merger?.disconnect();      _merger     = null;
  _splitter?.disconnect();    _splitter   = null;
  _compressor?.disconnect();  _compressor = null;

  for (const node of _eqNodes) {
    try { node.disconnect(); } catch {/* zaten bağlantısız */}
  }
  _eqNodes = [];

  _isDucked  = false;
  _duckCount = 0;

  void _ctx.close();
  _ctx = null;
}

/* ── AGC & Driver Focus API ──────────────────────────────────────────────── */

/**
 * Akıllı Ses Dengeleme (AGC) açar/kapatır.
 * exponentialRamp: 100ms geçiş → patlama yok.
 */
export function setAGCEnabled(enabled: boolean): void {
  _agcEnabled = enabled;
  safeSetRaw(AGC_PERSIST_KEY, String(enabled));
  _applyAGCParams();
}

export function getAGCEnabled(): boolean { _loadPersistedState(); return _agcEnabled; }

/**
 * Sürücü Odaklı Ses (Driver Focus) — Haas Effect + StereoPanner.
 * - Etkin: sesi hafifçe sürücü tarafına (L) kaydırır, sağ hoparlöre 15ms gecikme ekler.
 * - Pasif: center pan, sıfır gecikme.
 */
export function setDriverFocus(enabled: boolean): void {
  _driverFocusEnabled = enabled;
  safeSetRaw(FOCUS_PERSIST_KEY, String(enabled));

  if (!_ctx || _ctx.state === 'closed') return;
  const now  = _ctx.currentTime;
  const RAMP = 0.12; // 120ms smooth geçiş

  if (_panner) {
    _panner.pan.cancelScheduledValues(now);
    _panner.pan.setValueAtTime(_panner.pan.value, now);
    _panner.pan.linearRampToValueAtTime(enabled ? -0.2 : 0, now + RAMP);
  }

  if (_haasDelay) {
    _haasDelay.delayTime.cancelScheduledValues(now);
    _haasDelay.delayTime.setValueAtTime(_haasDelay.delayTime.value, now);
    _haasDelay.delayTime.linearRampToValueAtTime(enabled ? 0.015 : 0, now + RAMP);
  }
}

export function getDriverFocusEnabled(): boolean { _loadPersistedState(); return _driverFocusEnabled; }

/**
 * Termal mod bildirimi — L2/L3 thermal'da AGC gevşetilir.
 * FullMapView → AdaptiveRuntimeManager'dan çağrılır.
 */
export function notifyThermalLow(isLow: boolean): void {
  if (_thermalLow === isLow) return;
  _thermalLow = isLow;
  _applyAGCParams();
}

/* ── Backward compat — theaterModeService API ────────────────────────────── */

export function setCinemaAudioProfile(): void  { setPreset('cinema'); }
export function setNormalAudioProfile():  void  { setPreset('flat');   }
export function getAudioProfile():        AudioProfile { return _profile; }

/* ── HMR cleanup ─────────────────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubSpeed?.();
    _unsubSpeed = null;
    destroy();
  });
}
