import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabaseBrowser';

export interface PairResult {
  success: boolean;
  vehicleId?: string;
  message: string;
}

export async function pairVehicle(code: string): Promise<PairResult> {
  if (!isSupabaseConfigured) {
    return { success: false, message: 'Supabase yapılandırması eksik.' };
  }
  try {
    const supabase = getSupabaseBrowserClient();

    // Auth kontrolü — pair_vehicle RPC auth.uid() kullanır
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, message: 'Araç eşleştirmek için giriş yapmanız gerekiyor.' };
    }

    const { data, error } = await supabase.rpc('pair_vehicle', {
      p_pairing_code: code.trim().toUpperCase(),
    });

    if (error) return { success: false, message: error.message };

    const res = data as { success: boolean; vehicle_id?: string; message?: string };
    return {
      success: res.success ?? false,
      vehicleId: res.vehicle_id,
      message: res.message ?? (res.success ? 'Araç başarıyla eşleştirildi.' : 'Eşleşme başarısız.'),
    };
  } catch {
    return { success: false, message: 'Beklenmeyen bir hata oluştu.' };
  }
}
