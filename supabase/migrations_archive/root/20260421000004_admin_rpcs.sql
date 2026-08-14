-- =====================================================================
-- Car Launcher Pro — Admin RPCs
-- Migration 004: add_member_by_email, remove_member
--
-- Depends on: 20260421000000_initial_schema.sql
-- =====================================================================

-- ── add_member_by_email ───────────────────────────────────────────────
-- Admin adds an existing user to their company by email.
-- Requires caller to have admin+ role in the target company.
-- Returns the user_id on success; raises if user not found.
CREATE OR REPLACE FUNCTION public.add_member_by_email(
  p_email      text,
  p_company_id uuid,
  p_role       membership_role DEFAULT 'viewer',
  p_full_name  text            DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_caller_role membership_role;
  v_user_id     uuid;
BEGIN
  -- Enforce admin+ in the target company
  SELECT role INTO v_caller_role
  FROM public.memberships
  WHERE user_id = auth.uid() AND company_id = p_company_id;

  IF NOT FOUND OR v_caller_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekiyor';
  END IF;

  -- Prevent downgrading super_admin by non-super_admin
  IF p_role = 'super_admin' AND v_caller_role != 'super_admin' THEN
    RAISE EXCEPTION 'Süper admin rolü yalnızca süper admin tarafından atanabilir';
  END IF;

  -- Look up user in auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(trim(p_email)) LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bu e-posta ile kayıtlı kullanıcı bulunamadı: %', p_email;
  END IF;

  -- Update display name if provided
  IF p_full_name IS NOT NULL THEN
    UPDATE public.users SET full_name = p_full_name WHERE id = v_user_id;
  END IF;

  -- Upsert membership
  INSERT INTO public.memberships (user_id, company_id, role)
  VALUES (v_user_id, p_company_id, p_role)
  ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN jsonb_build_object(
    'user_id',    v_user_id,
    'company_id', p_company_id,
    'role',       p_role
  );
END;
$$;

-- ── remove_member ──────────────────────────────────────────────────────
-- Admin removes a user from their company (deletes membership record only).
-- Does NOT delete the user's auth account.
CREATE OR REPLACE FUNCTION public.remove_member(
  p_user_id    uuid,
  p_company_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role  membership_role;
  v_target_role  membership_role;
BEGIN
  SELECT role INTO v_caller_role
  FROM public.memberships
  WHERE user_id = auth.uid() AND company_id = p_company_id;

  IF NOT FOUND OR v_caller_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekiyor';
  END IF;

  SELECT role INTO v_target_role
  FROM public.memberships
  WHERE user_id = p_user_id AND company_id = p_company_id;

  -- Only super_admin can remove another super_admin
  IF v_target_role = 'super_admin' AND v_caller_role != 'super_admin' THEN
    RAISE EXCEPTION 'Süper admin yalnızca başka bir süper admin tarafından kaldırılabilir';
  END IF;

  -- Cannot remove yourself
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Kendinizi şirketten çıkaramazsınız';
  END IF;

  DELETE FROM public.memberships WHERE user_id = p_user_id AND company_id = p_company_id;
END;
$$;
