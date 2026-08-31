#!/usr/bin/env node
/**
 * Generates a prisma-client-js client to populate @prisma/client at node_modules.
 * Creates a temp schema dir, copies model files, generates with prisma-client-js.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const schemaDir = path.join(root, 'prisma/schema');
const configPath = path.join(root, 'prisma.config.ts');
const configBackup = configPath + '.bak';
const tempDir = fs.mkdtempSync(path.join(root, '.prisma-clientjs-'));

// Hide prisma.config.ts so prisma doesn't try to load it
const hasConfig = fs.existsSync(configPath);
if (hasConfig) fs.renameSync(configPath, configBackup);

try {
  // Copy model files
  for (const file of fs.readdirSync(schemaDir).filter(f => f.endsWith('.prisma') && f !== 'schema.prisma')) {
    fs.copyFileSync(path.join(schemaDir, file), path.join(tempDir, file));
  }

  // Write prisma-client-js generator schema
  //
  // AT-PATCH: the datasource needs a `url`. Prisma 6.19's generate runs full
  // schema validation and fails with P1012 "Argument url is missing in data
  // source block db" without one. The base prisma/schema.prisma legitimately
  // omits it (the driver-adapter generator takes the connection at runtime
  // from PrismaPg), and this script deliberately hides prisma.config.ts, so
  // nothing supplies it here.
  //
  // A literal placeholder rather than env("DATABASE_URL"): generate never
  // opens a connection, and a literal cannot fail at build time in an image
  // layer where DATABASE_URL is legitimately absent.
  fs.writeFileSync(path.join(tempDir, 'schema.prisma'), `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = "postgresql://placeholder/placeholder"
  extensions = [pgcrypto]
}
`);

  // Resolve prisma CLI via Node/Bun module resolution (handles hoisting)
  const prismaPackage = require.resolve('prisma/package.json');
  const prismaCli = path.join(path.dirname(prismaPackage), 'build', 'index.js');

  execFileSync(process.execPath, [prismaCli, 'generate', `--schema=${tempDir}`], {
    stdio: 'inherit',
    cwd: root,
  });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (hasConfig && fs.existsSync(configBackup)) fs.renameSync(configBackup, configPath);
}
