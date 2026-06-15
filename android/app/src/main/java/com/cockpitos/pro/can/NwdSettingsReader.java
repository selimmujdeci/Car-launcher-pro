package com.cockpitos.pro.can;

import android.content.ContentResolver;
import android.content.Context;
import android.database.ContentObserver;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

/**
 * NwdSettingsReader — K24 / NWD head unit'inde gövde CAN sinyallerini OEM'in
 * `Settings.System` tablosundan okur (root GEREKMEZ).
 *
 * Saha keşfi (2026-06-15): OEM `com.nwd.can.setting`, Hiworld 5AA5 kutusundan
 * decode ettiği gövde sinyallerini Android `system` ayar tablosuna yazıyor:
 *   can_door_show_state  → kapı (1=açık)
 *   hand_brake_state     → el/park freni (1=çekili)
 *   mcu_backcar_state    → geri vites (1=geri)
 * Bu değerler ANLIK değişiyor (kapı aç/kapatta 0↔1) ve her uygulama okuyabilir.
 *
 * NwdCanClient'in outer-SDK CarInfo akışı SPORADİK (yalnız hız değişince push) →
 * gövde sinyalleri için GÜVENİLMEZ. Bu okuyucu ContentObserver ile değişimi anında
 * yakalar ve aynı VehicleCanData kanalına (emitVehicleData) besler. Yalnız ilgili
 * alanları taşıyan kısmi emit'tir — hat baştan sona merge-safe (`!= null` guard) →
 * hız/diğer alanlar EZİLMEZ.
 *
 * READ-ONLY: yalnız ayar okur, yazmaz.
 */
public final class NwdSettingsReader {

    private static final String TAG = "NwdSettingsReader";

    // OEM 'system' ayar anahtarları (saha doğrulaması 2026-06-15)
    private static final String K_DOOR    = "can_door_show_state";
    private static final String K_HBRAKE  = "hand_brake_state";
    private static final String K_REVERSE = "mcu_backcar_state";

    private volatile boolean _started = false;
    private Context  _ctx = null;
    private NwdCanClient.DecodedListener _listener = null;
    private ContentObserver _observer = null;

    public synchronized void start(NwdCanClient.DecodedListener listener, Context context) {
        if (_started) return;
        if (context == null) return;
        _ctx      = context.getApplicationContext();
        _listener = listener;
        _started  = true;

        final ContentResolver cr = _ctx.getContentResolver();
        _observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override public void onChange(boolean selfChange) { readAndEmit(); }
        };
        try {
            cr.registerContentObserver(Settings.System.getUriFor(K_DOOR),    false, _observer);
            cr.registerContentObserver(Settings.System.getUriFor(K_HBRAKE),  false, _observer);
            cr.registerContentObserver(Settings.System.getUriFor(K_REVERSE), false, _observer);
            Log.d(TAG, "NwdSettingsReader başladı — gövde sinyalleri (kapı/elfreni/gerivites) izleniyor");
        } catch (Throwable t) {
            Log.w(TAG, "ContentObserver kaydı başarısız: " + t.getMessage());
        }
        // İlk değerleri hemen yayınla (boot durumunu UI'a taşı)
        readAndEmit();
    }

    public synchronized void stop() {
        if (!_started) return;
        _started = false;
        if (_ctx != null && _observer != null) {
            try { _ctx.getContentResolver().unregisterContentObserver(_observer); }
            catch (Throwable ignored) {}
        }
        _observer = null;
        _listener = null;
    }

    /** Ayar tablosundan gövde sinyallerini oku → yalnız bilinen alanları emit et. */
    private void readAndEmit() {
        if (!_started || _ctx == null) return;
        final ContentResolver cr = _ctx.getContentResolver();
        int door    = getInt(cr, K_DOOR);
        int hbrake  = getInt(cr, K_HBRAKE);
        int reverse = getInt(cr, K_REVERSE);

        // Hiçbir anahtar yoksa (NWD-dışı cihaz) → emit etme
        if (door < 0 && hbrake < 0 && reverse < 0) return;

        VehicleCanData.Builder b = new VehicleCanData.Builder();
        if (door    >= 0) b.doorOpen(door       != 0);
        if (hbrake  >= 0) b.parkingBrake(hbrake  != 0);
        if (reverse >= 0) b.reverse(reverse      != 0);

        NwdCanClient.DecodedListener cb = _listener;
        if (cb != null && _started) cb.onData(b.build());
    }

    /** Settings.System int oku; anahtar yoksa -1 (NWD-dışı cihazda güvenli). */
    private static int getInt(ContentResolver cr, String key) {
        try { return Settings.System.getInt(cr, key, -1); }
        catch (Throwable t) { return -1; }
    }
}
