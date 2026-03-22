package com.carlauncher.pro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * BootReceiver — launches Car Launcher Pro after device boot.
 *
 * Declared in AndroidManifest with RECEIVE_BOOT_COMPLETED.
 * Optional: user must confirm this app as the default HOME launcher
 * for the receiver to have full effect on most Android versions.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Intent launcher = new Intent(context, MainActivity.class);
            // NEW_TASK: required when starting from a non-Activity context
            // CLEAR_TOP: ensure a clean launch with no stale back stack
            launcher.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launcher);
        }
    }
}
