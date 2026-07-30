/**
 * Local Postgres without Docker.
 *
 * Runs a real Postgres server from the binaries vendored by `embedded-postgres` — the
 * same `postgres.exe`/`postgres` the official distribution ships, not an emulation. That
 * matters for this project specifically: the tenancy work depends on Row Level Security,
 * `CREATE ROLE`, `SET ROLE`, `pgcrypto` and native `uuidv7()`, none of which an in-memory
 * Postgres substitute implements faithfully. A test suite whose whole purpose is proving
 * tenant isolation must not run against an approximation of the thing enforcing it.
 *
 * Requires no Docker, no system install, and no administrator rights: the binaries live
 * in node_modules and the data directory lives in the repo, both owned by the current
 * user.
 *
 * Usage:
 *   pnpm db:up        start (initialising on first run)
 *   pnpm db:down      stop
 *   pnpm db:status    report
 *   pnpm db:nuke      delete the cluster and start over
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const DATA_DIR = path.join(REPO_ROOT, '.local', 'postgres');
const LOG_FILE = path.join(REPO_ROOT, '.local', 'postgres.log');

/** Kept in sync with .env.example so a fresh clone works with no edits. */
const SUPERUSER = 'mgc';
const PASSWORD = 'mgc_local_dev';
const DATABASE = 'my_gym_control';

/** Port comes from DATABASE_URL when present, so the two cannot disagree. */
function resolvePort(): number {
  const url = process.env['DATABASE_URL'];
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.port) return Number(parsed.port);
    } catch {
      // Fall through to the default; the env schema reports malformed URLs properly.
    }
  }
  return 5432;
}

const PORT = resolvePort();

/**
 * Locates the vendored binaries.
 *
 * `embedded-postgres` publishes one optional dependency per platform and only the
 * matching one is installed, so the package name is derived rather than hardcoded.
 */
function binDir(): string {
  const platformKey = (() => {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    switch (process.platform) {
      case 'win32':
        return `windows-${arch}`;
      case 'darwin':
        return `darwin-${arch}`;
      case 'linux':
        return `linux-${arch}`;
      default:
        throw new Error(`Unsupported platform for local Postgres: ${process.platform}`);
    }
  })();

  const specifier = `@embedded-postgres/${platformKey}`;
  const selfRequire = createRequire(import.meta.filename);

  /**
   * Two obstacles, both consequences of correct packaging rather than bugs:
   *
   *  1. The platform package is an *optional dependency of `embedded-postgres`*, not of
   *     this package. Under pnpm's isolated node_modules it is therefore not resolvable
   *     from here — a package may only import what it declares. Resolution is retried
   *     from `embedded-postgres`'s own location, where it genuinely is a dependency.
   *
   *  2. Its `exports` field is the bare string `"./dist/index.js"`, which exports the
   *     root entry and nothing else. Asking for `/package.json` fails with
   *     ERR_PACKAGE_PATH_NOT_EXPORTED, so the package root is found by resolving the
   *     entry point and walking up to the directory that actually holds `native/bin`.
   */
  const attempts: Array<() => string> = [
    () => selfRequire.resolve(specifier),
    () => createRequire(selfRequire.resolve('embedded-postgres')).resolve(specifier),
  ];

  for (const attempt of attempts) {
    let entry: string;
    try {
      entry = attempt();
    } catch {
      continue;
    }

    // dist/index.js -> dist -> package root. Bounded walk rather than a fixed `..` so a
    // change to the package's internal layout does not silently produce a wrong path.
    let dir = path.dirname(entry);
    for (let depth = 0; depth < 4; depth += 1) {
      const candidate = path.join(dir, 'native', 'bin');
      if (existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
  }

  throw new Error(
    `Postgres binaries for ${platformKey} are not installed, or the package layout ` +
      'changed. Run `pnpm install` at the repository root. If the postinstall was ' +
      'skipped, check that `allowBuilds` in pnpm-workspace.yaml permits ' +
      `@embedded-postgres/${platformKey}.`,
  );
}

const exe = (name: string): string =>
  path.join(binDir(), process.platform === 'win32' ? `${name}.exe` : name);

function run(command: string, args: string[]): { code: number; output: string } {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { code: result.status ?? 1, output };
}

// ---------------------------------------------------------------------------

function isInitialised(): boolean {
  return existsSync(path.join(DATA_DIR, 'PG_VERSION'));
}

function initialise(): void {
  mkdirSync(path.dirname(DATA_DIR), { recursive: true });

  // initdb takes the superuser password from a file rather than an argument, so it
  // never appears in the process list.
  const pwFile = path.join(os.tmpdir(), `mgc-initdb-${process.pid}`);
  writeFileSync(pwFile, PASSWORD, { encoding: 'utf8', mode: 0o600 });

  try {
    console.log('Initialising a new Postgres cluster (first run only)...');

    // ICU collation, matching the Docker path, so ORDER BY behaves identically in
    // local dev, CI and production instead of depending on the host's locale.
    const args = [
      '-D', DATA_DIR,
      '-U', SUPERUSER,
      `--pwfile=${pwFile}`,
      '--auth=scram-sha-256',
      '--auth-host=scram-sha-256',
      '--encoding=UTF8',
      '--locale-provider=icu',
      '--icu-locale=en-US',
    ];

    let result = run(exe('initdb'), args);

    if (result.code !== 0) {
      // Some builds ship without the ICU data files. A libc locale still produces a
      // working cluster; it is only collation determinism across hosts that is lost,
      // so this degrades rather than failing.
      console.warn('ICU locale unavailable, falling back to the default locale provider.');
      rmSync(DATA_DIR, { recursive: true, force: true });
      result = run(exe('initdb'), [
        '-D', DATA_DIR,
        '-U', SUPERUSER,
        `--pwfile=${pwFile}`,
        '--auth=scram-sha-256',
        '--auth-host=scram-sha-256',
        '--encoding=UTF8',
      ]);
    }

    if (result.code !== 0) {
      throw new Error(`initdb failed:\n${result.output}`);
    }

    // Bind to loopback only. A development database must not be reachable from the
    // network, and this cluster holds real-shaped member data during testing.
    const confPath = path.join(DATA_DIR, 'postgresql.conf');
    const conf = readFileSync(confPath, 'utf8');
    writeFileSync(
      confPath,
      `${conf}\n# --- MY GYM CONTROL local development ---\nlisten_addresses = 'localhost'\nport = ${PORT}\n`,
      'utf8',
    );

    console.log('Cluster initialised.');
  } finally {
    rmSync(pwFile, { force: true });
  }
}

function isRunning(): boolean {
  return run(exe('pg_ctl'), ['status', '-D', DATA_DIR]).code === 0;
}

async function ensureDatabase(): Promise<void> {
  const client = new Client({
    host: 'localhost',
    port: PORT,
    user: SUPERUSER,
    password: PASSWORD,
    database: 'postgres',
  });

  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DATABASE,
    ]);
    if (rowCount === 0) {
      // CREATE DATABASE cannot be parameterised; the identifier is a constant defined
      // in this file, not user input.
      await client.query(`CREATE DATABASE "${DATABASE}"`);
      console.log(`Created database "${DATABASE}".`);
    }
  } finally {
    await client.end();
  }
}

