import { Router } from "express";
import type { TeviWebhookServicePort } from "../domain/tevi-webhook-service.js";
import { verifyTeviWebhookSignature } from "../domain/tevi-webhook-signature.js";
import { errorEnvelope, okEnvelope } from "../schemas/api-envelope.js";

const maxChallengeLength = 1024;
const signatureHeader = "X-Tevi-Signature";

export interface TeviWebhookRouterDeps {
  webhookSecret: string;
  webhookService: TeviWebhookServicePort;
}

// When deps are absent (memory/dev without payment+postgres or no webhook secret) the route keeps the safe
// challenge echo plus a 501 placeholder for events, so existing tests and local dev keep working unchanged.
export function createTeviWebhookRouter(deps?: TeviWebhookRouterDeps): Router {
  const router = Router();

  router.post("/webhooks/tevi", async (request, response, next) => {
    const queryChallenge = getChallenge(request.query.challenge);
    const bodyChallenge = getChallenge(request.body?.challenge);
    const challenge = queryChallenge ?? bodyChallenge;
    if (challenge) {
      if (challenge.length > maxChallengeLength) {
        response.status(400).json(errorEnvelope({
          code: "TEVI_WEBHOOK_CHALLENGE_TOO_LONG",
          message: "Tevi webhook challenge exceeds the allowed length.",
          details: {
            maxLength: maxChallengeLength
          }
        }, request.requestId));
        return;
      }

      console.info("[tevi-webhook] challenge verification", {
        requestId: request.requestId,
        source: queryChallenge ? "query" : "body",
        challengeLength: challenge.length
      });
      response.type("text/plain").send(challenge);
      return;
    }

    if (!deps) {
      console.info("[tevi-webhook] event rejected before signature verification", {
        requestId: request.requestId,
        event: getEventName(request.body),
        hasSignatureHeader: typeof request.header(signatureHeader) === "string"
      });

      response.status(501).json(errorEnvelope({
        code: "TEVI_WEBHOOK_PROCESSING_NOT_IMPLEMENTED",
        message: "Tevi webhook event processing requires signature verification in a later story.",
        details: {
          expectedHeader: signatureHeader
        }
      }, request.requestId));
      return;
    }

    // Verify the signature BEFORE parsing effects or touching any wallet (AC1). A missing/invalid signature is
    // rejected with HTTP 401 (per Tevi docs), no idempotency record write, no wallet mutation.
    const verification = verifyTeviWebhookSignature(deps.webhookSecret, request.body, request.header(signatureHeader));
    if (!verification.ok) {
      console.warn("[tevi-webhook] signature verification failed", {
        requestId: request.requestId,
        event: getEventName(request.body),
        reasonCode: verification.reasonCode
      });
      response.status(401).json(errorEnvelope({
        code: "TEVI_WEBHOOK_SIGNATURE_INVALID",
        message: "Tevi webhook signature verification failed.",
        details: {
          expectedHeader: signatureHeader,
          reasonCode: verification.reasonCode
        }
      }, request.requestId));
      return;
    }

    try {
      const result = await deps.webhookService.process({ payload: request.body, requestId: request.requestId });
      // Terminal outcomes (credited, replayed, ignored, failed, duplicate) are durably recorded and return 200
      // so an undocumented Tevi redelivery stays idempotent and safe. Genuinely transient errors throw → 5xx.
      response.status(200).json(okEnvelope({
        status: result.status,
        reasonCode: result.reasonCode
      }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function getChallenge(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) return value[0];
  return null;
}

function getEventName(body: unknown): string {
  if (typeof body === "object" && body !== null && "event" in body && typeof body.event === "string") {
    return body.event;
  }
  return "unknown";
}
