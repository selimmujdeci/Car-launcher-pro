/**
 * audioService.ts — Crystal Cabin DSP Engine v2
 *
 * Signal chain:
 *   connectSource(node) → eq[0] → … → eq[9] → masterGain → ctx.destination
 *                                                       └──→ analyser (opt-in)
 *
 * Özellikler:
 *   · 10-bant EQ (31–16 kHz) — preset + per-band override, safeStorage kalıcı
 *   · SVC (Speed Volume Compensation) — her 20 km/h +%3, maks %15 tavan
 *     Tüm gain değişimleri exponentialRampToValueAtTime (ses patlaması yok)
 *   · AnalyserNode lazy-created — fftSize=256 (görselleştirme istenmezse sıfır maliyet)
 *
 * Zero-Leak:
 *   · destroy() tüm AudioNode bağlantılarını keser + AudioContext.close()
 *   · _unsubSpeed thunk destroy()+HMR dispose'da temizlenir
 *   · connectSource() disconnect thunk döner
 */

import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';

/* ── Tipler ──────────────────────────────────────────────────────────────── */

export type AudioProfile = 'flat' | 'cinema' | 'speech' | 'dynamic' | 'classic';

export interface PresetInfo {
  id:    AudioProfile;
  label: string;
  /** 10 kazanç değeri (dB), BAND_FREQS sırasıyla: 31–62–125–250–500–1k–2k–4k–8k–16k */
  bands: readonly [number, number, number, number, number, number, number, number, number, number];
}

/* ── EQ sabitleri ────────────────────────────────────────────────────────── */

const BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16_000] as const;
const BAND_Q     = 1.41;    // peaking bantlar — √2 ≈ bir oktav bant genişliği

/* ── Gain ramp sabitleri ─────────────────────────────────────────────────── */

const GAIN_CLICK_RAMP_S = 0.05;  // slider anti-click geçiş süresi (sn)
const SVC_RAMP_S        = 1.5;   // SVC kabin gürültüsü kompanzasyonu (sn)
const DUCK_RAMP_S       = 0.30;  // Audio duck: navigasyon/uyarı hızlı bastır
const UNDUCK_RAMP_S     = 0.80;  // Audio unduck: yavaş geri aç (doğal geçiş)
const DUCK_LEVEL        = 0.20;  // Duck hedefi: master gain'in %20'si

/* ── Persistence anahtarları ─────────────────────────────────────────────── */

const EQ_PERSIST_KEY  = 'audio-eq-bands';
const SVC_PERSIST_KEY = 'audio-svc-enabled';

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

let _ctx:      AudioContext | null = null;
let _eqNodes:  BiquadFilterNode[]  = [];
let _gainNode: GainNode | null     = null;
let _analyser: AnalyserNode | null = null;
let _profile:  AudioProfile        = 'flat';
let _volume    = 1.0;               // 0.0–1.0, kullanıcı base volume

// 10-bant EQ dB değerleri — preset veya per-band override ile güncellenir
let _eqBands: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// SVC (Speed Volume Compensation)
let _svcEnabled  = true;  // varsayılan açık
let _svcSpeedKmh = 0;     // son bilinen hız

// Hız aboneliği cleanup thunk — Zero-Leak
let _unsubSpeed: (() => void) | null = null;

// Audio Ducking — navigasyon/uyarı sırasında müziği bastır
let _isDucked = false;

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

function _loadPersistedState(): void {
  // EQ bands
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

  // SVC enabled
  const svcRaw = safeGetRaw(SVC_PERSIST_KEY);
  if (svcRaw !== null) _svcEnabled = svcRaw !== 'false';
}

/* ── SVC hesaplama ve uygulama ───────────────────────────────────────────── */

/**
 * Hıza göre SVC çarpanı.
 * Her 20 km/h için +%3 (lineer ölçekleme), maks %15 tavan.
 * Araç yavaşladığında çarpan doğal olarak azalır.
 */
function _computeSvcMultiplier(speedKmh: number): number {
  if (!_svcEnabled) return 1.0;
  return 1.0 + Math.min((speedKmh / 20) * 0.03, 0.15); // 1.00–1.15
}

