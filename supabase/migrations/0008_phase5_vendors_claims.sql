-- 0008_phase5_vendors_claims.sql

-- 1. VENDORS
CREATE TABLE public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('vendor', 'contractor')),
  phone text,
  notes text,
  all_projects boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.vendor_project_access (
  vendor_id uuid references public.vendors(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (vendor_id, project_id)
);

-- 2. INVOICES
CREATE TABLE public.invoices (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  project_id uuid not null references public.projects(id),
  invoice_date date not null,
  tax_enabled boolean not null default false,
  tax_rate numeric(5,4) default 0,
  discount_rate numeric(5,4) default 0,
  subtotal numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  qty numeric(18,4) not null,
  unit_price numeric(18,2) not null,
  line_total numeric(18,2) not null,
  warehouse_id uuid, -- For Phase 8
  created_at timestamptz default now()
);

-- 3. CLAIMS
CREATE TABLE public.claims (
  id uuid primary key default gen_random_uuid(),
  claim_type text not null check (claim_type in ('vendor', 'owner')),
  party_id uuid not null,
  project_id uuid not null references public.projects(id),
  claim_number int not null,
  claim_date date not null,
  tax_enabled boolean not null default false,
  tax_rate numeric(5,4) default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (claim_type, party_id, project_id, claim_number)
);

CREATE TABLE public.claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  item_ref uuid not null,
  description text not null,
  previous_qty numeric(18,4) not null default 0,
  current_qty numeric(18,4) not null,
  unit_price numeric(18,2) not null,
  disbursement_pct numeric(5,4) not null default 1.0,
  line_total numeric(18,2) not null,
  is_stock_issue boolean not null default false,
  warehouse_id uuid,
  created_at timestamptz default now()
);

CREATE TABLE public.retention_releases (
  id uuid primary key default gen_random_uuid(),
  claim_type text not null check (claim_type in ('vendor', 'owner')),
  party_id uuid not null,
  project_id uuid not null references public.projects(id),
  amount numeric(18,2) not null,
  released_by uuid not null references public.employees(id),
  released_at timestamptz default now(),
  notes text,
  created_at timestamptz default now()
);

-- INDEXES
CREATE INDEX idx_invoices_vendor ON public.invoices(vendor_id);
CREATE INDEX idx_invoices_project ON public.invoices(project_id);
CREATE INDEX idx_claims_party ON public.claims(party_id);
CREATE INDEX idx_claims_project ON public.claims(project_id);
CREATE INDEX idx_claim_items_ref ON public.claim_items(item_ref);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX idx_claim_items_claim ON public.claim_items(claim_id);

-- 4. TRIGGERS
CREATE OR REPLACE FUNCTION public.trg_update_invoice_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_subtotal numeric(18,2);
  v_discount_rate numeric(5,4);
  v_tax_rate numeric(5,4);
  v_tax_enabled boolean;
  v_discount_amount numeric(18,2);
  v_tax_amount numeric(18,2);
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal
  FROM public.invoice_items
  WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT discount_rate, tax_rate, tax_enabled 
  INTO v_discount_rate, v_tax_rate, v_tax_enabled
  FROM public.invoices 
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  v_discount_amount := v_subtotal * v_discount_rate;
  IF v_tax_enabled THEN
    v_tax_amount := (v_subtotal - v_discount_amount) * v_tax_rate;
  ELSE
    v_tax_amount := 0;
  END IF;

  UPDATE public.invoices
  SET 
    subtotal = v_subtotal,
    discount_amount = v_discount_amount,
    tax_amount = v_tax_amount,
    total = v_subtotal - v_discount_amount + v_tax_amount
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_invoice_totals_after_item_change
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.trg_update_invoice_totals();

CREATE OR REPLACE FUNCTION public.trg_update_invoice_totals_on_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.discount_rate IS DISTINCT FROM OLD.discount_rate OR 
     NEW.tax_rate IS DISTINCT FROM OLD.tax_rate OR
     NEW.tax_enabled IS DISTINCT FROM OLD.tax_enabled THEN
     
     NEW.discount_amount := NEW.subtotal * NEW.discount_rate;
     IF NEW.tax_enabled THEN
       NEW.tax_amount := (NEW.subtotal - NEW.discount_amount) * NEW.tax_rate;
     ELSE
       NEW.tax_amount := 0;
     END IF;
     NEW.total := NEW.subtotal - NEW.discount_amount + NEW.tax_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_invoice_totals_before_invoice_change
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_update_invoice_totals_on_invoice();

