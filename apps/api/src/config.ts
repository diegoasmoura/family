export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  secureCookies: boolean;
  production: boolean;
  /** Fechado depois que as duas casas já existem no NAS. */
  allowRegister: boolean;
  /** Só para testes: fixa o "hoje" do household. */
  fixedToday?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const sessionSecret = env.SESSION_SECRET ?? (production ? '' : 'dev-secret-nao-usar-em-producao');
  if (production && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET precisa ter pelo menos 32 caracteres em produção');
  }
  return {
    port: Number(env.PORT ?? 3001),
    databaseUrl: env.DATABASE_URL ?? 'sqlite:./data/financas.db',
    sessionSecret,
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    production,
    allowRegister: env.ALLOW_REGISTER === undefined ? true : env.ALLOW_REGISTER === 'true',
    fixedToday: production ? undefined : env.FIXED_TODAY,
  };
}
