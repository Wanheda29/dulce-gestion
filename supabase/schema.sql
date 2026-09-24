create extension if not exists pgcrypto;
create type public.subscription_status as enum ('active', 'grace', 'read_only', 'suspended');

create table public.businesses (
  id uuid primary key default gen_random_uuid(), name text not null,
  subscription_status public.subscription_status not null default 'active',
  grace_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.memberships (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('client', 'manager')),
  created_at timestamptz not null default now(), primary key (business_id, user_id)
);

create table public.business_data (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);

alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.business_data enable row level security;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_business_member(target_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where business_id = target_business and user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_business_member(uuid) from public;
grant execute on function private.is_business_member(uuid) to authenticated;

create policy "members read own membership" on public.memberships for select to authenticated using (user_id = auth.uid());
create policy "members read business status" on public.businesses for select to authenticated using (private.is_business_member(id));
create policy "members read permitted data" on public.business_data for select to authenticated using (
  private.is_business_member(business_id) and exists (
    select 1 from public.businesses where id = business_id and subscription_status in ('active', 'grace', 'read_only')
  )
);
create policy "members insert writable data" on public.business_data for insert to authenticated with check (
  private.is_business_member(business_id) and exists (
    select 1 from public.businesses where id = business_id and (
      subscription_status = 'active' or
      (subscription_status = 'grace' and grace_until > now())
    )
  )
);
create policy "members update writable data" on public.business_data for update to authenticated using (
  private.is_business_member(business_id) and exists (
    select 1 from public.businesses where id = business_id and (
      subscription_status = 'active' or
      (subscription_status = 'grace' and grace_until > now())
    )
  )
) with check (private.is_business_member(business_id));

revoke all on public.businesses, public.memberships, public.business_data from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.businesses, public.memberships to authenticated;
grant select, insert, update on public.business_data to authenticated;

create or replace function public.set_business_data_audit()
returns trigger language plpgsql security invoker as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end;
$$;
create trigger business_data_audit before insert or update on public.business_data
for each row execute function public.set_business_data_audit();

create or replace function public.save_business_data(
  p_business uuid, p_expected_revision bigint, p_data jsonb
)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if p_expected_revision = 0 then
    insert into public.business_data (business_id, data, revision)
    values (p_business, p_data, 1)
    on conflict (business_id) do nothing
    returning revision into next_revision;
  else
    update public.business_data
    set data = p_data, revision = revision + 1
    where business_id = p_business and revision = p_expected_revision
    returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'VERSION_CONFLICT: los datos cambiaron en otro dispositivo';
  end if;
  return next_revision;
end;
$$;
revoke all on function public.save_business_data(uuid, bigint, jsonb) from public;
grant execute on function public.save_business_data(uuid, bigint, jsonb) to authenticated;

-- Alta inicial desde el panel:
-- insert into public.businesses (name) values ('Emprendimiento') returning id;
-- insert into public.memberships (business_id, user_id) values ('NEGOCIO_UUID', 'USUARIO_UUID');
-- Cambiar subscription_status desde Table Editor para controlar el acceso.
