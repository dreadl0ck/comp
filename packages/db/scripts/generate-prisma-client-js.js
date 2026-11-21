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

  // Resolve prisma CLI via Node/Bun module resolution (handles hoisting)
  const prismaPackage = require.resolve('prisma/package.json');

  // AT-PATCH: whether the datasource may carry a `url` depends on the major
  // version of the prisma CLI that is actually resolved here, and this repo
  // resolves two different ones:
  //
  //   prisma 6.x -> `url` is REQUIRED. Without it, generate fails P1012
  //                 "Argument url is missing in data source block db".
  //   prisma 7.x -> `url` is REMOVED. With it, generate fails P1012
  //                 "The datasource property url is no longer supported in
  //                 schema files", directing you to prisma.config.ts.
  //
  // The workspace resolves prisma 7.6.0, so upstream's url-less schema is
  // correct in the app/portal/api builder stages. The migrator stage pins
  // prisma ^6.14.0 and needs the opposite. Emitting it conditionally is the
  // only form that works in both, and keeps this script usable from the
  // migrator without pulling the whole workspace in.
  //
  // A literal placeholder rather than env("DATABASE_URL"): generate never
  // opens a connection, and a literal cannot fail in an image layer where
  // DATABASE_URL is legitimately absent.
  const prismaMajor = parseInt(require(prismaPackage).version.split('.')[0], 10);
  const urlLine =
    prismaMajor < 7 ? '\n  url        = "postgresql://placeholder/placeholder"' : '';

  // Write prisma-client-js generator schema
  fs.writeFileSync(path.join(tempDir, 'schema.prisma'), `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"${urlLine}
  extensions = [pgcrypto]
}
`);

  const prismaCli = path.join(path.dirname(prismaPackage), 'build', 'index.js');

  execFileSync(process.execPath, [prismaCli, 'generate', `--schema=${tempDir}`], {
    stdio: 'inherit',
    cwd: root,
  });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (hasConfig && fs.existsSync(configBackup)) fs.renameSync(configBackup, configPath);
}
