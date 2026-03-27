import { useState, useEffect } from 'react';

/**
 * Speed Limit Service - Mocks the speed limit based on "roads".
 */

export interface SpeedLimitData {
  limit: number;      // km/h
  roadName: string;
  isOverSpeed: boolean;
}

let _currentLimit = 50;
let _roadName = "Şehir İçi Yol";

// Simulate road changes every 30 seconds
const LIMITS = [30, 50, 70, 82, 90, 110, 120];
const ROADS = ["Dar Sokak", "Bulvar", "Ana Yol", "Çevre Yolu", "Devlet Yolu", "Otoyol", "Otoban"];

let _timer: ReturnType<typeof setInterval> | null = null;

export function startSpeedLimitService() {
  if (_timer) return;
  
  _timer = setInterval(() => {
    const idx = Math.floor(Math.random() * LIMITS.length);
    _currentLimit = LIMITS[idx];
    _roadName = ROADS[idx];
  }, 30000);
}

export function stopSpeedLimitService() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

export function useSpeedLimit(currentSpeed: number): SpeedLimitData {
  const [data, setData] = useState<SpeedLimitData>(() => ({
    limit: _currentLimit,
    roadName: _roadName,
    isOverSpeed: currentSpeed > _currentLimit,
  }));

  useEffect(() => {
    // Sync state only when currentSpeed or internal globals change
    setData({
      limit: _currentLimit,
      roadName: _roadName,
      isOverSpeed: currentSpeed > _currentLimit,
    });
  }, [currentSpeed]);

  return data;
}
