-- Consulta de solo lectura para ejecutar después de schema.sql en el proyecto nuevo.
select
  to_regclass('public.businesses') as businesses,
  to_regclass('public.memberships') as memberships,
  to_regclass('public.business_data') as business_data,
  to_regprocedure('private.is_business_member(uuid)') as membership_check,
  to_regprocedure('public.save_business_data(uuid,bigint,jsonb)') as guarded_save;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('businesses', 'memberships', 'business_data')
order by c.relname;
