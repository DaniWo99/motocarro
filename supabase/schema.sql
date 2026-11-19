-- ============================================================================
-- MI MOTOCARRO — ESQUEMA DE BASE DE DATOS PARA SUPABASE (PostgreSQL + RLS)
-- ============================================================================
-- Instrucciones:
-- 1. Abre tu proyecto en Supabase -> SQL Editor -> New query.
-- 2. Pega todo este archivo y pulsa "Run".
-- 3. Todas las tablas quedan protegidas con Row Level Security (RLS):
--    solo tu usuario autenticado podrá leer, crear, editar o eliminar registros.
-- ============================================================================

-- 1. INGRESOS DIARIOS
create table if not exists public.incomes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  worked boolean not null default true,
  note text not null default '',
  edit_history jsonb not null default '[]'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

-- 2. GASTOS OPERATIVOS
create table if not exists public.expenses (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  description text not null default '',
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. PAGOS DE CUOTAS Y ABONOS EXTRAORDINARIOS DEL PRÉSTAMO RAPPI
create table if not exists public.loan_payments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  installment_number integer, -- 1..36 para cuotas, NULL para abono extraordinario independiente
  payment_type text not null check (payment_type in ('installment', 'extra_capital')),
  payment_date date not null,
  amount_paid numeric(14,2) not null check (amount_paid > 0),
  contractual_amount numeric(14,2) not null default 0,
  applied_to_installment numeric(14,2) not null default 0,
  excess_amount numeric(14,2) not null default 0,
  excess_application text not null default 'none' check (excess_application in ('none', 'extra_capital', 'next_installment', 'other_charges')),
  extra_capital_amount numeric(14,2) not null default 0,
  note text not null default '',
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. CONFIGURACIÓN DEL USUARIO (HORARIO, TARIFAS, REGLA DICIEMBRE, PRÉSTAMO)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 5. ÍNDICES PARA CONSULTAS RÁPIDAS
create index if not exists idx_incomes_user_date on public.incomes (user_id, date desc);
create index if not exists idx_expenses_user_date on public.expenses (user_id, date desc);
create index if not exists idx_loan_payments_user_date on public.loan_payments (user_id, payment_date desc);

-- 6. ACTIVAR ROW LEVEL SECURITY (SEGURIDAD POR FILA)
alter table public.incomes enable row level security;
alter table public.expenses enable row level security;
alter table public.loan_payments enable row level security;
alter table public.user_settings enable row level security;

-- 7. POLÍTICAS DE SEGURIDAD ESTRICTAS (SOLO EL PROPIETARIO)
drop policy if exists "incomes_owner_all" on public.incomes;
create policy "incomes_owner_all" on public.incomes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "expenses_owner_all" on public.expenses;
create policy "expenses_owner_all" on public.expenses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "loan_payments_owner_all" on public.loan_payments;
create policy "loan_payments_owner_all" on public.loan_payments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_settings_owner_all" on public.user_settings;
create policy "user_settings_owner_all" on public.user_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
