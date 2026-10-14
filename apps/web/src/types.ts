export interface Goal {
  id: number;
  name: string;
  target_cents: number;
  saved_cents: number;
  deadline: string | null;
  completed_at: string | null;
  progress: number;
}

export interface BudgetItem {
  category_id: number;
  name: string;
  parent_id: number | null;
  budget_id: number | null;
  planned_cents: number | null;
  spent_cents: number;
}

export interface Recurrence {
  id: number;
  kind: 'income' | 'expense';
  description: string;
  amount_cents: number;
  day_of_month: number;
  start_month: string;
  end_month: string | null;
  active: boolean;
  account_name: string | null;
  card_name: string | null;
}

export interface InstallmentPlan {
  id: number;
  description: string;
  total_cents: number;
  installments: number;
  settled_count: number;
  active_count: number;
  remaining_cents: number;
  purchased_on: string;
  card_name: string | null;
  account_name: string | null;
}

export interface Transfer {
  id: number;
  occurred_on: string;
  amount_cents: number;
  from_account_name: string;
  to_account_name: string;
}

export interface HouseUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'member';
}
