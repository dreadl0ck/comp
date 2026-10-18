import { SQL } from 'bun';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

// Re-exec before importing application code; Bun's automatic dotenv is disabled too.
if (process.argv[2] !== '--isolated') {
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', import.meta.path, '--isolated'],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  process.exit(await child.exited);
}
for (const key of Object.keys(process.env)) {
  if (key !== 'PATH' && key !== 'HOME') delete process.env[key];
}

const id = randomBytes(8).toString('hex');
const name = `comp-auth-${id}`;
const database = `comp_auth_${id}`;
const password = randomBytes(24).toString('hex');
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const revision = (await command(['git', 'rev-parse', 'HEAD'])).trim();
const port = 42410;
const origin = 'http://127.0.0.1:42411';
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: 'test',
  E2E_RUN_ID: id,
  E2E_REVISION: revision,
  E2E_DATABASE_URL: `postgresql://comp_e2e:${password}@127.0.0.1:${port}/${database}`,
  BASE_URL: origin,
  AUTH_TRUSTED_ORIGINS: origin,
  SECRET_KEY: randomBytes(32).toString('hex'),
};
const evidence = fileURLToPath(
  new URL(`../../test-results/auth-local/${id}/`, import.meta.url),
);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
writeFileSync(
  `${evidence}manifest.json`,
  JSON.stringify({ id, revision, database, origin, port, workers: 1 }),
  { mode: 0o600 },
);

async function command(
  args: string[],
  options: { input?: string; childEnv?: typeof env } = {},
) {
  const child = Bun.spawn(args, {
    cwd,
    env: options.childEnv ?? process.env,
    stdin: options.input === undefined ? 'ignore' : new Blob([options.input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`${args[0]} ${args[1]} failed (${code}): ${err}`);
  return out;
}

// Reserve both fixed ports before creating anything; never borrow another listener.
const reservations = [port, 42411].map((port) =>
  Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: () => new Response('', { status: 503 }),
  }),
);
reservations.forEach((server) => server.stop(true));
const dockerHost = (
  await command([
    'docker',
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
  ])
).trim();
if (!dockerHost.startsWith('unix:///'))
  throw new Error('Auth tests require a local Unix-socket Docker engine');
process.env.DOCKER_HOST = dockerHost;
let created = false;
let sql: SQL | undefined;
let worker: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;
function interrupt() {
  interrupted = true;
  worker?.kill('SIGTERM');
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  await command([
    'docker',
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `comp.auth.run=${id}`,
    '--label',
    `comp.auth.revision=${revision}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    '-e',
    'POSTGRES_USER=comp_e2e',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    `POSTGRES_DB=${database}`,
    'postgres:16.10@sha256:21f6013073bc6b92830a2129570e2f5ec42a6c734b5a985a41e83aa58f54c3c1',
  ]);
  created = true;
  const identity = await command([
    'docker',
    'inspect',
    '--format',
    '{{index .Config.Labels "comp.auth.run"}} {{index .Config.Labels "comp.auth.revision"}} {{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}',
    name,
  ]);
  if (identity.trim() !== `${id} ${revision} 127.0.0.1`)
    throw new Error('Container ownership mismatch');
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      await command([
        'docker',
        'exec',
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'comp_e2e',
        '-d',
        database,
      ]);
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await Bun.sleep(100);
    }
  }
  sql = new SQL({ url: env.E2E_DATABASE_URL, max: 1 });
  const [target] =
    await sql`SELECT current_database() AS db, current_user AS role`;
  if (target.db !== database || target.role !== 'comp_e2e')
    throw new Error('Wrong database identity');
  await sql.unsafe(`COMMENT ON DATABASE "${database}" IS '${id}:${revision}'`);
  const [owner] =
    await sql`SELECT shobj_description(oid, 'pg_database') AS owner
    FROM pg_database WHERE datname = current_database()`;
  if (owner.owner !== `${id}:${revision}`)
    throw new Error('Wrong database sentinel');
  // Use the canonical migration's function verbatim, then the current complete schema.
  const initial = await Bun.file(
    new URL(
      '../../../../packages/db/prisma/migrations/20250403163138_init/migration.sql',
      import.meta.url,
    ),
  ).text();
  const functions = initial.split('-- CreateEnum')[0];
  if (!functions.includes('$$ LANGUAGE plpgsql;'))
    throw new Error('Missing canonical ID function');
  await sql.unsafe(functions);
  await command(
    [
      process.execPath,
      '--no-env-file',
      '../../node_modules/prisma/build/index.js',
      'db',
      'push',
      '--config',
      'test/auth-local/prisma.config.ts',
    ],
    { childEnv: env },
  );
  if (interrupted) throw new Error('Auth run interrupted during setup');
  console.log(
    `integration-local run=${id} revision=${revision} db=${database} ports=42410,42411 workers=1`,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      'test',
      '--max-concurrency',
      '1',
      '--timeout',
      '30000',
      './test/auth-local/session.integration.ts',
    ],
    { cwd, env, stdout: 'pipe', stderr: 'pipe' },
  );
  worker = child;
  const timeout = setTimeout(interrupt, 60000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timeout);
  worker = undefined;
  const output = `${stdout}${stderr}`
    .replaceAll(password, '[redacted]')
    .replaceAll(env.SECRET_KEY, '[redacted]');
  writeFileSync(`${evidence}result.log`, output, { mode: 0o600 });
  console.log(output);
  console.log(`Private evidence: ${evidence}`);
  if (code !== 0 || interrupted)
    throw new Error(`Auth integration failed or interrupted; run=${id}`);
} finally {
  await sql?.close();
  if (created) {
    const owner = (
      await command([
        'docker',
        'inspect',
        '--format',
        '{{index .Config.Labels "comp.auth.run"}}',
        name,
      ])
    ).trim();
    if (owner !== id) throw new Error('Refusing to remove unowned container');
    await command(['docker', 'rm', '-f', '-v', name]);
    console.log(`Removed owned Postgres and anonymous volume: ${name}`);
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
