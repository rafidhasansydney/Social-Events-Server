import assert from "node:assert/strict";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { requireAuth } from "../src/middleware/require-auth.js";
import { createAuth } from "../src/config/auth.js";

const { privateKey, publicKey } = await generateKeyPair("EdDSA");
const jwk = {
  ...(await exportJWK(publicKey)),
  kid: "test-key",
  alg: "EdDSA",
  use: "sig",
};
const issuer = "http://localhost:5000";
const audience = "http://localhost:3000";
const session = {
  user: { id: "member-1", email: "member@example.com" },
  session: { id: "session-1" },
};

async function token(overrides = {}) {
  return new SignJWT({ sessionId: "session-1", ...overrides })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setSubject("member-1")
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("15m")
    .sign(privateKey);
}

function middleware(currentSession = session) {
  return requireAuth({
    auth: {
      api: {
        getJwks: async () => ({ keys: [jwk] }),
        getSession: async () => currentSession,
      },
    },
    issuer,
    audience,
  });
}

test("protected APIs reject missing and malformed authorization headers", async () => {
  for (const authorization of [
    undefined,
    "Basic abc",
    "Bearer",
    "Bearer a b",
  ]) {
    await assert.rejects(
      middleware()({ headers: { authorization } }, {}, () => {}),
      (error) => error.status === 401,
    );
  }
});

test("a valid JWT and active session identify the authenticated owner", async () => {
  const req = {
    headers: { authorization: `Bearer ${await token()}` },
    body: { creatorId: "someone-else" },
  };
  let called = false;
  await middleware()(req, {}, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.auth.id, "member-1");
});

test("JWT signature, expiration, issuer and audience are all verified", async () => {
  const signed = await token();
  const invalidTokens = [`${signed.slice(0, -9)}tampered!`];
  for (const variant of ["expired", "issuer", "audience"]) {
    invalidTokens.push(
      await new SignJWT({ sessionId: "session-1" })
        .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
        .setSubject("member-1")
        .setIssuer(variant === "issuer" ? "https://wrong.example" : issuer)
        .setAudience(
          variant === "audience" ? "https://wrong.example" : audience,
        )
        .setExpirationTime(variant === "expired" ? "1 second ago" : "15m")
        .sign(privateKey),
    );
  }
  for (const signedToken of invalidTokens) {
    await assert.rejects(
      middleware()(
        { headers: { authorization: `Bearer ${signedToken}` } },
        {},
        () => {},
      ),
      (error) => error.status === 401 && error.code === "INVALID_TOKEN",
    );
  }
});

test("a signed JWT cannot outlive logout or switch to another session", async () => {
  const signed = await token();
  for (const current of [
    null,
    { ...session, session: { id: "another-session" } },
    { ...session, user: { id: "another-user" } },
  ]) {
    await assert.rejects(
      middleware(current)(
        { headers: { authorization: `Bearer ${signed}` } },
        {},
        () => {},
      ),
      (error) => error.status === 401 && error.code === "SESSION_EXPIRED",
    );
  }
});

test("auth configuration rejects a weak secret or invalid callback origin", () => {
  assert.throws(
    () => createAuth({ env: { BETTER_AUTH_SECRET: "short" } }),
    /BETTER_AUTH_SECRET/,
  );
  assert.throws(
    () =>
      createAuth({
        env: {
          BETTER_AUTH_SECRET: "x".repeat(40),
          BETTER_AUTH_URL: "https://example.com/path",
        },
      }),
    /BETTER_AUTH_URL/,
  );
});
