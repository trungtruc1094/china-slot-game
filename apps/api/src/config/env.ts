import "dotenv/config";

export interface ApiEnv {
  nodeEnv: string;
  port: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const rawPort = source.PORT ?? "3000";
  const parsedPort = Number(rawPort);

  if (!Number.isSafeInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    nodeEnv: source.NODE_ENV ?? "development",
    port: parsedPort
  };
}