/**
 * Master gain'i SVC + base volume ile hedef değere taşır.
 *
 * exponentialRampToValueAtTime kullanımı:
 *   · Logaritmik ses algısıyla uyumlu eğri (insan kulağı için doğal)
 *   · Ses patlaması (click/pop) imkansız — her anda türevi sınırlı
 *   · Önceki bekleyen rampler cancelScheduledValues ile iptal edilir
 *
 * @param rampS  Geçiş süresi saniye cinsinden
 */
function _applySvcGain(rampS = SVC_RAMP_S): void {
  if (_isDucked) return; // Duck aktifken SVC/volume değişikliği gain'e yansımasın
  if (!_gainNode || !_ctx || _ctx.state === 'closed') return;

  const svcMul  = _computeSvcMultiplier(_svcSpeedKmh);
  // exponentialRampToValueAtTime: hedef 0 olamaz — 0.0001 (~-80 dB) pratikte sessiz
  const target  = Math.max(0.0001, _volume * svcMul);
  const now     = _ctx.currentTime;

  _gainNode.gain.cancelScheduledValues(now);
  // setValueAtTime: rampın başlangıç noktasını sabitler (anlık sıçrama yok)
  _gainNode.gain.setValueAtTime(Math.max(0.0001, _gainNode.gain.value), now);
  _gainNode.gain.exponentialRampToValueAtTime(target, now + rampS);
}

/**
 * Navigasyon anonsu veya sistem uyarısı başladığında müziği bastırır.
 * linearRampToValueAtTime kullanımı: duck değeri 0'a ulaşabilir (kaybolma izlenimine izin).
 * Arka arkaya çağrı güvenli — idempotent.
 */
export function duckMedia(): void {
  if (_isDucked) return;
  _isDucked = true;
  if (!_gainNode || !_ctx || _ctx.state === 'closed') return;
  const svcMul = _computeSvcMultiplier(_svcSpeedKmh);
  const target = Math.max(0, _volume * svcMul * DUCK_LEVEL);
  const now    = _ctx.currentTime;
  _gainNode.gain.cancelScheduledValues(now);
  _gainNode.gain.setValueAtTime(_gainNode.gain.value, now);
  _gainNode.gain.linearRampToValueAtTime(target, now + DUCK_RAMP_S);
}

/**
 * Navigasyon anonsu veya sistem uyarısı bitti — müziği geri aç.
 * SVC çarpanı dahil edilir; unduck sonrası gain doğru konumda kalır.
 */
export function unduckMedia(): void {
  if (!_isDucked) return;
  _isDucked = false;
  if (!_gainNode || !_ctx || _ctx.state === 'closed') return;
  const svcMul = _computeSvcMultiplier(_svcSpeedKmh);
  const target = Math.max(0, _volume * svcMul);
  const now    = _ctx.currentTime;
  _gainNode.gain.cancelScheduledValues(now);
  _gainNode.gain.setValueAtTime(_gainNode.gain.value, now);
  _gainNode.gain.linearRampToValueAtTime(target, now + UNDUCK_RAMP_S);
}

/* ── Hız aboneliği (VehicleStateStore, dynamic import) ──────────────────── */

/**
 * VehicleStateStore'u dinamik import ederek hız değişimlerini dinler.
 * Dynamic import: audioService → vehicleDataLayer döngüsel bağımlılığını önler.
 * Abonelik ilk initAudio() çağrısında kurulur; destroy()+HMR dispose'da iptal edilir.
 */
function _startSpeedSubscription(): void {
  if (_unsubSpeed) return;

  void import('./vehicleDataLayer/VehicleStateStore')
    .then(({ useVehicleStore }) => {
      if (_unsubSpeed) return; // çift abonelik önle (race condition)
      _unsubSpeed = useVehicleStore.subscribe((state) => {
        const kmh = state.speed;
        if (kmh == null || kmh === _svcSpeedKmh) return;
        _svcSpeedKmh = kmh;
        if (_svcEnabled && _gainNode) _applySvcGain();
      });
    })
    .catch(() => {
      // VehicleStateStore yüklenemedi — notifySpeed() yedek yol olarak çalışır
    });
}

/* ── İç inşa fonksiyonları ───────────────────────────────────────────────── */

