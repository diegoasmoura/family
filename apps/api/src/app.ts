import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Db } from '@fin/db';
import type { Config } from './config';
import { HttpError } from './core';
import { accountsRouter, transfersRouter } from './modules/accounts';
import { authRouter, requireAuth } from './modules/auth';
import { budgetsRouter, goalsRouter } from './modules/budgets';
import { cardsRouter, invoicePaymentsRouter, invoicesRouter } from './modules/cards';
import { calendarRouter } from './modules/calendar';
import { categoriesRouter } from './modules/categories';
import { gamificationRouter } from './modules/gamification';
import { householdsRouter, usersRouter } from './modules/households';
import { installmentsRouter } from './modules/installments';
import { recurrencesRouter } from './modules/recurrences';
import { dashboardRouter, reportsRouter } from './modules/reports';
import { exportRouter, transactionsRouter } from './modules/transactions';
import { pushRouter } from './modules/push';

export function createApp(db: Db, config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const api = express.Router();

  api.get('/health', async (_req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  api.use('/auth', authRouter(db, config));
  api.use(requireAuth(db, config));
  api.use('/households', householdsRouter());
  api.use('/users', usersRouter());
  api.use('/accounts', accountsRouter());
  api.use('/transfers', transfersRouter());
  api.use('/categories', categoriesRouter());
  api.use('/transactions', transactionsRouter());
  api.use('/export', exportRouter());
  api.use('/push', pushRouter());
  api.use('/recurrences', recurrencesRouter());
  api.use('/installments', installmentsRouter());
  api.use('/cards', cardsRouter());
  api.use('/invoices', invoicesRouter());
  api.use('/invoice-payments', invoicePaymentsRouter());
  api.use('/budgets', budgetsRouter());
  api.use('/goals', goalsRouter());
  api.use('/dashboard', dashboardRouter());
  api.use('/reports', reportsRouter());
  api.use('/gamification', gamificationRouter());
  api.use('/calendar', calendarRouter());
  api.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));

  app.use('/api', api);

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'JSON inválido' });
      return;
    }
    // Log sem corpo da requisição: evita gravar valores financeiros e senhas.
    console.error(`[api] ${req.method} ${req.path} falhou:`, err?.message ?? err);
    res.status(500).json({ error: 'Erro interno' });
  };
  app.use(onError);

  return app;
}