async function waitUntilAccepting(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new Client({
      host: 'localhost',
      port: PORT,
      user: SUPERUSER,
      password: PASSWORD,
      database: 'postgres',
      connectionTimeoutMillis: 2_000,
    });
    try {
      await client.connect();
      // Answering a query is a stronger claim than accepting a socket, which is the
      // same distinction the API's readiness probe makes.
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  throw new Error(
    `Postgres did not become ready within ${timeoutMs}ms. Last error: ${String(lastError)}\n` +
      `Server log: ${LOG_FILE}`,
  );
}

async function start(): Promise<void> {
  if (!isInitialised()) initialise();

  if (isRunning()) {
    console.log(`Postgres is already running on port ${PORT}.`);
  } else {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // pg_ctl detaches the server and returns, so it keeps running after this script
    // exits — the behaviour `docker compose up -d` provided.
    const result = run(exe('pg_ctl'), [
      'start',
      '-D', DATA_DIR,
      '-l', LOG_FILE,
      '-w',
      '-o', `-p ${PORT}`,
    ]);
    if (result.code !== 0) {
      throw new Error(`pg_ctl start failed:\n${result.output}\nServer log: ${LOG_FILE}`);
    }
  }

  await waitUntilAccepting();
  await ensureDatabase();

  console.log(`\nPostgres ready:  postgresql://${SUPERUSER}:***@localhost:${PORT}/${DATABASE}`);
  console.log(`Data directory:  ${DATA_DIR}`);
  console.log(`Server log:      ${LOG_FILE}`);
}

function stop(): void {
  if (!isInitialised() || !isRunning()) {
    console.log('Postgres is not running.');
    return;
  }
  // -m fast rolls back open transactions and shuts down promptly, rather than waiting
  // for clients to disconnect on their own.
  const result = run(exe('pg_ctl'), ['stop', '-D', DATA_DIR, '-m', 'fast', '-w']);
  if (result.code !== 0) throw new Error(`pg_ctl stop failed:\n${result.output}`);
  console.log('Postgres stopped.');
}

function status(): void {
  if (!isInitialised()) {
    console.log('Not initialised. Run `pnpm db:up`.');
    return;
  }
  const result = run(exe('pg_ctl'), ['status', '-D', DATA_DIR]);
  console.log(result.output || (result.code === 0 ? 'running' : 'stopped'));
  console.log(`Port: ${PORT}`);
}

function nuke(): void {
  if (isInitialised() && isRunning()) stop();
  rmSync(path.join(REPO_ROOT, '.local'), { recursive: true, force: true });
  console.log('Local cluster deleted. Run `pnpm db:up` to recreate it.');
}

// ---------------------------------------------------------------------------

const command = process.argv[2] ?? 'start';

try {
  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      stop();
      break;
    case 'status':
      status();
      break;
    case 'nuke':
      nuke();
      break;
    default:
      console.error(`Unknown command "${command}". Use start | stop | status | nuke.`);
      process.exit(1);
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
