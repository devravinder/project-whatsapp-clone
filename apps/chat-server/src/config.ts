import { z } from "zod";

const list = z.string().transform((value) => value.split(",").map((item) => item.trim()));

const configSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  // Names this process in Redis routing once several servers run.
  SERVER_ID: z.string().min(1),
  CASSANDRA_CONTACT_POINTS: list,
  CASSANDRA_LOCAL_DC: z.string().min(1),
  CASSANDRA_KEYSPACE: z.string().min(1),
  REDIS_URL: z.url(),
  KAFKA_BROKERS: list,
});

export type AppConfig = z.infer<typeof configSchema>;

export const APP_CONFIG = Symbol("APP_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
