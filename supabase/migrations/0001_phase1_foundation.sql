CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================================
-- 1. Org & Users
-- ============================================================================

CREATE TABLE public.project_owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  node_type text not null check (node_type in ('main_company', 'project', 'branch', 'phase')),
  parent_id uuid references public.projects(id),
  owner_id uuid references public.project_owners(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  is_main boolean not null default false,
  sort_order integer default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed Main Company (cannot be closed/deleted).
INSERT INTO public.projects (id, name, code, node_type, is_main, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'MAF Main Company', 'MAIN', 'main_company', true, 'open');

CREATE TABLE public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  username citext unique not null,
  pin_hash text,
  role text not null check (role in ('owner', 'standard')),
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  can_approve boolean not null default false,
  phone text,
  auth_user_id uuid references auth.users(id),
  failed_pin_attempts integer not null default 0,
  locked_until timestamptz,
  active_session_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.employee_page_access (
  employee_id uuid references public.employees(id) on delete cascade,
  page_slug text not null,
  created_at timestamptz default now(),
  primary key (employee_id, page_slug)
);

CREATE TABLE public.employee_project_access (
  employee_id uuid references public.employees(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (employee_id, project_id)
);

CREATE TABLE public.user_credentials (
  employee_id uuid references public.employees(id) on delete cascade,
  credential_id text unique not null,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  device_label text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (employee_id, credential_id)
);

CREATE TABLE public.user_sessions (
  employee_id uuid references public.employees(id) on delete cascade,
  token_hash text not null,
  device text,
  ip text,
  last_seen timestamptz default now(),
  created_at timestamptz default now(),
  primary key (employee_id, token_hash)
);

-- ============================================================================
-- 2. Audit & Attachments
-- ============================================================================

CREATE TABLE public.audit_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  action text not null check (action in ('create','update','delete','approve','login','logout')),
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz default now()
);

CREATE TABLE public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  r2_key text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.employees(id),
  created_at timestamptz default now()
);

-- ============================================================================
-- 9. Settings
-- ============================================================================

CREATE TABLE public.app_settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed Settings
INSERT INTO public.app_settings (key, value)
VALUES 
  ('currencies', '["EGP"]'::jsonb),
  ('lockout_policy', '{"max_attempts": 5, "lockout_minutes": 15}'::jsonb);

-- Indexes
CREATE INDEX idx_audit_entity ON public.audit_log (entity_type, entity_id);
CREATE INDEX idx_attach_entity ON public.attachments (entity_type, entity_id);

-- ============================================================================
-- RLS Functions
-- ============================================================================

-- A fast, secure way to get the current employee ID based on the Supabase auth.uid()
CREATE OR REPLACE FUNCTION public.current_employee_id() RETURNS uuid AS $$
  SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if the current user is a super admin
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean AS $$
  SELECT is_super_admin FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if the current user has access to a specific project
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_project_access 
    WHERE employee_id = public.current_employee_id() 
    AND project_id = p_project_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- Enable RLS and create policies
-- ============================================================================

ALTER TABLE public.project_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_page_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 1. App Settings: Everyone can read, only super admins can edit.
CREATE POLICY "App settings are viewable by all authenticated users" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "App settings can be changed by super admins" ON public.app_settings
  FOR ALL TO authenticated USING (public.is_super_admin());

-- 2. Projects & Owners: Viewable if you have project access or if you are super admin. Edit for super admins.
CREATE POLICY "Owners viewable if super admin or related project access" ON public.project_owners
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR 
    EXISTS (SELECT 1 FROM public.projects WHERE projects.owner_id = project_owners.id AND public.has_project_access(projects.id))
  );
CREATE POLICY "Owners editable by super admins" ON public.project_owners
  FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Projects viewable by super admin or if granted access" ON public.projects
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR public.has_project_access(id) OR is_main = true
  );
CREATE POLICY "Projects editable by super admins" ON public.projects
  FOR ALL TO authenticated USING (public.is_super_admin());

-- 3. Employees: Everyone authenticated can see the list (to pick names etc), but only super admins can edit.
CREATE POLICY "Employees viewable by all authenticated users" ON public.employees
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Employees editable by super admins" ON public.employees
  FOR ALL TO authenticated USING (public.is_super_admin());

-- Employee Access: Viewable by the employee themselves or super admins. Editable by super admins.
CREATE POLICY "Page access viewable by self or super admin" ON public.employee_page_access
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Page access editable by super admin" ON public.employee_page_access
  FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Project access viewable by self or super admin" ON public.employee_project_access
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Project access editable by super admin" ON public.employee_project_access
  FOR ALL TO authenticated USING (public.is_super_admin());

-- Credentials & Sessions: Only viewable/editable by the employee themselves or super admin.
CREATE POLICY "Credentials viewable by self or super admin" ON public.user_credentials
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Credentials editable by self or super admin" ON public.user_credentials
  FOR ALL TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());

CREATE POLICY "Sessions viewable by self or super admin" ON public.user_sessions
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Sessions editable by self or super admin" ON public.user_sessions
  FOR ALL TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());

-- 4. Audit Log: Viewable by super admins. Insertable by all authenticated users (handled via secure server function mostly).
CREATE POLICY "Audit log viewable by super admins" ON public.audit_log
  FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "Audit log insertable by all" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- 5. Attachments: Viewable by all authenticated (they may be related to any document), insertable by all.
CREATE POLICY "Attachments viewable by all authenticated users" ON public.attachments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Attachments insertable by all authenticated users" ON public.attachments
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Attachments updatable/deletable by super admin" ON public.attachments
  FOR UPDATE TO authenticated USING (public.is_super_admin());
CREATE POLICY "Attachments deletable by super admin" ON public.attachments
  FOR DELETE TO authenticated USING (public.is_super_admin());
