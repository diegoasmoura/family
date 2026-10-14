import { QueryClient, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { Avatar } from '@fin/domain';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.details?.[0]?.message;
    throw new ApiError(res.status, detail ? `${data.error}: ${detail}` : (data.error ?? 'Erro inesperado'), data.details);
  }
  return data as T;
}

/** crypto.randomUUID só existe em contexto seguro; na rede local via http usa o fallback. */
export function clientUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export function useApi<T = any>(path: string | null, options: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path!),
    enabled: path !== null,
    ...options,
  });
}

/**
 * Qualquer escrita invalida todas as consultas: saldo, faturas, dashboard e
 * visão anual dependem dos mesmos lançamentos e precisam ficar consistentes.
 */
export function useAction<TVars = any, TRes = any>(fn: (vars: TVars) => Promise<TRes>, onSuccess?: (res: TRes, vars: TVars) => void) {
  const qc = useQueryClient();
  return useMutation<TRes, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: async (res, vars) => {
      await qc.invalidateQueries();
      onSuccess?.(res, vars);
    },
  });
}

export interface Me {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'member';
  household_id: number;
  household_name: string;
  timezone: string;
  today: string;
}

export interface Category {
  id: number;
  name: string;
  kind: 'income' | 'expense';
  parent_id: number | null;
  icon: string | null;
  color: string | null;
  archived: number;
}

export interface Account {
  id: number;
  name: string;
  type: string;
  initial_balance_cents: number;
  initial_balance_on: string;
  archived: number;
  current_balance_cents: number;
  forecast_balance_cents: number;
  month_closing_cents?: number | null;
}

export interface Invoice {
  id: number | null;
  reference_month: string;
  closing_date: string;
  due_date: string;
  total_cents: number;
  paid_cents: number;
  adjustment_cents?: number;
  installment_cents?: number;
  loose_cents?: number;
  credit_in_cents: number;
  due_cents: number;
  remaining_cents: number;
  credit_out_cents: number;
  state: 'future' | 'open' | 'closed' | 'overdue' | 'paid';
  state_label: string;
}

export interface Card {
  id: number;
  name: string;
  brand: string | null;
  closing_day: number;
  due_day: number;
  limit_cents: number;
  default_pay_account_id: number | null;
  color: string | null;
  archived: number;
  committed_cents: number;
  available_cents: number;
  used_ratio: number;
  posted_cents: number;
  pending_cents: number;
  credit_cents: number;
  current_invoice: Invoice | null;
}

export interface Tx {
  id: number;
  kind: 'income' | 'expense';
  description: string;
  amount_cents: number;
  occurred_on: string;
  due_on: string | null;
  paid_on: string | null;
  competence_month: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  parent_category_name: string | null;
  parent_category_color: string | null;
  account_id: number | null;
  account_name: string | null;
  card_id: number | null;
  card_name: string | null;
  invoice_id: number | null;
  invoice_due_on?: string | null;
  plan_id: number | null;
  installment_no: number | null;
  recurrence_id: number | null;
  for_user_id: number | null;
  for_user_name: string | null;
  status: 'planned' | 'posted';
  include_in_reports: number;
  overridden: number;
  deleted_at: string | null;
  /** paid, overdue, near (até 7 dias), planned. `card` permanece no tipo e não volta da API: a compra segue o vencimento da fatura. */
  display_status: 'paid' | 'overdue' | 'near' | 'planned' | 'card';
  status_label: string;
  recurrence_class: 'fixed' | 'installment' | 'variable';
  installment_label: string | null;
  /** 1 quando a fixa continua depois deste mês, ou ainda há parcela seguinte. */
  has_following: number;
}

export interface XpResult {
  xp: number;
  achievements: string[];
  level_up?: number;
}

export interface Member {
  id: number;
  name: string;
  me: boolean;
  level: number;
  total_xp: number;
  next_level_xp: number;
  ratio: number;
  title: string;
  avatar: Avatar;
}
