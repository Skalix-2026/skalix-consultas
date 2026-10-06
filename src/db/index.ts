import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definida no .env");

// Supabase: usar a connection string do pooler (porta 6543) com `prepare: false`.
const client = postgres(url, { prepare: false, max: 10 });
export const db = drizzle(client, { schema });
export type Db = typeof db;
