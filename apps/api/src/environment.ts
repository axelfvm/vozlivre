import Joi from 'joi';

const DEVELOPMENT_JWT_SECRET =
  'vozlivre-local-jwt-secret-change-before-production';
const DEVELOPMENT_LIVEKIT_SECRET =
  'vozlivre-dev-secret-please-change-1234567890';

const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  WEB_ORIGIN: Joi.string().default('http://localhost:5173'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  LIVEKIT_URL: Joi.string()
    .uri({ scheme: ['ws', 'wss', 'http', 'https'] })
    .default('ws://localhost:7880'),
  LIVEKIT_API_KEY: Joi.string().min(3).default('devkey'),
  LIVEKIT_API_SECRET: Joi.string().min(32).default(DEVELOPMENT_LIVEKIT_SECRET),
  JWT_SECRET: Joi.string().min(32).default(DEVELOPMENT_JWT_SECRET),
  TRUST_PROXY: Joi.boolean().default(false),
}).unknown(true);

export type Environment = Record<string, unknown> & {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  WEB_ORIGIN: string;
  DATABASE_URL: string;
  REDIS_URL?: string;
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  JWT_SECRET: string;
  TRUST_PROXY: boolean;
};

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const result = schema.validate(input, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });
  if (result.error) {
    throw new Error(`Configuração inválida: ${result.error.message}`);
  }

  const environment = result.value as Environment;
  const origins = parseWebOrigins(environment.WEB_ORIGIN);
  if (!origins.length) {
    throw new Error(
      'Configuração inválida: WEB_ORIGIN deve conter ao menos uma URL.',
    );
  }

  if (environment.NODE_ENV === 'production') {
    const productionSecrets = [
      environment.DATABASE_URL,
      environment.JWT_SECRET,
      environment.LIVEKIT_API_KEY,
      environment.LIVEKIT_API_SECRET,
    ];
    if (productionSecrets.some((value) => value.includes('CHANGE_ME'))) {
      throw new Error(
        'Configuração inválida: substitua todos os valores CHANGE_ME em produção.',
      );
    }
    if (environment.JWT_SECRET === DEVELOPMENT_JWT_SECRET) {
      throw new Error(
        'Configuração inválida: defina um JWT_SECRET exclusivo em produção.',
      );
    }
    if (
      environment.LIVEKIT_API_KEY === 'devkey' ||
      environment.LIVEKIT_API_SECRET === DEVELOPMENT_LIVEKIT_SECRET
    ) {
      throw new Error(
        'Configuração inválida: defina credenciais exclusivas do LiveKit em produção.',
      );
    }
    if (!origins.every((origin) => origin.startsWith('https://'))) {
      throw new Error(
        'Configuração inválida: WEB_ORIGIN deve usar HTTPS em produção.',
      );
    }
    if (!environment.LIVEKIT_URL.startsWith('wss://')) {
      throw new Error(
        'Configuração inválida: LIVEKIT_URL deve usar WSS em produção.',
      );
    }
  }

  return environment;
}

export function parseWebOrigins(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => {
      try {
        const url = new URL(origin);
        return (
          url.origin === origin && ['http:', 'https:'].includes(url.protocol)
        );
      } catch {
        return false;
      }
    });
}

export function websocketOriginAllowed(origin?: string): boolean {
  if (!origin) return true;
  return parseWebOrigins(
    process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  ).includes(origin.replace(/\/$/, ''));
}
