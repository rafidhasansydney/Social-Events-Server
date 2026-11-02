import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { readConfig } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { createAuth } from "../config/auth.js";
import { createApp } from "../app.js";

const databaseName = `bandhan_auth_check_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
let database;
let server;
try {
  const config = readConfig();
  const connection = await connectDB(config);
  database = connection.getClient().db(databaseName);
  const host = express();
  server = await new Promise((resolve) => {
    const instance = host.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const auth = createAuth({
    connection: { db: database, getClient: () => connection.getClient() },
    clientUrl: config.clientUrl,
    env: { ...process.env, BETTER_AUTH_URL: baseURL, NODE_ENV: "test" },
  });
  await auth.$context;
  host.use(createApp({ auth, authUrl: baseURL, clientUrl: config.clientUrl }));
  let cookie = "";
  async function request(path, body, token, withCookie = true) {
    const headers = { Origin: config.clientUrl };
    if (withCookie && cookie) headers.Cookie = cookie;
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseURL}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      ...(body && { body: JSON.stringify(body) }),
    });
    const newCookies = response.headers.getSetCookie();
    if (newCookies.length)
      cookie = newCookies.map((value) => value.split(";")[0]).join("; ");
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: response.status, data };
  }
  const credentials = {
    name: "Diagnostic Member",
    email: `check-${randomUUID()}@example.com`,
    image: "https://example.com/profile.jpg",
    password: "BandhanCheck42",
  };
  assert.equal((await request("/api/me")).status, 401);
  assert.equal(
    (
      await request("/api/auth/sign-up/email", {
        ...credentials,
        password: "lowercase",
      })
    ).status,
    400,
  );
  const registered = await request("/api/auth/sign-up/email", credentials);
  assert.equal(
    registered.status,
    200,
    `Registration failed: ${JSON.stringify(registered.data)}`,
  );
  assert.equal(registered.data.user.emailVerified, false);
  assert.equal(
    (await request("/api/auth/get-session")).data.user.email,
    credentials.email,
  );
  const tokenResult = await request("/api/auth/token");
  assert.equal(tokenResult.status, 200);
  const token = tokenResult.data.token;
  assert.equal(
    (await request("/api/me", undefined, token)).data.user.email,
    credentials.email,
  );
  assert.equal(
    (await request("/api/me", undefined, `${token.slice(0, -8)}invalid!`))
      .status,
    401,
  );
  assert.equal((await request("/api/me", undefined, token, false)).status, 401);
  assert.equal((await request("/api/auth/sign-out", {})).status, 200);
  assert.equal((await request("/api/me", undefined, token)).status, 401);
  assert.equal(
    (
      await request("/api/auth/sign-in/email", {
        email: credentials.email,
        password: "WrongPassword",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/auth/sign-in/email", {
        email: credentials.email,
        password: credentials.password,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/auth/get-session")).data.user.email,
    credentials.email,
  );
  const google = await request("/api/auth/sign-in/social", {
    provider: "google",
    callbackURL: `${config.clientUrl}/account`,
    disableRedirect: true,
  });
  assert.equal(google.status, 200);
  const googleUrl = new URL(google.data.url);
  assert.equal(googleUrl.hostname, "accounts.google.com");
  assert.equal(
    googleUrl.searchParams.get("redirect_uri"),
    `${baseURL}/api/auth/callback/google`,
  );
  assert.equal(
    (
      await request("/api/auth/request-password-reset", {
        email: credentials.email,
      })
    ).status,
    404,
  );
  console.log(
    "PASS: registration, server-side password validation, persistent sessions, JWT protection, tamper rejection, logout revocation, login and Google redirect setup.",
  );
  console.log(
    "Google account consent and callback still require a real browser sign-in.",
  );
} catch (error) {
  console.error(
    error.name === "AssertionError"
      ? error.message
      : "Authentication check failed. Check the server configuration and database access.",
  );
  process.exitCode = 1;
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (
    database &&
    database.databaseName === databaseName &&
    databaseName.startsWith("bandhan_auth_check_")
  ) {
    await database.dropDatabase();
    console.log("The isolated authentication test database was removed.");
  }
  await disconnectDB();
}
