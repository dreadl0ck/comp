import { z } from 'zod';

const runId = z.string().regex(/^[a-f0-9]{16}$/);

export function databaseTarget(env: Record<string, string | undefined>) {
  const id = runId.parse(env.E2E_RUN_ID);
  const url = new URL(z.string().min(1).parse(env.E2E_DATABASE_URL));
  const schema = `e2e_${id}`;
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    !/^4217[0-9]$/.test(url.port) ||
    url.username !== 'comp_e2e' ||
    !url.password ||
    url.pathname !== `/comp_e2e_${id}` ||
    url.hash ||
    url.search !== `?schema=${schema}`
  )
    throw new Error(
      'Refusing database: require explicit run-owned loopback database/schema on 42170-42179',
    );
  return { id, schema, url: url.href };
}

export interface DatabaseCommands {
  execute: (sql: string) => Promise<unknown>;
  owner: () => Promise<string | undefined>;
}

export async function prepareSchema({
  target,
  db,
}: {
  target: ReturnType<typeof databaseTarget>;
  db: DatabaseCommands;
}) {
  // CREATE without IF NOT EXISTS is the ownership claim; never adopt an existing schema.
  await db.execute(`CREATE SCHEMA "${target.schema}"`);
  await db.execute(`COMMENT ON SCHEMA "${target.schema}" IS '${target.id}'`);
  if ((await db.owner()) !== target.id) throw new Error('Database ownership mismatch');
}
