import { SQL } from 'bun';
import { fileURLToPath } from 'node:url';
import { databaseTarget, prepareSchema } from './e2e-database';

const target = databaseTarget(process.env);
if (process.argv[2] === '--check') {
  console.log(`Validated disposable target ${target.schema}; no connection made`);
  process.exit(0);
}
if (process.argv.length > 2) throw new Error('Only --check is supported');
const connection = new URL(target.url);
connection.search = '';
const sql = new SQL({ url: connection.href, max: 1, connectionTimeout: 3 });
try {
  await prepareSchema({
    target,
    db: {
      execute: (statement) => sql.unsafe(statement),
      owner: async () => {
        const rows = await sql`SELECT obj_description(oid, 'pg_namespace') AS run_id
        FROM pg_namespace WHERE nspname = ${target.schema}`;
        return rows[0]?.run_id;
      },
    },
  });
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      'run',
      '--no-install',
      'prisma',
      'db',
      'push',
      '--config',
      fileURLToPath(new URL('./e2e-prisma.config.ts', import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        E2E_RUN_ID: target.id,
        E2E_DATABASE_URL: target.url,
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  if ((await child.exited) !== 0) throw new Error('Disposable schema push failed');
  console.log(
    `Prepared ${target.schema}; retain owner sentinel until explicit disposal of this database`,
  );
} finally {
  await sql.close();
}
