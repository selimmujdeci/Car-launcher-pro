/**
 * voiceTypes.ts — Voice services için ortak tip merkezi.
 *
 * VehicleContext'in tek yetkili tanımı aiVoiceService.ts'de yaşar;
 * bu dosya sadece re-export sağlar — tüketiciler buradan import eder.
 */
export type { VehicleContext, AIVoiceResult, AIProvider } from './aiVoiceService';
