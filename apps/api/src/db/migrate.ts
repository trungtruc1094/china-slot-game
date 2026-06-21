import { createPostgresPool } from "./pool.js";
import { MigrationRunner } from "./migrations.js";

const command = process.argv[2] ?? "up";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(JSON.stringify({
    status: "error",
    code: "DATABASE_URL_REQUIRED",
    message: "DATABASE_URL is required to run database migrations."
  }));
  process.exit(1);
}

const pool = createPostgresPool(databaseUrl);
const runner = new MigrationRunner({ pool });

try {
  if (command === "up") {
    const status = await runner.migrateUp();
    console.log(JSON.stringify({ status: "ok", command, migrations: status }));
  } else if (command === "down") {
    const rawSteps = process.argv[3];
    const steps = rawSteps ? Number(rawSteps) : Number.POSITIVE_INFINITY;
    if (rawSteps && (!Number.isSafeInteger(steps) || steps <= 0)) {
      throw new Error("Migration down steps must be a positive integer when provided.");
    }
    const status = await runner.migrateDown(steps);
    console.log(JSON.stringify({ status: "ok", command, migrations: status }));
  } else if (command === "check") {
    await runner.assertReady();
    const status = await runner.status();
    console.log(JSON.stringify({ status: "ok", command, migrations: status }));
  } else {
    throw new Error("Migration command must be one of: up, down, check.");
  }
} catch (error) {
  console.error(JSON.stringify({
    status: "error",
    command,
    message: error instanceof Error ? error.message : String(error),
    details: typeof error === "object" && error !== null && "details" in error ? error.details : {}
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}