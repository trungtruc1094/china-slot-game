import { Router } from "express";
import { ZodError, z } from "zod";
import type { SessionService } from "../domain/session-service.js";
import type { TeviAuthVerifier } from "../domain/tevi-auth-adapter.js";
import type { TeviTokenServicePort } from "../domain/tevi-token-service.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const teviTokenRequestSchema = z.object({
  runtimeToken: z.string().trim().min(1)
});

const teviTokenRefreshRequestSchema = z.object({
  sessionId: z.string().trim().min(1)
});

export interface TeviTokenRouterOptions {
  sessionService?: SessionService;
  verifier?: TeviAuthVerifier;
  // "exchange" (default): bind the session via the GET /api/v1/auth/token exchange.
  // "direct": verify the runtime (user_app_token) directly against JWKS and skip the exchange.
  sessionAuthMode?: "exchange" | "direct";
}

export function createTeviTokenRouter(tokenService: TeviTokenServicePort, options: TeviTokenRouterOptions = {}): Router {
  const router = Router();
  const refreshTokensBySessionId = new Map<string, { playerId: string; refreshToken: string }>();

  router.post("/tevi/token", async (request, response, next) => {
    try {
      const parsedRequest = teviTokenRequestSchema.parse(request.body ?? {});

      // Direct mode: verify the user_app_token against Tevi's JWKS (the exact verification the Tevi
      // auth middleware already runs successfully for every payment) and bind the session from its
      // claims — skipping GET /api/v1/auth/token, which expects a different bearer/scope and rejects
      // the user_app_token with 401 PROVIDER_REJECTED (8.12). JWKS verification depends on neither
      // that endpoint's bearer type nor its Login-Kit scope.
      if (options.sessionAuthMode === "direct") {
        if (!options.sessionService || !options.verifier) {
          throw new ApiHttpError(503, {
            code: "TEVI_AUTH_UNAVAILABLE",
            message: "Tevi authentication is temporarily unavailable.",
            details: {
              reasonCode: "AUTH_SESSION_BINDING_UNAVAILABLE",
              reauthRequired: true
            }
          });
        }

        const verifiedDirect = await options.verifier.verify(parsedRequest.runtimeToken);
        if (!verifiedDirect.ok) {
          console.warn("[tevi-token] runtime token rejected", {
            requestId: request.requestId,
            mode: "direct",
            reasonCode: verifiedDirect.reasonCode
          });
          throw new ApiHttpError(401, {
            code: "TEVI_REAUTH_REQUIRED",
            message: "Tevi authentication requires a new sign-in.",
            details: {
              reasonCode: verifiedDirect.reasonCode,
              reauthRequired: true
            }
          });
        }

        const directSession = await options.sessionService.createOrResume({
          identity: verifiedDirect.context
        });
        response.status(directSession.statusCode).json(okEnvelope({
          status: "authenticated",
          accessTokenExpiresAt: verifiedDirect.context.expiresAt,
          reauthRequired: false,
          session: directSession.response
        }, request.requestId));
        return;
      }

      const result = await tokenService.exchangeRuntimeToken(parsedRequest.runtimeToken, request.requestId);
      if (!result.ok) {
        throw new ApiHttpError(result.statusCode, {
          code: result.code,
          message: "Tevi authentication requires a new sign-in.",
          details: {
            reasonCode: result.reasonCode,
            reauthRequired: true
          }
        });
      }

      if (!options.sessionService || !options.verifier) {
        throw new ApiHttpError(503, {
          code: "TEVI_AUTH_UNAVAILABLE",
          message: "Tevi authentication is temporarily unavailable.",
          details: {
            reasonCode: "AUTH_SESSION_BINDING_UNAVAILABLE",
            reauthRequired: true
          }
        });
      }

      const verified = await options.verifier.verify(result.accessToken);
      if (!verified.ok) {
        console.warn("[tevi-token] exchanged access token rejected", {
          requestId: request.requestId,
          reasonCode: verified.reasonCode
        });
        throw new ApiHttpError(401, {
          code: "TEVI_REAUTH_REQUIRED",
          message: "Tevi authentication requires a new sign-in.",
          details: {
            reasonCode: verified.reasonCode,
            reauthRequired: true
          }
        });
      }

      const sessionResult = await options.sessionService.createOrResume({
        identity: verified.context
      });
      refreshTokensBySessionId.set(sessionResult.response.sessionId, {
        playerId: sessionResult.response.playerId,
        refreshToken: result.refreshToken
      });

      response.status(sessionResult.statusCode).json(okEnvelope({
        status: "authenticated",
        accessTokenExpiresAt: result.expiresAt ?? verified.context.expiresAt,
        reauthRequired: false,
        session: sessionResult.response
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_TEVI_TOKEN_REQUEST",
          message: "Tevi token exchange payload is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  router.post("/tevi/token/refresh", async (request, response, next) => {
    try {
      const parsedRequest = teviTokenRefreshRequestSchema.parse(request.body ?? {});
      const dependencies = requireSessionBinding(options);
      const activeSession = await dependencies.sessionService.getActiveSession(parsedRequest.sessionId);
      const storedToken = refreshTokensBySessionId.get(activeSession.sessionId);
      if (!storedToken || storedToken.playerId !== activeSession.playerId) {
        throw new ApiHttpError(401, {
          code: "TEVI_REAUTH_REQUIRED",
          message: "Tevi authentication requires a new sign-in.",
          details: {
            reasonCode: "REFRESH_TOKEN_UNAVAILABLE",
            reauthRequired: true
          }
        });
      }

      const result = await tokenService.refreshAccessToken(storedToken.refreshToken, request.requestId);
      if (!result.ok) {
        throw new ApiHttpError(result.statusCode, {
          code: result.code,
          message: "Tevi authentication requires a new sign-in.",
          details: {
            reasonCode: result.reasonCode,
            reauthRequired: true
          }
        });
      }

      const verified = await dependencies.verifier.verify(result.accessToken);
      if (!verified.ok) {
        console.warn("[tevi-token] refreshed access token rejected", {
          requestId: request.requestId,
          reasonCode: verified.reasonCode
        });
        throw new ApiHttpError(401, {
          code: "TEVI_REAUTH_REQUIRED",
          message: "Tevi authentication requires a new sign-in.",
          details: {
            reasonCode: verified.reasonCode,
            reauthRequired: true
          }
        });
      }

      const sessionResult = await dependencies.sessionService.createOrResume({
        identity: verified.context,
        resumeSessionId: activeSession.sessionId
      });
      if (sessionResult.response.playerId !== activeSession.playerId) {
        refreshTokensBySessionId.delete(activeSession.sessionId);
        throw new ApiHttpError(401, {
          code: "TEVI_REAUTH_REQUIRED",
          message: "Tevi authentication requires a new sign-in.",
          details: {
            reasonCode: "PLAYER_MISMATCH",
            reauthRequired: true
          }
        });
      }

      refreshTokensBySessionId.set(sessionResult.response.sessionId, {
        playerId: sessionResult.response.playerId,
        refreshToken: result.refreshToken
      });

      response.status(200).json(okEnvelope({
        status: "authenticated",
        accessTokenExpiresAt: result.expiresAt ?? verified.context.expiresAt,
        reauthRequired: false,
        session: sessionResult.response
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_TEVI_TOKEN_REFRESH_REQUEST",
          message: "Tevi token refresh payload is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  return router;
}

function requireSessionBinding(options: TeviTokenRouterOptions): { sessionService: SessionService; verifier: TeviAuthVerifier } {
  if (!options.sessionService || !options.verifier) {
    throw new ApiHttpError(503, {
      code: "TEVI_AUTH_UNAVAILABLE",
      message: "Tevi authentication is temporarily unavailable.",
      details: {
        reasonCode: "AUTH_SESSION_BINDING_UNAVAILABLE",
        reauthRequired: true
      }
    });
  }

  return {
    sessionService: options.sessionService,
    verifier: options.verifier
  };
}
