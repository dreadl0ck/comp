import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';
import { databaseTarget } from './e2e-database';

export default defineConfig({
  schema: fileURLToPath(new URL('../../../packages/db/prisma/schema', import.meta.url)),
  datasource: { url: databaseTarget(process.env).url },
});
