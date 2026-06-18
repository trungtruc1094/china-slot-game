import { z } from "zod";

export const sessionIdentitySchema = z.object({
  provider: z.string().trim().min(1).max(64),
  subject: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(120).optional(),
  expiresAt: z.string().datetime()
});

export const createSessionRequestSchema = z.object({
  identity: sessionIdentitySchema.optional(),
  resumeSessionId: z.string().trim().min(1).optional()
});

export type SessionIdentityInput = z.infer<typeof sessionIdentitySchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export interface SessionResponse {
  sessionId: string;
  playerId: string;
  balance: {
    points: number;
  };
  session: {
    status: "active";
    createdAt: string;
    expiresAt: string;
    resumed: boolean;
  };
}
