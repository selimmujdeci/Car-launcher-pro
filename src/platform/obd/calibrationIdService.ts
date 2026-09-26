/**
 * calibrationIdService — SAE J1979 Mode 09 PID 04 (Kalibrasyon Kimliği/CAL ID) salt-okunur sorgusu.
 *
 * NEDEN VAR: el sıkışma (handshake) bugüne kadar Mode 09'dan YALNIZ PID 02'yi (VIN)
 * okuyordu. PID 04, ECU'nun yazılım/kalibrasyon sürümünü tanımlar ve hiçbir yol
 * tarafından sorgulanmıyordu.
 *
 * PARALEL SORGU SİSTEMİ KURULMAZ: istek MEVCUT genel salt-okunur PDU taşımasından
 * (`vdkPduTransport` → gerçek dalda `GenericPduTransport` → native `sendDiagnosticPdu`)
 * gider — el sıkışmanın (0100/0120/0902) kullandığı atomik native zincirden AYRI, ama
 * YENİ bir taşıma/kuyruk İCAT ETMEZ. Servis '09' hem TS erken kapısında
 * (`genericPduTransport.GENERIC_READ_ONLY_SERVICES`) hem native
 * `DiagnosticServiceGate`de ZATEN salt-okunur — hiçbir kapı gevşetilmedi, hiçbir
 * yeni native kod/APK GEREKMEZ.
 *
 * İKİNCİ DECODER DEĞİL (yeni bir SERVİS için ilk decoder): `parseCalibrationId`
 * (`core/val/OBDHandshake.ts`) `parseVIN` ile AYNI ham-hex ayrıştırma desenini
 * kullanır — Mode 09 PID 04 için önceden HİÇBİR çözücü yoktu.
 *
 * TEK OTORİTE: sonuç `useVidStore.vehicle.calibrationId`e yazılır — VIN'in
 * yaşadığı AYNI şema; ikinci bir "araç kimliği" deposu KURULMAZ.
 */
import { vdkPduTransport } from './vdkTransport';
import { makePdu, FUNCTIONAL_TARGET, type PduOutcome } from './pdu';
import { parseCalibrationId } from '../../core/val/OBDHandshake';
import { useVidStore } from '../../store/useVidStore';
import { logError } from '../crashLogger';

export interface CalibrationIdResult {
  /** Ayrıştırılmış CAL ID; ölçülemediyse `null` (uydurma YOK). */
  readonly value: string | null;
  readonly outcome: PduOutcome;
  /** Ham yanıt (taşımanın gördüğü biçimde); ölçülmediyse `null`. */
  readonly raw: string | null;
  readonly latencyMs: number | null;
}

let _lastResult: CalibrationIdResult | null = null;

/** Son ölçülen sonucun kopyası — hiçbir sorgu TETİKLEMEZ, yan etkisiz okuma. */
export function getCalibrationIdResult(): CalibrationIdResult | null {
  return _lastResult ? { ..._lastResult } : null;
}

/**
 * Mode 09 PID 04'ü BİR KEZ sorgular (fonksiyonel/broadcast — VIN ile AYNI hedef
 * kapsamı). Sonuç ölçülür, uydurulmaz; başarısız/negatif/timeout yanıtta
 * `value: null` döner ve ÖNCEKİ kalıcı değer SİLİNMEZ (kısmi kanıt eskiyi bozmaz).
 *
 * `principal` verilmezse `LOCAL_UI` sayılır (ARCH-05 varsayılanı) — bu, baş
 * ünitenin kendi otomatik teşhis akışının (el sıkışma sonrası) doğru sınıfıdır.
 * `SYSTEM_INTERNAL` BİLEREK KULLANILMAZ: o sınıfın DIAGNOSTIC_READ yetkisi YOKTUR
 * (bkz. `security/enforcement.ts` PRINCIPAL_GRANTS) — kullanılsaydı istek ARCH-05
 * kapısında sessizce reddedilirdi.
 */
export async function queryCalibrationId(): Promise<CalibrationIdResult> {
  const pdu = makePdu({
    service: '09', subFunction: '04', target: FUNCTIONAL_TARGET, responseEchoBytes: 1,
  });
  const response = await vdkPduTransport().send(pdu);
  const value = response.outcome === 'POSITIVE' ? parseCalibrationId(response.raw) : null;
  const result: CalibrationIdResult = {
    value, outcome: response.outcome, raw: response.raw, latencyMs: response.latencyMs,
  };
  _lastResult = result;
  if (value) {
    try { useVidStore.getState().updateVehicleInfo({ calibrationId: value }); }
    catch (e) { logError('CalibrationId:VidWrite', e); }
  }
  return result;
}

/** Test yardımcısı — üretim kodu çağırmaz. */
export function _resetCalibrationIdForTest(): void {
  _lastResult = null;
}
