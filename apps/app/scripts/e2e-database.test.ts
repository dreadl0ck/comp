import { describe, expect, test } from 'bun:test';
import { databaseTarget, prepareSchema } from './e2e-database';

const id = '0123456789abcdef';
const env = {
  E2E_RUN_ID: id,
  E2E_DATABASE_URL: `postgresql://comp_e2e:fixture@127.0.0.1:42179/comp_e2e_${id}?schema=e2e_${id}`,
};

describe('disposable database preflight', () => {
  test('explicit target is accepted despite ambient DATABASE_URL', () => {
    expect(
      databaseTarget({ ...env, DATABASE_URL: 'postgresql://production.invalid/customer' }).id,
    ).toBe(id);
  });
  test.each([
    {},
    { E2E_RUN_ID: id, DATABASE_URL: env.E2E_DATABASE_URL },
    { ...env, E2E_RUN_ID: '../public' },
    ...[
      ['127.0.0.1', 'production.invalid'],
      ['42179', '5432'],
      ['comp_e2e:', 'postgres:'],
      [`/comp_e2e_${id}`, '/customer'],
      [`schema=e2e_${id}`, 'schema=public'],
      ['?schema=', '?host=evil&schema='],
      ['postgresql:', 'postgres:'],
      ['fixture@', '@'],
      [`schema=e2e_${id}`, `schema=e2e_${id}&sslmode=disable`],
    ].map(([from, to]) => ({ ...env, E2E_DATABASE_URL: env.E2E_DATABASE_URL.replace(from, to) })),
  ])('rejects unsafe or missing configuration %#', (candidate) => {
    expect(() => databaseTarget(candidate)).toThrow();
  });
  test('existing schema aborts before sentinel write or Prisma invocation', async () => {
    const statements: string[] = [];
    await expect(
      prepareSchema({
        target: databaseTarget(env),
        db: {
          execute: async (sql) => {
            statements.push(sql);
            throw new Error('schema already exists');
          },
          owner: async () => id,
        },
      }),
    ).rejects.toThrow('schema already exists');
    expect(statements).toEqual([`CREATE SCHEMA "e2e_${id}"`]);
  });
  test('mismatched ownership fails and never drops anything', async () => {
    const statements: string[] = [];
    await expect(
      prepareSchema({
        target: databaseTarget(env),
        db: {
          execute: async (sql) => {
            statements.push(sql);
          },
          owner: async () => 'another-run',
        },
      }),
    ).rejects.toThrow('ownership mismatch');
    expect(statements.some((sql) => /DROP|DELETE|IF NOT EXISTS/.test(sql))).toBe(false);
  });
});
