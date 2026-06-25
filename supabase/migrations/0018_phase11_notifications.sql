-- 0018_phase11_notifications.sql

-- 1. Notifications Table
CREATE TABLE public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    type text NOT NULL, -- e.g., 'claim_approved', 'expense_submitted'
    title text NOT NULL,
    body text NOT NULL,
    action_url text, -- optional link to click
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
);

-- Index for querying unread notifications quickly
CREATE INDEX idx_notifications_employee_unread ON public.notifications(employee_id) WHERE NOT is_read;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only view and update their own notifications
CREATE POLICY "Users can view own notifications" ON public.notifications
    FOR SELECT TO authenticated USING (employee_id = public.current_employee_id());

CREATE POLICY "Users can update own notifications" ON public.notifications
    FOR UPDATE TO authenticated USING (employee_id = public.current_employee_id());

CREATE POLICY "System can insert notifications" ON public.notifications
    FOR INSERT TO authenticated WITH CHECK (true); -- Inserted via service role or security definer usually, but true for now since our API handles it

-- 2. Push Subscriptions Table
CREATE TABLE public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Index for fetching subscriptions for a specific user
CREATE INDEX idx_push_subs_employee ON public.push_subscriptions(employee_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own subscriptions
CREATE POLICY "Users can insert own subscriptions" ON public.push_subscriptions
    FOR INSERT TO authenticated WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "Users can delete own subscriptions" ON public.push_subscriptions
    FOR DELETE TO authenticated USING (employee_id = public.current_employee_id());

-- The backend needs to read all subscriptions via service_role to send pushes, 
-- but we don't expose SELECT to regular authenticated users to protect privacy.
