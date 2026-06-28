import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { CryptoKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { JoseTeviAuthVerifier } from "../../src/domain/tevi-auth-adapter.js";

let privateKey: CryptoKey;
let verifier: JoseTeviAuthVerifier;

const appId = "AZX29173";
const now = new Date("2026-06-28T12:00:00.000Z");

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  const publicJwk = await exportJWK(keys.publicKey);
  verifier = new JoseTeviAuthVerifier({
    appId,
    jwksUrl: "https://sandbox.tevi.example/api/v1/auth/jwks",
    allowAnonymousUsers: false,
    jwks: createLocalJWKSet({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] }),
    currentDate: now
  });
});

describe("JoseTeviAuthVerifier", () => {
  it("accepts a valid RS256 Tevi token and returns a safe internal subject", async () => {
    const token = await signTeviToken({
      user_id: "tevi-user-1",
      user_name: "Tevi Player",
      user_is_active: true,
      user_anonymous: false,
      app_id: appId
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      ok: true,
      context: {
        provider: "tevi",
        subject: "tevi-user-1",
        displayName: "Tevi Player",
        expiresAt: "2026-06-28T13:00:00.000Z"
      }
    });
  });

  it("rejects expired tokens with a safe diagnostic code", async () => {
    const token = await signTeviToken({
      user_id: "tevi-user-1",
      user_is_active: true,
      user_anonymous: false,
      app_id: appId,
      exp: Math.floor(new Date("2026-06-28T11:59:59.000Z").getTime() / 1000)
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      statusCode: 401,
      errorCode: "TEVI_TOKEN_INVALID",
      reasonCode: "TOKEN_EXPIRED"
    });
  });

  it("rejects tokens for a different Tevi app", async () => {
    const token = await signTeviToken({
      user_id: "tevi-user-1",
      user_is_active: true,
      user_anonymous: false,
      app_id: "OTHER_APP"
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      statusCode: 403,
      errorCode: "TEVI_WRONG_APP",
      reasonCode: "APP_ID_MISMATCH"
    });
  });

  it("rejects inactive Tevi users", async () => {
    const token = await signTeviToken({
      user_id: "tevi-user-1",
      user_is_active: false,
      user_anonymous: false,
      app_id: appId
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      statusCode: 403,
      errorCode: "TEVI_USER_INACTIVE",
      reasonCode: "USER_INACTIVE"
    });
  });

  it("rejects anonymous Tevi users by default", async () => {
    const token = await signTeviToken({
      user_id: "tevi-user-1",
      user_is_active: true,
      user_anonymous: true,
      app_id: appId
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      statusCode: 403,
      errorCode: "TEVI_ANONYMOUS_BLOCKED",
      reasonCode: "ANONYMOUS_USER_BLOCKED"
    });
  });

  it("rejects malformed tokens", async () => {
    await expect(verifier.verify("not-a-jwt")).resolves.toMatchObject({
      ok: false,
      statusCode: 401,
      errorCode: "TEVI_TOKEN_INVALID",
      reasonCode: "TOKEN_MALFORMED"
    });
  });

  it("rejects non-RS256 tokens", async () => {
    const token = await new SignJWT({
      user_id: "tevi-user-1",
      user_is_active: true,
      user_anonymous: false,
      app_id: appId
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("not-a-tevi-rs256-key"));

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      statusCode: 401,
      errorCode: "TEVI_TOKEN_INVALID",
      reasonCode: "TOKEN_ALGORITHM_REJECTED"
    });
  });

  it("rejects missing Tevi user subjects", async () => {
    const token = await signTeviToken({
      user_is_active: true,
      user_anonymous: false,
      app_id: appId
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      statusCode: 401,
      errorCode: "TEVI_TOKEN_INVALID",
      reasonCode: "USER_ID_MISSING"
    });
  });
});

async function signTeviToken(claims: Record<string, unknown>): Promise<string> {
  const builder = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt(Math.floor(now.getTime() / 1000));

  if (typeof claims.exp !== "number") {
    builder.setExpirationTime(Math.floor(new Date("2026-06-28T13:00:00.000Z").getTime() / 1000));
  }

  return builder.sign(privateKey);
}
