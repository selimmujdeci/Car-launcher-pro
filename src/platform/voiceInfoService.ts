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
// MAVI-M6: bilgi cevapları da TEK seslendirme otoritesinden geçer.
import { speakMaviAnswer } from './assistant/maviSpeech';
/* MAVI-M6-LATE-SPEECH-GATE: bu servis `await` SONRASI konuşur (hava durumu 5 sn'ye
 * kadar bekler, bakım özeti I/O yapar). Komut girişinde YAKALANMIŞ tur token'ı
 * zincir boyunca AÇIK PARAMETRE olarak taşınır — global aktif tur OKUNMAZ. */
import type { MaviTurnToken } from './assistant/maviTurn';
import {
  getWeatherNarrative,
  refreshWeather,
  onWeatherState,
  type WeatherState,
} from './weatherService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { resolveLiveCanonicalSignal } from './vehicleDataLayer/canonicalVehicleSignal';
import { getEarlyWarnings } from './obd/predictionRuntime';
import { getObdSignalHealth } from './obdService';
import { explainEarlyWarnings } from './obd/earlyWarningEngine';
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

async function _speakWeather(turn: MaviTurnToken | null): Promise<void> {
  const narrative = getWeatherNarrative();
  // Veri zaten varsa doğrudan söyle.
  if (!/henüz alınamadı/i.test(narrative)) {
    speakMaviAnswer(narrative, { turn });
    return;
  }
  // Veri yok → kullanıcıyı oyalamadan tetikle ve kısa bekle.
  /* MAVI-F2: SEMANTİK ACK — gerçek bir ağ çekimi (`refreshWeather`) başlıyor ve
   * 5 sn'ye kadar sürebilir; cümle NE alındığını söyler, alındığını İDDİA ETMEZ. */
  speakMaviAnswer('Hava durumunu alıyorum.', { tier: 'progress', turn });
  refreshWeather().catch(() => { /* ignore */ });
  const s = await _waitForWeather(5000);
  /* AWAIT SONRASI: 5 sn'lik pencerede kullanıcı yeni komut vermiş olabilir. */
  speakMaviAnswer(
    s?.weather
      ? getWeatherNarrative(s)
      : 'Hava durumu verisi alınamadı. Konum izni veya şehir seçimi gerekiyor.',
    { turn },
  );
}

/* ── Araç verisi ─────────────────────────────────────────────────────────── */

function _speakSpeed(turn: MaviTurnToken | null): void {
  const { speed } = useUnifiedVehicleStore.getState();
  if (speed == null) {
    speakMaviAnswer('Hız verisi yok. OBD bağlantısını kontrol et.', { turn });
    return;
  }
  speakMaviAnswer(`Hızın saatte ${Math.round(speed)} kilometre.`, { turn });
}

function _speakFuel(turn: MaviTurnToken | null): void {
  const { fuel } = useUnifiedVehicleStore.getState();
  if (fuel == null) {
    speakMaviAnswer('Yakıt verisi yok. OBD bağlantısını kontrol et.', { turn });
    return;
  }
  const pct = Math.round(fuel);
  speakMaviAnswer(pct < 15 ? `Yakıtın yüzde ${pct}, az kaldı.` : `Yakıtın yüzde ${pct}.`, { turn });
}

function _speakTemp(turn: MaviTurnToken | null): void {
  /* P0-OBD-03: eskiden YALNIZ `canCoolantTemp` okunuyordu → CAN'ı olmayan
     araçta Mavi "veri yok" diyordu, oysa PID 0x05 okunuyordu. Otorite tek
     yerde (CAN → OBD → yok) ve BAYAT ölçüm konuşulmaz: sesli asistanın
     donmuş bir sıcaklığı söylemesi, sessiz kalmasından daha kötüdür. */
  const coolant = resolveLiveCanonicalSignal(
    useUnifiedVehicleStore.getState(), 'coolantTemp', Date.now(),
  ).value;
  if (coolant == null) {
    speakMaviAnswer('Motor sıcaklığı verisi yok. OBD bağlantısını kontrol et.', { turn });
    return;
  }
  const t = Math.round(coolant);
  const note = t > 105 ? ', yüksek, dikkat et' : '';
  speakMaviAnswer(`Motor sıcaklığı ${t} derece${note}.`, { turn });
}

