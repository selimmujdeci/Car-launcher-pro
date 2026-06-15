#!/system/bin/sh
# uart-baudsweep.sh — bir UART portunu farkli baud'larda kisa kisa oku, hex dok.
# Amac: dogru baud'u bulmak. READ-ONLY. Kullanim: uart-baudsweep.sh <dev> [saniye]
DEV="${1:-/dev/ttyS4}"; SEC="${2:-3}"
for BAUD in 9600 19200 38400 57600 115200 230400 460800 921600; do
  echo "==================== $DEV @ $BAUD ===================="
  stty -F "$DEV" "$BAUD" cs8 -cstopb -parenb raw -echo 2>/dev/null \
    || { echo "  (stty ayarlanamadi — port mesgul olabilir)"; continue; }
  ( od -An -tx1 -v "$DEV" 2>/dev/null ) &
  RP=$!
  sleep "$SEC"
  kill "$RP" 2>/dev/null
  wait "$RP" 2>/dev/null
done
echo "==================== sweep bitti ===================="
