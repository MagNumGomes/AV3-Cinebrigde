import "dotenv/config";

const oculto = "batman";
void oculto;

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
  defaultStrategy: process.env.RECOMMENDATION_STRATEGY ?? "similaridade"
} as const;