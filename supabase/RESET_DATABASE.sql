-- ============================================================================
-- MegaMaf — RESET DATABASE
-- ============================================================================
-- Drops EVERYTHING in the `public` schema (tables, views, enums, functions,
-- sequences) so you can rebuild the schema from scratch.
--
-- PRESERVES the Supabase-managed `auth` and `storage` schemas, so your existing
-- login accounts keep working. Only your application data/tables are removed.
--
-- ⚠️  THIS PERMANENTLY DELETES ALL DATA IN THE PUBLIC SCHEMA. There is no undo.
--
-- How to run:
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- ============================================================================

-- 1) Drop all tables in public (CASCADE removes dependent FKs, views, triggers)
do $$
declare r record;
begin
  for r in (select tablename from pg_tables where schemaname = 'public') loop
    execute 'drop table if exists public.' || quote_ident(r.tablename) || ' cascade';
  end loop;
end $$;

-- 2) Drop all views in public
do $$
declare r record;
begin
  for r in (select table_name from information_schema.views where table_schema = 'public') loop
    execute 'drop view if exists public.' || quote_ident(r.table_name) || ' cascade';
  end loop;
end $$;

-- 3) Drop all user-defined types / enums in public
do $$
declare r record;
begin
  for r in (
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  ) loop
    execute 'drop type if exists public.' || quote_ident(r.typname) || ' cascade';
  end loop;
end $$;

-- 4) Drop all functions in public (this also removes triggers on auth.users
--    such as handle_new_user via CASCADE)
do $$
declare r record;
begin
  for r in (
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ) loop
    execute 'drop function if exists public.' || quote_ident(r.proname) || '(' || r.args || ') cascade';
  end loop;
end $$;

-- 5) Drop any leftover sequences in public
do $$
declare r record;
begin
  for r in (select sequence_name from information_schema.sequences where sequence_schema = 'public') loop
    execute 'drop sequence if exists public.' || quote_ident(r.sequence_name) || ' cascade';
  end loop;
end $$;

-- Done. The public schema is now empty. Rebuild your tables from here.
