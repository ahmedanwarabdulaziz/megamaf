-- Create a function to automatically update 'updated_at' column
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Create `companies` table
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  default_currency text NOT NULL DEFAULT 'EGP',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Apply updated_at trigger to companies
CREATE TRIGGER set_companies_updated_at
BEFORE UPDATE ON public.companies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 2. Create `profiles` table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name text,
  role text NOT NULL DEFAULT 'member', -- allowed: 'admin', 'member'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Apply updated_at trigger to profiles
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Helper to get current user's company_id (must be defined AFTER profiles table)
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS uuid AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper to get current user's role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 3. Row Level Security
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Companies Policies
-- A user can read their own company
CREATE POLICY "Users can read their own company"
  ON public.companies
  FOR SELECT
  USING (id = get_my_company_id());

-- Only admins can update their company
CREATE POLICY "Admins can update their company"
  ON public.companies
  FOR UPDATE
  USING (id = get_my_company_id() AND get_my_role() = 'admin');

-- Profiles Policies
-- A user can read all profiles in their own company
CREATE POLICY "Users can read profiles in their company"
  ON public.profiles
  FOR SELECT
  USING (company_id = get_my_company_id());

-- Users can update their own profile (e.g. change full_name)
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid());

-- Admins can update any profile in their company (e.g. to change roles)
CREATE POLICY "Admins can update profiles in their company"
  ON public.profiles
  FOR UPDATE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- 4. Trigger to handle new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_company_id uuid;
  user_count int;
  assigned_role text;
BEGIN
  -- Check how many users exist to determine if this is the first user (admin)
  SELECT count(*) INTO user_count FROM public.profiles;
  
  IF user_count = 0 THEN
    assigned_role := 'admin';
    -- Create a default company for the first user
    INSERT INTO public.companies (name) VALUES ('My Company') RETURNING id INTO default_company_id;
  ELSE
    assigned_role := 'member';
    -- Find the first company to attach to (for Phase 1 simplicity)
    SELECT id INTO default_company_id FROM public.companies LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, company_id, role, full_name)
  VALUES (NEW.id, default_company_id, assigned_role, NEW.raw_user_meta_data->>'full_name');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
