#!/system/bin/sh
# can-capture.sh — NWD CAN kutusu 5AA5 cercevelerini logcat'ten canli yakala.
# com.nwd.can.setting (pid degisebilir) UART RX'i 'nwdapp_UartCommunication' tag'ine basar.
# Kullanim: can-capture.sh [saniye]   (varsayilan 60). Sadece 5AA5 RX cerceveleri.
# READ-ONLY: porta dokunmaz, sadece logcat dinler.
SEC="${1:-60}"
echo "=== CAN 5AA5 capture ${SEC}sn — su an aksiyon yap (kapi/far/sinyal/fren) ==="
logcat -c 2>/dev/null
timeout "$SEC" logcat -v time 2>/dev/null \
  | grep --line-buffered -E 'nwdapp_UartCommunication.*5AA5' \
  | grep --line-buffered -vE '5AA50ACB' \
  | awk '{ ts=$1" "$2; n=NF; print ts"  "$n }'
echo "=== capture bitti (5AA50ACB = saat frame'i, filtrelendi) ==="
