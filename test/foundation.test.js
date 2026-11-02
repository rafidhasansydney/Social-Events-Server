import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import express from "express";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config/env.js";
import { checkDatabaseReadiness } from "../src/config/db.js";
import { Event } from "../src/models/event.js";
import { JoinedEvent } from "../src/models/joined-event.js";
import { errorHandler } from "../src/middleware/error-handler.js";

const validConfig = { MONGODB_URI: "mongodb://127.0.0.1:27017/bandhan" };
const eventData = () => ({
  title: "Neighbourhood cleanup",
  description: "Help clean our shared green spaces.",
  eventType: "Cleanup",
  thumbnailUrl: "https://example.com/cleanup.jpg",
  location: "Mirpur, Dhaka",
  eventDate: new Date(Date.now() + 86400000),
  creatorId: "user-123",
  creatorEmail: "volunteer@example.com",
});

async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("configuration rejects a missing or placeholder connection string", () => {
  for (const uri of [
    undefined,
    "",
    "your_mongodb_atlas_connection_string",
    "https://example.com",
  ]) {
    assert.throws(() => readConfig({ MONGODB_URI: uri }), /MONGODB_URI/);
  }
  assert.equal(readConfig(validConfig).databaseName, "bandhan");
});

test("configuration validates ports and frontend origins", () => {
  for (const port of ["abc", "0", "65536", "2.5"]) {
    assert.throws(() => readConfig({ ...validConfig, PORT: port }), /PORT/);
  }
  for (const origin of [
    "file:///tmp",
    "https://example.com/path",
    "https://example.com/",
  ]) {
    assert.throws(
      () => readConfig({ ...validConfig, CLIENT_URL: origin }),
      /CLIENT_URL/,
    );
  }
  assert.equal(
    readConfig({ ...validConfig, CLIENT_URL: "https://bandhan.example" })
      .clientUrl,
    "https://bandhan.example",
  );
});

test("configuration rejects invalid database names", () => {
  for (const name of ["my database", "bad/name", "bad.name"]) {
    assert.throws(
      () => readConfig({ ...validConfig, MONGODB_DB_NAME: name }),
      /MONGODB_DB_NAME/,
    );
  }
});

test("startup fails instead of listening without a database configuration", () => {
  const result = spawnSync(process.execPath, ["src/index.js"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, MONGODB_URI: "", PORT: "59999" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MONGODB_URI/);
  assert.doesNotMatch(result.stdout, /ready on port/);
});

test("readiness is false when MongoDB is disconnected", async () => {
  assert.equal(await checkDatabaseReadiness(), false);
});

test("event validation accepts trimmed information and normalizes owner email", async () => {
  const event = new Event({
    ...eventData(),
    title: "  Neighbourhood cleanup  ",
    creatorEmail: " VOLUNTEER@EXAMPLE.COM ",
  });
  await event.validate();
  assert.equal(event.title, "Neighbourhood cleanup");
  assert.equal(event.creatorEmail, "volunteer@example.com");
});

test("event validation rejects missing fields, unknown causes and unsafe image protocols", async () => {
  for (const change of [
    { title: "  " },
    { location: "" },
    { description: "" },
    { creatorId: "" },
    { creatorEmail: "invalid" },
    { eventType: "Unknown" },
    { thumbnailUrl: "javascript:alert(1)" },
  ]) {
    await assert.rejects(
      new Event({ ...eventData(), ...change }).validate(),
      mongoose.Error.ValidationError,
    );
  }
});

test("new events reject past, current and invalid dates", async () => {
  for (const date of [new Date(Date.now() - 1000), new Date(), "not-a-date"]) {
    await assert.rejects(
      new Event({ ...eventData(), eventDate: date }).validate(),
      mongoose.Error.ValidationError,
    );
  }
});

test("existing past events remain readable and edits cannot move the date into the past", async () => {
  const id = new mongoose.Types.ObjectId();
  const event = Event.hydrate({
    _id: id,
    ...eventData(),
    eventDate: new Date(Date.now() - 86400000),
  });
  event.title = "Updated event title";
  await event.validate();
  event.eventDate = new Date(Date.now() - 1000);
  await assert.rejects(event.validate(), /future/);
});

test("joined events require both a real event id and a user identity", async () => {
  const valid = {
    eventId: new mongoose.Types.ObjectId(),
    userId: "user-123",
    userEmail: "volunteer@example.com",
  };
  await new JoinedEvent(valid).validate();
  for (const change of [
    { eventId: "invalid" },
    { userId: "" },
    { userEmail: "invalid" },
  ]) {
    await assert.rejects(
      new JoinedEvent({ ...valid, ...change }).validate(),
      mongoose.Error.ValidationError,
    );
  }
});

test("ownership stays fixed when an existing event is modified", () => {
  const event = Event.hydrate({
    _id: new mongoose.Types.ObjectId(),
    ...eventData(),
  });
  event.creatorId = "other-user";
  event.creatorEmail = "other@example.com";
  assert.equal(event.creatorId, "user-123");
  assert.equal(event.creatorEmail, "volunteer@example.com");
});

test("health and readiness report separate states", async () => {
  await withServer(
    createApp({ checkReadiness: async () => false }),
    async (url) => {
      const health = await fetch(`${url}/api/health`);
      assert.equal(health.status, 200);
      assert.equal(health.headers.get("x-powered-by"), null);
      const ready = await fetch(`${url}/api/ready`);
      assert.equal(ready.status, 503);
      assert.equal((await ready.json()).error.code, "DATABASE_UNAVAILABLE");
    },
  );
  await withServer(
    createApp({ checkReadiness: async () => true }),
    async (url) => {
      const ready = await fetch(`${url}/api/ready`);
      assert.equal(ready.status, 200);
      assert.equal((await ready.json()).ok, true);
    },
  );
});

test("only the configured browser origin receives credentialed access", async () => {
  await withServer(createApp(), async (url) => {
    const allowed = await fetch(`${url}/api/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "http://localhost:3000",
    );
    assert.equal(
      allowed.headers.get("access-control-allow-credentials"),
      "true",
    );
    const denied = await fetch(`${url}/api/health`, {
      headers: { Origin: "https://unrelated.example" },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});

test("unknown endpoints and malformed or oversized bodies return JSON errors", async () => {
  await withServer(createApp(), async (url) => {
    const missing = await fetch(`${url}/api/events`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "NOT_FOUND");
    const malformed = await fetch(`${url}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, "INVALID_JSON");
    const oversized = await fetch(`${url}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(110000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "PAYLOAD_TOO_LARGE");
  });
});

test("errors hide internal details and turn duplicate joins into conflicts", async () => {
  const app = express();
  app.get("/internal", () => {
    throw new Error("private-database-password");
  });
  app.get("/duplicate", () => {
    throw Object.assign(new Error("private record"), { code: 11000 });
  });
  app.get("/validation", async () => {
    await new Event({ ...eventData(), title: "" }).validate();
  });
  app.use(errorHandler);
  await withServer(app, async (url) => {
    const internal = await fetch(`${url}/internal`);
    assert.equal(internal.status, 500);
    assert.doesNotMatch(
      await internal.text(),
      /private-database-password|stack/,
    );
    const duplicate = await fetch(`${url}/duplicate`);
    assert.equal(duplicate.status, 409);
    const invalid = await fetch(`${url}/validation`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.details[0].field, "title");
  });
});
