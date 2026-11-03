import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { readConfig } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { createAuth } from "../config/auth.js";
import { createApp } from "../app.js";
import { Event } from "../models/event.js";
import { UploadedImage } from "../models/image.js";
import sharp from "sharp";

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
  const eventModel = connection
    .useDb(databaseName)
    .model("Event", Event.schema);
  await eventModel.createCollection();
  await eventModel.createIndexes();
  const imageModel = connection
    .useDb(databaseName)
    .model("UploadedImage", UploadedImage.schema);
  await imageModel.createCollection();
  await imageModel.createIndexes();
  host.use(
    createApp({
      auth,
      authUrl: baseURL,
      clientUrl: config.clientUrl,
      eventModel,
      imageModel,
    }),
  );
  let cookie = "";
  async function request(path, body, token, withCookie = true, method) {
    const headers = { Origin: config.clientUrl };
    if (withCookie && cookie) headers.Cookie = cookie;
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseURL}${path}`, {
      method: method || (body ? "POST" : "GET"),
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
  const profileData = {
    name: "  Updated Member  ",
    bio: "  A little time for greener streets.  ",
    location: "  Dhaka  ",
  };
  assert.equal(
    (await request("/api/me", profileData, undefined, true, "PATCH")).status,
    401,
  );
  for (const invalid of [
    { name: "  " },
    { bio: "x".repeat(401) },
    { location: {} },
    { image: "javascript:alert(1)" },
    { email: "other@example.com" },
    { id: "other-user", name: "Other Member" },
  ])
    assert.equal(
      (await request("/api/me", invalid, token, true, "PATCH")).status,
      400,
    );
  assert.equal(
    (await request("/api/auth/update-user", { name: "  " })).status,
    400,
  );
  assert.equal(
    (await request("/api/auth/update-user", { bio: "x".repeat(401) })).status,
    400,
  );
  assert.equal(
    (await request("/api/me", profileData, token, true, "PATCH")).status,
    200,
  );
  const profile = (await request("/api/auth/get-session")).data.user;
  assert.equal(profile.name, "Updated Member");
  assert.equal(profile.bio, "A little time for greener streets.");
  assert.equal(profile.location, "Dhaka");
  assert.equal(profile.email, credentials.email);
  const pixels = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#244b3b" },
  })
    .png()
    .toBuffer();
  async function upload(withToken = true, bytes = pixels, mime = "image/png") {
    const data = new FormData();
    data.append("image", new Blob([bytes], { type: mime }), "test-photo.png");
    return fetch(`${baseURL}/api/uploads?kind=profile`, {
      method: "POST",
      headers: {
        Origin: config.clientUrl,
        Cookie: cookie,
        ...(withToken && { Authorization: `Bearer ${token}` }),
      },
      body: data,
    });
  }
  assert.equal((await upload(false)).status, 401);
  assert.equal((await upload(true, Buffer.from("not a photo"))).status, 400);
  assert.equal(
    (await upload(true, Buffer.alloc(4 * 1024 * 1024 + 1))).status,
    413,
  );
  const photo = await upload();
  assert.equal(photo.status, 201);
  const uploaded = (await photo.json()).image;
  assert.equal(uploaded.width, 512);
  assert.equal(await imageModel.countDocuments(), 1);
  const stored = await imageModel.findOne().select("+data");
  assert.equal(stored.ownerId, registered.data.user.id);
  assert.equal((await sharp(stored.data).metadata()).format, "webp");
  const photoPath = new URL(uploaded.url).pathname;
  const download = await fetch(`${baseURL}${photoPath}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type"), /image\/webp/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(
    Buffer.from(await download.arrayBuffer()),
    Buffer.from(stored.data),
  );
  assert.equal(
    (await request("/api/me", { image: uploaded.url }, token, true, "PATCH"))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/auth/get-session")).data.user.image,
    uploaded.url,
  );
  console.log(
    "PASS: profile persistence, session refresh, input validation, protected uploads, file limits, image decoding, resizing, WebP storage and public photo delivery.",
  );
  const eventData = {
    title: "  A greener neighbourhood  ",
    description: "Plant native trees together. Bring a water bottle.",
    eventType: "Plantation",
    thumbnailUrl: "https://example.com/trees.jpg",
    location: "Mirpur, Dhaka",
    eventDate: new Date(Date.now() + 86400000).toISOString(),
    creatorId: "forged-owner",
    creatorEmail: "forged@example.com",
  };
  assert.equal((await request("/api/events", eventData)).status, 401);
  assert.equal(
    (await request("/api/events", eventData, token, false)).status,
    401,
  );
  for (const change of [
    { eventDate: new Date(Date.now() - 1000).toISOString() },
    { eventDate: "tomorrow" },
    { title: "   " },
    { location: "" },
    { description: "" },
    { title: { $gt: "" } },
    { eventType: "Unknown" },
    { thumbnailUrl: "javascript:alert(1)" },
    { thumbnailUrl: "https://user:password@example.com/image.jpg" },
  ]) {
    assert.equal(
      (await request("/api/events", { ...eventData, ...change }, token)).status,
      400,
    );
  }
  assert.equal(await eventModel.countDocuments(), 0);
  const created = await request("/api/events", eventData, token);
  assert.equal(created.status, 201);
  assert.equal(created.data.event.title, "A greener neighbourhood");
  const saved = await eventModel.findById(created.data.event._id).lean();
  assert.equal(saved.creatorId, registered.data.user.id);
  assert.equal(saved.creatorEmail, credentials.email);
  await eventModel.collection.insertMany([
    {
      ...eventData,
      title: "Past gathering",
      eventDate: new Date(Date.now() - 1000),
    },
    {
      ...eventData,
      title: "Later gathering",
      eventDate: new Date(Date.now() + 172800000),
    },
  ]);
  const upcoming = await request("/api/events", undefined, undefined, false);
  assert.equal(upcoming.status, 200);
  assert.deepEqual(
    upcoming.data.events.map((event) => event.title),
    ["A greener neighbourhood", "Later gathering"],
  );
  for (const event of upcoming.data.events) {
    assert.equal(event.creatorId, undefined);
    assert.equal(event.creatorEmail, undefined);
  }
  const limited = await request(
    "/api/events?limit=1",
    undefined,
    undefined,
    false,
  );
  assert.equal(limited.data.events.length, 1);
  assert.equal(limited.data.events[0]._id, created.data.event._id);
  assert.equal((await request("/api/events?limit=0")).status, 400);
  console.log(
    "PASS: event creation, JWT/session protection, field validation, future dates, trusted ownership, persisted data, public upcoming order, limits and creator privacy.",
  );
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