function _buildChain(ctx: AudioContext): void {
  // 10-band EQ: lowshelf | peaking×8 | highshelf
  _eqNodes = (BAND_FREQS as readonly number[]).map((freq, i) => {
    const node = ctx.createBiquadFilter();
    if (i === 0) {
      node.type = 'lowshelf';
    } else if (i === BAND_FREQS.length - 1) {
      node.type = 'highshelf';
    } else {
      node.type = 'peaking';
      node.Q.value = BAND_Q;
    }
    node.frequency.value = freq;
    node.gain.value      = 0;
    return node;
  });

  // EQ zinciri: eq[0] → eq[1] → … → eq[9]
  for (let i = 0; i < _eqNodes.length - 1; i++) {
    _eqNodes[i].connect(_eqNodes[i + 1]);
  }

  // Master gain → destination
  _gainNode = ctx.createGain();
  _gainNode.gain.value = Math.max(0.0001, _volume);
  _eqNodes[_eqNodes.length - 1].connect(_gainNode);
  _gainNode.connect(ctx.destination);

  // Kalıcı EQ değerlerini (preset veya custom) uygula
  _writeEQ(_eqBands);
}

function _writeEQ(bands: readonly number[]): void {
  _eqNodes.forEach((node, i) => {
    node.gain.value = bands[i] ?? 0;
  });
}

/* ── Lazy init ───────────────────────────────────────────────────────────── */

