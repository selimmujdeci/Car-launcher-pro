/**
 * Voice Info Service — bilgi sorularına GERÇEK VERİ ile sözlü cevap üretir.
 *
 * Problem: Yerel komut yolu (commandParser → voiceService.dispatch → routeIntent)
 * bilgi sorgularını cevaplamıyordu. routeIntent async bilgi intent'lerini
 * commandExecutor'a havale ediyor, ama yerel yol commandExecutor'ı çağırmıyor.
 * Sonuç: "hava durumu nasıl" → sadece statik "Hava durumu gösteriliyor" deniyor,
 * gerçek sıcaklık söylenmiyor.
 *
 * Bu servis o boşluğu kapatır: ParsedCommand'ın bilgi tipi olup olmadığını söyler
 * ve gerçek veriyi (hava/hız/yakıt/sıcaklık) akıcı Türkçe ile seslendirir.
 *
 * Saf side-effect: yalnızca TTS konuşur; UI durumu voiceService tarafından yönetilir.
 */

import type { CommandType } from './commandParser';
import { speakFeedback } from './ttsService';
import {
  getWeatherNarrative,
  refreshWeather,
  onWeatherState,
  type WeatherState,
} from './weatherService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { getMaintenanceSummaryText } from './vehicleMaintenanceService';

/* ── Bilgi sorgusu tipleri ───────────────────────────────────────────────── */

/**
 * Bu komut tipleri "bir şey yap" değil "bir şey söyle" sorgularıdır.
 * voiceService.dispatch bunlar için statik feedback yerine answerInformational çağırır.
 */
const INFO_TYPES = new Set<CommandType>([
  'show_weather',
  'vehicle_speed',
  'vehicle_fuel',
  'vehicle_temp',
  'vehicle_status',
  'vehicle_maintenance',
]);

export function isInformationalCommand(type: CommandType): boolean {
  return INFO_TYPES.has(type);
}

/* ── Hava durumu ─────────────────────────────────────────────────────────── */

/** Weather state'in veriye sahip olmasını kısa süre bekler (refresh tetiklenmiş olabilir). */
function _waitForWeather(timeoutMs: number): Promise<WeatherState | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (s: WeatherState | null) => {
      if (done) return;
      done = true;
      try { unsub(); } catch { /* ignore */ }
      clearTimeout(timer);
      resolve(s);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const unsub = onWeatherState((s) => {
      if (s.weather) finish(s);
    });
  });
}

async function _speakWeather(): Promise<void> {
  const narrative = getWeatherNarrative();
  // Veri zaten varsa doğrudan söyle.
  if (!/henüz alınamadı/i.test(narrative)) {
    speakFeedback(narrative);
    return;
  }
  // Veri yok → kullanıcıyı oyalamadan tetikle ve kısa bekle.
  speakFeedback('Hava durumuna bakıyorum.');
  refreshWeather().catch(() => { /* ignore */ });
  const s = await _waitForWeather(5000);
  speakFeedback(
    s?.weather
      ? getWeatherNarrative(s)
      : 'Hava durumu verisi alınamadı. Konum izni veya şehir seçimi gerekiyor.',
  );
}

/* ── Araç verisi ─────────────────────────────────────────────────────────── */

function _speakSpeed(): void {
  const { speed } = useUnifiedVehicleStore.getState();
  if (speed == null) {
    speakFeedback('Hız verisi yok. OBD bağlantısını kontrol et.');
    return;
  }
  speakFeedback(`Hızın saatte ${Math.round(speed)} kilometre.`);
}

function _speakFuel(): void {
  const { fuel } = useUnifiedVehicleStore.getState();
  if (fuel == null) {
    speakFeedback('Yakıt verisi yok. OBD bağlantısını kontrol et.');
    return;
  }
  const pct = Math.round(fuel);
  speakFeedback(pct < 15 ? `Yakıtın yüzde ${pct}, az kaldı.` : `Yakıtın yüzde ${pct}.`);
}

function _speakTemp(): void {
  const { canCoolantTemp } = useUnifiedVehicleStore.getState();
  if (canCoolantTemp == null) {
    speakFeedback('Motor sıcaklığı verisi yok. OBD bağlantısını kontrol et.');
    return;
  }
  const t = Math.round(canCoolantTemp);
  const note = t > 105 ? ', yüksek, dikkat et' : '';
  speakFeedback(`Motor sıcaklığı ${t} derece${note}.`);
}

async function _speakStatus(): Promise<void> {
  const { speed, fuel, canCoolantTemp } = useUnifiedVehicleStore.getState();
  const parts: string[] = [];
  if (speed != null) parts.push(`Hızın ${Math.round(speed)} kilometre`);
  if (fuel != null) {
    const pct = Math.round(fuel);
    parts.push(pct < 15 ? `yakıtın yüzde ${pct}, az kaldı` : `yakıtın yüzde ${pct}`);
  }
  if (canCoolantTemp != null) {
    const t = Math.round(canCoolantTemp);
    parts.push(`motor sıcaklığı ${t} derece`);
  }
  if (parts.length === 0) {
    speakFeedback('Araç verisi alınamıyor. OBD bağlantısını kontrol et.');
    return;
  }
  try {
    const maintenance = await getMaintenanceSummaryText();
    if (maintenance) parts.push(maintenance);
  } catch { /* bakım özeti opsiyonel */ }
  speakFeedback(parts.join(', ') + '.');
}

/* ── Genel giriş ─────────────────────────────────────────────────────────── */

/**
 * Bilgi sorgusunu gerçek veriyle seslendirir.
 * Bilgi tipi değilse hiçbir şey yapmaz (çağıran isInformationalCommand ile süzmeli).
 */
export async function answerInformational(type: CommandType): Promise<void> {
  switch (type) {
    case 'show_weather':         await _speakWeather(); break;
    case 'vehicle_speed':        _speakSpeed();         break;
    case 'vehicle_fuel':         _speakFuel();          break;
    case 'vehicle_temp':         _speakTemp();          break;
    case 'vehicle_status':       await _speakStatus();  break;
    case 'vehicle_maintenance': {
      try {
        const summary = await getMaintenanceSummaryText();
        speakFeedback(summary || 'Bakım bilgisi bulunamadı.');
      } catch {
        speakFeedback('Bakım bilgisi alınamadı.');
      }
      break;
    }
    default: break;
  }
}
