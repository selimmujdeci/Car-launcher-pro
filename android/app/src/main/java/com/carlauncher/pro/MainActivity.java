package com.carlauncher.pro;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CarLauncherPlugin.class);
        super.onCreate(savedInstanceState);

        // Always-on screen for car head unit
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Show over lock screen — car HU may not have PIN but could have ambient lock
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applyImmersive();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Re-apply after returning from another app (some devices drop immersive on resume)
        applyImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Called when HOME is pressed while already running as the launcher.
        // Pass to Capacitor so the WebView can handle navigation if needed.
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    public void onBackPressed() {
        // Launcher: suppress back — prevents accidental exit from home screen
    }

    private void applyImmersive() {
        WindowInsetsControllerCompat insets =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        insets.hide(WindowInsetsCompat.Type.systemBars());
        insets.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }
}
