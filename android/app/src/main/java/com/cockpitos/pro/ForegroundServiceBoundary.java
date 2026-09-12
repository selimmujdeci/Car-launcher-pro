package com.cockpitos.pro;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * ARCH-04/F6 — one idempotent native start/stop boundary.  Callers remain
 * requesters; this class neither decides vehicle state nor owns TS lifecycle.
 */
public final class ForegroundServiceBoundary {
    private static final String TAG = "CLFgBoundary";
    private static final Object LOCK = new Object();
    private static boolean startRequested = false;
    private ForegroundServiceBoundary() {}

    public static boolean requestStart(Context context, String requester) {
        synchronized (LOCK) {
            if (CarLauncherForegroundService.getInstance() != null || startRequested) return false;
            try {
                Intent intent = new Intent(context, CarLauncherForegroundService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
                else context.startService(intent);
                startRequested = true;
                Log.i(TAG, "Foreground service start requested by " + requester);
                return true;
            } catch (Exception error) {
                Log.w(TAG, "Foreground service start rejected for " + requester, error);
                return false;
            }
        }
    }

    public static void markStarted() { synchronized (LOCK) { startRequested = true; } }
    public static void markStopped() { synchronized (LOCK) { startRequested = false; } }
    public static boolean requestStop(Context context, String requester) {
        synchronized (LOCK) {
            boolean stopped = context.stopService(new Intent(context, CarLauncherForegroundService.class));
            startRequested = false;
            Log.i(TAG, "Foreground service stop requested by " + requester + ": " + stopped);
            return stopped;
        }
    }
}