function _getOrInit(): AudioContext | null {
  if (_ctx && _ctx.state !== 'closed') return _ctx;

  // Kalıcı EQ ve SVC ayarlarını yükle (AudioContext öncesinde — buildChain kullanır)
  _loadPersistedState();

  const AC = _resolveAC();
  if (!AC) return null;

  try {
    _ctx = new AC({ latencyHint: 'playback' });
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

/**
 * Suspended context'i devam ettirir.
 */
export async function resumeAudio(): Promise<void> {
  if (_ctx?.state === 'suspended') {
    await _ctx.resume();
  }
}

/**
 * Bir ses kaynağını DSP zincirine bağlar.
 * @returns Bağlantıyı kesen thunk — kaynak unmount olduğunda çağrılmalı (Zero-Leak).
 */
export function connectSource(source: AudioNode): () => void {
  const ctx = _getOrInit();
  if (!ctx || _eqNodes.length === 0) return () => { /* DSP yok, no-op */ };

  source.connect(_eqNodes[0]);

  return () => {
    try { source.disconnect(_eqNodes[0]); } catch { /* zaten kesilmiş */ }
  };
}

/**
 * EQ preset uygular — tüm 10 bandı preset değerleriyle günceller ve kalıcı kaydeder.
 * Context henüz açılmamışsa profil saklanır; init() sonrasında otomatik uygulanır.
 */
export function setPreset(profile: AudioProfile): void {
  _profile = profile;
  const preset = PRESETS.find(p => p.id === profile) ?? PRESETS[0];

  // Preset değerlerini _eqBands'e kopyala (tek kaynak of truth)
  _eqBands = [...preset.bands];

  if (_ctx && _ctx.state !== 'closed' && _eqNodes.length > 0) {
    _writeEQ(_eqBands);
  }

  _saveEqBands();

  if (profile === 'flat') {
    document.documentElement.style.removeProperty('--audio-profile');
  } else {
    document.documentElement.style.setProperty('--audio-profile', profile);
  }
}

/** Aktif preset adını döner. */
export function getPreset(): AudioProfile {
  return _profile;
}

/** Tüm preset tanımlarını döner (EQ UI için). */
export function getPresets(): readonly PresetInfo[] {
  return PRESETS;
}

/**
 * Tek bir EQ bandını ayarlar.
 * @param index  0–9 (BAND_FREQS sırasıyla: 31 Hz → 16 kHz)
 * @param db     Kazanç dB — [-12, +12] aralığında kısıtlanır
 */
export function setEqBand(index: number, db: number): void {
  if (index < 0 || index >= 10 || !Number.isFinite(db)) return;
  _eqBands[index] = Math.max(-12, Math.min(12, db));
  if (_eqNodes[index] && _ctx && _ctx.state !== 'closed') {
    // EQ band: doğrudan set — ramp gerekmez (EQ değişimi perceptual click yaratmaz)
    _eqNodes[index].gain.value = _eqBands[index];
  }
  _saveEqBands();
}

/** Tüm 10 bant dB değerlerini döner (preset veya custom). */
export function getEqBands(): readonly number[] {
  return _eqBands;
}

/**
 * DSP master gain (0–100 %).
 * exponentialRamp uygulanır — slider burst'larında tık/patlama önlenir.
 *
 * Not: Sistem ses seviyesi için systemSettingsService.setVolume() kullan.
 * Bu fonksiyon yalnızca WebView audio zincirindeki GainNode'u etkiler.
 */
export function setDSPVolume(percent: number): void {
  _volume = Math.max(0, Math.min(100, percent)) / 100;
  _applySvcGain(GAIN_CLICK_RAMP_S); // hızlı anti-click ramp; SVC çarpanı dahil
}

/** Mevcut DSP volume değerini 0–100 aralığında döner. */
export function getDSPVolume(): number {
  return Math.round(_volume * 100);
}

/**
 * SVC (Speed Volume Compensation) aktif/pasif.
 * Pasife alındığında masterGain base volume'e yavaşça döner.
 * Ayar safeStorage'a kalıcı olarak yazılır.
 */
export function setSvcEnabled(enabled: boolean): void {
  _svcEnabled = enabled;
  safeSetRaw(SVC_PERSIST_KEY, String(enabled));
  _applySvcGain(SVC_RAMP_S);
}

/** SVC etkin mi? */
export function getSvcEnabled(): boolean {
  return _svcEnabled;
}

/**
 * Harici hız besleme — VehicleStateStore aboneliği kurulamadığında veya
 * bağımsız test senaryolarında SVC'yi manuel beslemek için.
 * Zustand aboneliği aktifse çakışmaz (aynı deduplication kontrolü geçerli).
 */
export function notifySpeed(kmh: number): void {
  const safeKmh = Math.max(0, kmh);
  if (safeKmh === _svcSpeedKmh) return;
  _svcSpeedKmh = safeKmh;
  if (_svcEnabled && _gainNode) _applySvcGain();
}

/**
 * Opt-in AnalyserNode — görselleştirme bileşenleri için.
 * İlk çağrıda lazy oluşturulur; kullanılmıyorsa sıfır CPU maliyeti vardır.
 * Mali-400: fftSize=256, smoothing=0.85 → minimum FFT yükü.
 */
export function getOrCreateAnalyser(): AnalyserNode | null {
  const ctx = _getOrInit();
  if (!ctx || !_gainNode) return null;

  if (!_analyser) {
    _analyser = ctx.createAnalyser();
    _analyser.fftSize              = 256;
    _analyser.smoothingTimeConstant = 0.85;
    _gainNode.connect(_analyser);
  }
  return _analyser;
}

/** Raw AudioContext erişimi (harici Web Audio işlemleri için). */
export function getAudioContext(): AudioContext | null {
  return _ctx;
}

/**
 * Tüm kaynakları serbest bırakır.
 *
 * Zero-Leak garantisi:
 *   1. Hız aboneliği iptal edilir (_unsubSpeed)
 *   2. AnalyserNode bağlantısı kesilir
 *   3. GainNode bağlantısı kesilir
 *   4. Tüm EQ BiquadFilterNode bağlantıları kesilir
 *   5. AudioContext kapatılır (asenkron, GC'ye bırakılır)
 */
export function destroy(): void {
  if (!_ctx || _ctx.state === 'closed') return;

  _unsubSpeed?.();
  _unsubSpeed = null;

  _analyser?.disconnect();
  _analyser = null;

  _gainNode?.disconnect();
  _gainNode = null;

  for (const node of _eqNodes) {
    try { node.disconnect(); } catch { /* zaten bağlantısız */ }
  }
  _eqNodes = [];

  void _ctx.close();
  _ctx = null;
}

/* ── Backward compat — theaterModeService API ────────────────────────────── */

export function setCinemaAudioProfile(): void  { setPreset('cinema'); }
export function setNormalAudioProfile():  void  { setPreset('flat');   }
export function getAudioProfile():        AudioProfile { return _profile; }

/* ── HMR cleanup — dev modda Hot Reload'da AudioContext + abonelik sızıntısını önle ── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubSpeed?.();
    _unsubSpeed = null;
    destroy();
  });
}
