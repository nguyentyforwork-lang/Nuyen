import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbConfig } from "@/lib/config";
import * as schema from "./schema";

let db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb() {
  if (!db) {
    const sql = postgres(getDbConfig().DATABASE_URL, { max: 10 });
    db = drizzle(sql, { schema });
  }
  return db;
}

export type Db = ReturnType<typeof getDb>;
