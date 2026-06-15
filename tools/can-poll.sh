#!/system/bin/sh
# can-poll.sh — NWD 'system' ayar tablosundan canli arac sinyallerini oku (READ-ONLY).
# Hicbir sey yazmaz, porta dokunmaz. Kullanim: can-poll.sh [adet]
N="${1:-18}"
i=0
while [ "$i" -lt "$N" ]; do
  D=$(settings get system can_door_show_state)
  H=$(settings get system hand_brake_state)
  L=$(settings get system can_left_turn_light_onoff)
  R=$(settings get system can_right_turn_light_onoff)
  Z=$(settings get system can_double_light_onoff)
  V=$(settings get system mcu_backcar_state)
  S=$(settings get system mcu_steering_wheel_state)
  echo "t${i}s door=$D hbrake=$H Lturn=$L Rturn=$R hazard=$Z reverse=$V swc=$S"
  sleep 1
  i=$((i+1))
done