async function _speakStatus(turn: MaviTurnToken | null): Promise<void> {
  /* P0-OBD-06: hat DURDUYSA sayı okumak yalan olur — ekrandaki değerler
     ölüdür. Mavi bunu söyler ve karar üretmez. */
  try {
    const link = getObdSignalHealth().link;
    if (link.state === 'STALLED') {
      speakMaviAnswer(
        `Araç verisi şu an güncellenmiyor: ${link.reason} Elimdeki değerler bayat, `
        + 'onlara göre yorum yapmıyorum.', { turn });
      return;
    }
  } catch { /* sağlık okunamadı → eski davranış (fail-soft) */ }

  const vs = useUnifiedVehicleStore.getState();
  const { speed, fuel } = vs;
  // P0-OBD-03: motor ısısı kanonik otoriteden (CAN → OBD → yok), yalnız LIVE.
  const coolant = resolveLiveCanonicalSignal(vs, 'coolantTemp', Date.now()).value;
  const parts: string[] = [];
  if (speed != null) parts.push(`Hızın ${Math.round(speed)} kilometre`);
  if (fuel != null) {
    const pct = Math.round(fuel);
    parts.push(pct < 15 ? `yakıtın yüzde ${pct}, az kaldı` : `yakıtın yüzde ${pct}`);
  }
  if (coolant != null) {
    const t = Math.round(coolant);
    parts.push(`motor sıcaklığı ${t} derece`);
  }
  if (parts.length === 0) {
    speakMaviAnswer('Araç verisi alınamıyor. OBD bağlantısını kontrol et.', { turn });
    return;
  }

  /* P0-OBD-04 — ERKEN UYARI. Mavi artık yalnız anlık değerleri okumakla
     kalmaz, ölçüme dayalı erken belirtiyi de GEREKÇESİYLE söyler. Dil
     bilinçlidir: "arıza var" DEMEZ — kesinlik iddiası ölçümün taşıyabileceğinden
     fazla olurdu. Kaynak `predictionRuntime`ın hükmüdür; Mavi kendi eşiğini
     ya da kendi yorumunu ÜRETMEZ (ikinci karar katmanı yok). */
  try {
    const warn = explainEarlyWarnings(getEarlyWarnings());
    if (warn) parts.push(warn);
  } catch { /* erken uyarı opsiyonel — sesli cevabı düşürmez */ }

  try {
    const maintenance = await getMaintenanceSummaryText();
    if (maintenance) parts.push(maintenance);
  } catch { /* bakım özeti opsiyonel */ }
  /* AWAIT SONRASI (bakım özeti I/O). */
  speakMaviAnswer(parts.join(', ') + '.', { turn });
}

/* ── Genel giriş ─────────────────────────────────────────────────────────── */

/**
 * Bilgi sorgusunu gerçek veriyle seslendirir.
 * Bilgi tipi değilse hiçbir şey yapmaz (çağıran isInformationalCommand ile süzmeli).
 */
export async function answerInformational(
  type: CommandType,
  turn: MaviTurnToken | null = null,
): Promise<void> {
  switch (type) {
    case 'show_weather':         await _speakWeather(turn); break;
    case 'vehicle_speed':        _speakSpeed(turn);         break;
    case 'vehicle_fuel':         _speakFuel(turn);          break;
    case 'vehicle_temp':         _speakTemp(turn);          break;
    case 'vehicle_status':       await _speakStatus(turn);  break;
    case 'vehicle_maintenance': {
      try {
        const summary = await getMaintenanceSummaryText();
        /* AWAIT SONRASI. */
        speakMaviAnswer(summary || 'Bakım bilgisi bulunamadı.', { turn });
      } catch {
        speakMaviAnswer('Bakım bilgisi alınamadı.', { turn });
      }
      break;
    }
    default: break;
  }
}
