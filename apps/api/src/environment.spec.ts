import { validateEnvironment } from './environment';

const productionEnvironment = {
  NODE_ENV: 'production',
  PORT: '3000',
  WEB_ORIGIN: 'https://vozlivre.example.com',
  DATABASE_URL: 'postgresql://user:password@database.example.com:5432/vozlivre',
  REDIS_URL: 'rediss://redis.example.com:6379',
  LIVEKIT_URL: 'wss://livekit.example.com',
  LIVEKIT_API_KEY: 'production-key',
  LIVEKIT_API_SECRET: 'a-secure-livekit-secret-with-32-characters',
  JWT_SECRET: 'a-secure-jwt-secret-with-at-least-32-characters',
};

describe('validateEnvironment', () => {
  it('accepts a complete production configuration', () => {
    expect(validateEnvironment(productionEnvironment)).toMatchObject({
      NODE_ENV: 'production',
      PORT: 3000,
      TRUST_PROXY: false,
    });
  });

  it('rejects insecure public origins in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        WEB_ORIGIN: 'http://vozlivre.example.com',
      }),
    ).toThrow('WEB_ORIGIN deve usar HTTPS');
  });

  it('rejects production placeholder values', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        JWT_SECRET: 'CHANGE_ME_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
      }),
    ).toThrow('substitua todos os valores CHANGE_ME');
  });

  it('requires Redis for distributed realtime events in production', () => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment, REDIS_URL: undefined }),
    ).toThrow('REDIS_URL');
  });

  it('rejects the development LiveKit credentials in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'vozlivre-dev-secret-please-change-1234567890',
      }),
    ).toThrow('credenciais exclusivas do LiveKit');
  });
});
