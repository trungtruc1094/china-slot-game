import { createPostgresPool } from "../db/pool.js";
import { PostgresGameConfigurationRepository } from "../repositories/postgres/game-configuration-repository.js";
import { seedActiveConfigRepository } from "./seed-active-config.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(JSON.stringify({
    status: "error",
    code: "DATABASE_URL_REQUIRED",
    message: "DATABASE_URL is required to seed the active PostgreSQL game configuration."
  }));
  process.exit(1);
}

const pool = createPostgresPool(databaseUrl);

try {
  const repository = new PostgresGameConfigurationRepository(pool);
  const status = await seedActiveConfigRepository(repository);
  console.log(JSON.stringify({ status: "ok", seed: status }));
} catch (error) {
  console.error(JSON.stringify({
    status: "error",
    message: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}