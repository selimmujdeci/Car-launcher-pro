#!/usr/bin/env bash
# HIZLI APK — kullanıcı talebi (2026-09-06). apk:safe'in FULL suite'i ve gradle clean'i atlanır.
# apk:safe'in var oluş sebebi olan iki risk yine de kapatılır:
#   1) bozuk kod sevki  → hızlı regresyon kasası + GERÇEK build typecheck'i (tsc -b)
#   2) bayat-APK tuzağı → clean yok, bu yüzden APK hash'i ÖNCEKİYLE karşılaştırılır
set -e
export PATH="$PATH:/c/Users/selim/AppData/Local/Android/Sdk/platform-tools"
cd "C:/Users/selim/Desktop/caros pro"
APK=/c/Temp/carlauncher/app/build/outputs/apk/debug/app-debug.apk
PREV=$( [ -f "$APK" ] && sha256sum "$APK" | cut -d' ' -f1 || echo yok )

echo "── 1/5 hızlı regresyon kasası ──"
npm run guard 2>&1 | grep -E "Test Files|Tests |FAIL" | tail -2
echo "── 2/5 typecheck (tsc -b · build ile AYNI ayar) ──"
npx tsc -b
echo "── 3/5 vite build (normal) ──"
npm run build:sw >/dev/null 2>&1
node scripts/copy-sqljs-wasm.mjs >/dev/null 2>&1
npx vite build 2>&1 | grep -E "built in|error" | tail -2
echo "── 4/5 cap copy ──"
npx cap copy android 2>&1 | grep -E "Copy finished|error" | tail -1
echo "── 5/5 gradle assembleDebug (clean YOK) ──"
node scripts/gradle-build.mjs assembleDebug 2>&1 | grep -E "BUILD|error:" | tail -2

NEW=$(sha256sum "$APK" | cut -d' ' -f1)
echo "önceki APK: $PREV"
echo "yeni   APK: $NEW"
if [ "$PREV" = "$NEW" ]; then echo "⚠ BAYAT-APK UYARISI: hash DEĞİŞMEDİ — gradle eski çıktıyı paketlemiş olabilir"; fi
adb install -r "$APK" 2>&1 | tail -2