-- 5. VIEW
CREATE OR REPLACE VIEW public.v_claim_totals AS
WITH item_math AS (
  SELECT 
    ci.claim_id,
    ci.item_ref,
    ci.previous_qty,
    ci.current_qty,
    ci.unit_price,
    ci.disbursement_pct,
    (ci.previous_qty + ci.current_qty) * ci.unit_price AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT 
    claim_id,
    SUM(cumulative_line_total) as claim_cumulative_total,
    SUM(cumulative_payable) as claim_cumulative_payable,
    SUM(cumulative_retained) as claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
)
SELECT 
  c.id as claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  COALESCE(
    (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
     FROM public.claims pc
     JOIN public.claim_items pci ON pci.claim_id = pc.id
     WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
     GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
    ), 0
  ) as prior_cumulative_payable,
  (cs.claim_cumulative_payable - COALESCE(
    (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
     FROM public.claims pc
     JOIN public.claim_items pci ON pci.claim_id = pc.id
     WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
     GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
    ), 0
  )) as net_payable_before_tax,
  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(
      (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
       FROM public.claims pc
       JOIN public.claim_items pci ON pci.claim_id = pc.id
       WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
       GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
      ), 0
    )) * c.tax_rate
  ELSE 0 END as tax_amount,
  (cs.claim_cumulative_payable - COALESCE(
    (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
     FROM public.claims pc
     JOIN public.claim_items pci ON pci.claim_id = pc.id
     WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
     GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
    ), 0
  )) + CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(
      (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
       FROM public.claims pc
       JOIN public.claim_items pci ON pci.claim_id = pc.id
       WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
       GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
      ), 0
    )) * c.tax_rate
  ELSE 0 END as total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id;

-- 6. RPCs
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  SELECT status INTO v_status FROM public.invoices WHERE id = p_invoice_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_invoice(p_invoice_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject invoices';
  END IF;

  UPDATE public.invoices
  SET status = 'rejected'
  WHERE id = p_invoice_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  SELECT status INTO v_status FROM public.claims WHERE id = p_claim_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_claim_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_claim(p_claim_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject claims';
  END IF;

  UPDATE public.claims
  SET status = 'rejected'
  WHERE id = p_claim_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RLS
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors viewable if all projects or project access matches" ON public.vendors
  FOR SELECT TO authenticated USING (
    all_projects = true
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.vendor_project_access vpa
      WHERE vpa.vendor_id = id AND public.has_project_access(vpa.project_id)
    )
  );

CREATE POLICY "Vendors insertable by admins" ON public.vendors
  FOR ALL TO authenticated USING (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()));

CREATE POLICY "Vendor access viewable by matching projects" ON public.vendor_project_access
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Vendor access insertable by admins" ON public.vendor_project_access
  FOR ALL TO authenticated USING (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()));

CREATE POLICY "Invoices select scoped" ON public.invoices
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Invoices insert scoped" ON public.invoices
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Invoice items select scoped" ON public.invoice_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND (public.is_super_admin() OR public.has_project_access(i.project_id)))
  );

CREATE POLICY "Invoice items insert scoped" ON public.invoice_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND (public.is_super_admin() OR public.has_project_access(i.project_id)))
  );

CREATE POLICY "Claims select scoped" ON public.claims
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Claims insert scoped" ON public.claims
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Claim items select scoped" ON public.claim_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND (public.is_super_admin() OR public.has_project_access(c.project_id)))
  );

CREATE POLICY "Claim items insert scoped" ON public.claim_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND (public.is_super_admin() OR public.has_project_access(c.project_id)))
  );

CREATE POLICY "Retention select scoped" ON public.retention_releases
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Retention insert scoped" ON public.retention_releases
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR public.has_project_access(project_id));
