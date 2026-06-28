import { Router } from "express";
import { errorEnvelope } from "../schemas/api-envelope.js";

const maxChallengeLength = 1024;

export function createTeviWebhookRouter(): Router {
  const router = Router();

  router.post("/webhooks/tevi", (request, response) => {
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

    console.info("[tevi-webhook] event rejected before signature verification", {
      requestId: request.requestId,
      event: getEventName(request.body),
      hasSignatureHeader: typeof request.header("X-Tevi-Signature") === "string"
    });

    response.status(501).json(errorEnvelope({
      code: "TEVI_WEBHOOK_PROCESSING_NOT_IMPLEMENTED",
      message: "Tevi webhook event processing requires signature verification in a later story.",
      details: {
        expectedHeader: "X-Tevi-Signature"
      }
    }, request.requestId));
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