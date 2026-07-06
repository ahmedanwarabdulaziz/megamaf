-- 0063_expense_category_scopes.sql
-- Adds project-scoping to expense categories.
-- Each parent category can be restricted to:
--   'main_company'      → expenses with no project (main company context)
--   'all_projects'      → expenses in any project
--   'specific_project'  → expenses in a specific project (project_id required)
-- A category with NO scope rows is visible everywhere (backward-compatible default).

CREATE TABLE public.expense_category_scopes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE CASCADE,
  scope       text NOT NULL CHECK (scope IN ('main_company', 'all_projects', 'specific_project')),
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),

  -- specific_project entries MUST have a project_id; others must NOT
  CONSTRAINT chk_specific_needs_project_id
    CHECK (scope != 'specific_project' OR project_id IS NOT NULL),
  CONSTRAINT chk_non_specific_no_project_id
    CHECK (scope = 'specific_project' OR project_id IS NULL)
);

-- Unique: at most one row per (category, 'main_company') and per (category, 'all_projects')
CREATE UNIQUE INDEX uidx_cat_scope_global
  ON public.expense_category_scopes(category_id, scope)
  WHERE project_id IS NULL;

-- Unique: at most one row per (category, specific project)
CREATE UNIQUE INDEX uidx_cat_scope_specific_project
  ON public.expense_category_scopes(category_id, project_id)
  WHERE scope = 'specific_project';

-- Index for fast lookup when filtering categories for a project
CREATE INDEX idx_cat_scopes_project ON public.expense_category_scopes(project_id);

ALTER TABLE public.expense_category_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Category scopes viewable by authenticated"
  ON public.expense_category_scopes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Category scopes manageable by super admins"
  ON public.expense_category_scopes
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
