import { defineConfig } from 'prisma/config';
import { fileURLToPath } from 'node:url';

const id = process.env.E2E_RUN_ID;
const url = new URL(process.env.E2E_DATABASE_URL ?? '');
if (
  !id?.match(/^[a-f0-9]{16}$/) ||
  url.protocol !== 'postgresql:' ||
  url.hostname !== '127.0.0.1' ||
  url.port !== '42410' ||
  url.username !== 'comp_e2e' ||
  !url.password ||
  url.pathname !== `/comp_auth_${id}` ||
  url.search ||
  url.hash ||
  process.env.DATABASE_URL
)
  throw new Error('Refusing unowned auth database');

export default defineConfig({
  schema: fileURLToPath(
    new URL('../../../../packages/db/prisma/schema', import.meta.url),
  ),
  datasource: { url: url.href },
});
