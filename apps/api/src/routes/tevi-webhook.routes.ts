import { Router } from "express";
import { errorEnvelope } from "../schemas/api-envelope.js";

export function createTeviWebhookRouter(): Router {
  const router = Router();

  router.post("/webhooks/tevi", (request, response) => {
    const challenge = getChallenge(request.query.challenge) ?? getChallenge(request.body?.challenge);
    if (challenge) {
      response.type("text/plain").send(challenge);
      return;
    }

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