import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createProductionDependencies, shouldUsePostgresPersistence } from "./composition/production-dependencies.js";
import { JoseTeviAuthVerifier } from "./domain/tevi-auth-adapter.js";
import { CashoutRequestService } from "./domain/cashout-request-service.js";
import { TeviPaymentClient } from "./domain/tevi-payment-client.js";
import { TeviTokenService } from "./domain/tevi-token-service.js";
import { TopupService } from "./domain/topup-service.js";
import { TeviWebhookService } from "./domain/tevi-webhook-service.js";
import { TeviWebhookCashoutReconciliation } from "./domain/tevi-webhook-cashout-reconciliation.js";

const env = loadEnv();
let productionDependencies: Awaited<ReturnType<typeof createProductionDependencies>> | undefined;
try {
  productionDependencies = shouldUsePostgresPersistence(env)
    ? await createProductionDependencies(env)
    : undefined;
} catch (error) {
  console.error("[api] production startup failed", {
    nodeEnv: env.nodeEnv,
    persistenceMode: env.persistenceMode,
    code: typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}
const appDependencies = productionDependencies?.appDependencies ?? {};
const app = createApp(env.teviAuth.enabled
  ? {
      ...appDependencies,
      teviAuthVerifier: new JoseTeviAuthVerifier(env.teviAuth),
      ...(env.teviAuth.tokenExchange.enabled
        ? {
            teviTokenService: new TeviTokenService({ appId: env.teviAuth.appId, apiBase: env.teviAuth.tokenExchange.apiBase }),
            teviSessionAuthMode: env.teviAuth.tokenExchange.sessionAuthMode
          }
        : {}),
      ...(env.teviAuth.payment.enabled && productionDependencies?.topupSignatureIssuanceRepository
        ? {
            topupService: new TopupService(
              {
                appId: env.teviAuth.appId,
                billingChannelId: env.teviAuth.payment.billingChannelId,
                depositMinStars: env.teviAuth.payment.depositMinStars,
                depositMaxStars: env.teviAuth.payment.depositMaxStars
              },
              new TeviPaymentClient({
                apiBase: env.teviAuth.payment.apiBase,
                depositTokenPath: env.teviAuth.payment.depositTokenPath,
                cashoutPath: env.teviAuth.payment.cashoutPath,
                apiKey: env.teviAuth.payment.apiKey,
                secretKey: env.teviAuth.payment.secretKey
              }),
              productionDependencies.topupSignatureIssuanceRepository
            )
          }
        : {}),
      ...(env.teviAuth.payment.enabled && productionDependencies?.cashoutRequestRepository
        ? {
            cashoutService: new CashoutRequestService(
              productionDependencies.cashoutRequestRepository,
              new TeviPaymentClient({
                apiBase: env.teviAuth.payment.apiBase,
                depositTokenPath: env.teviAuth.payment.depositTokenPath,
                cashoutPath: env.teviAuth.payment.cashoutPath,
                apiKey: env.teviAuth.payment.apiKey,
                secretKey: env.teviAuth.payment.secretKey
              })
            )
          }
        : {}),
      ...(env.teviAuth.payment.enabled && env.teviAuth.payment.webhookSecret && productionDependencies?.teviWebhookCreditRepository
        ? {
            teviWebhookSecret: env.teviAuth.payment.webhookSecret,
            teviWebhookService: new TeviWebhookService({
              idempotencyRepository: productionDependencies.providerTopUpIdempotencyRepository,
              creditPort: productionDependencies.teviWebhookCreditRepository,
              playerLookup: productionDependencies.playerSessionRepository,
              ...(productionDependencies.cashoutRequestRepository
                ? {
                    cashoutReconciliation: new TeviWebhookCashoutReconciliation(
                      productionDependencies.providerTopUpIdempotencyRepository,
                      productionDependencies.cashoutRequestRepository
                    )
                  }
                : {})
            })
          }
        : {})
    }
  : appDependencies);
const server = createServer(app);
let shutdownStarted = false;

async function shutdownProductionDependencies(): Promise<void> {
  if (!productionDependencies || shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  await productionDependencies.shutdown();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
      server.close((error) => {
      if (error) {
        console.error("[api] server shutdown failed", error);
        process.exitCode = 1;
      }
        shutdownProductionDependencies().catch((shutdownError: unknown) => {
          console.error("[api] PostgreSQL pool shutdown failed", shutdownError);
          process.exitCode = 1;
        });
    });
  });
}

server.listen(env.port, () => {
  console.log(`china-slot-api listening on ${env.port} (${env.nodeEnv})`);
});
