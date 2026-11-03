import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createEventRouter } from "../src/routes/events.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { Event } from "../src/models/event.js";
import { HttpError } from "../src/utils/http-error.js";

const owner = { id: "verified-member", email: "member@example.com" };
const eventData = () => ({
  title: "  A cleaner neighbourhood  ",
  description: "Bring gloves and help clear our shared park.",
  eventType: "Cleanup",
  thumbnailUrl: "https://example.com/cleanup.jpg",
  location: "Mirpur, Dhaka",
  eventDate: new Date(Date.now() + 86400000).toISOString(),
});

async function withApi(run) {
  const saved = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/api/events",
    createEventRouter({
      authenticate(req, res, next) {
        if (req.headers.authorization !== "Bearer verified-test-session")
          return next(new HttpError(401, "UNAUTHORIZED", "Please log in."));
        req.auth = owner;
        next();
      },
      eventModel: {
        async create(data) {
          const document = new Event(data);
          await document.validate();
          saved.push(document.toObject());
          return document;
        },
      },
    }),
  );
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  async function create(body, authenticated = true) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authenticated && {
            Authorization: "Bearer verified-test-session",
          }),
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, data: await response.json() };
  }
  try {
    await run({ create, saved });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("event creation requires authentication before writing any data", async () => {
  await withApi(async ({ create, saved }) => {
    assert.equal((await create(eventData(), false)).status, 401);
    assert.equal(saved.length, 0);
  });
});

test("event creation uses the verified owner and ignores injected identities and fields", async () => {
  await withApi(async ({ create, saved }) => {
    const result = await create({
      ...eventData(),
      creatorId: "attacker",
      creatorEmail: "attacker@example.com",
      _id: "bad",
      createdAt: "yesterday",
    });
    assert.equal(result.status, 201);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].creatorId, owner.id);
    assert.equal(saved[0].creatorEmail, owner.email);
    assert.equal(saved[0].title, "A cleaner neighbourhood");
    assert.equal(result.data.event.creatorId, undefined);
    assert.equal(result.data.event.creatorEmail, undefined);
  });
});

test("invalid event bodies never reach persistence", async () => {
  await withApi(async ({ create, saved }) => {
    for (const body of [
      null,
      [],
      {},
      { ...eventData(), title: { $ne: "" } },
      { ...eventData(), eventDate: 123456789 },
    ]) {
      assert.equal((await create(body)).status, 400);
    }
    assert.equal(saved.length, 0);
  });
});

test("event requests reject past dates, missing details, unknown causes and unsafe image links", async () => {
  await withApi(async ({ create, saved }) => {
    for (const change of [
      { eventDate: new Date(Date.now() - 1000).toISOString() },
      { eventDate: "tomorrow" },
      { eventDate: "2030-99-99T10:00:00Z" },
      { eventDate: "2030-02-31T10:00:00Z" },
      { title: "   " },
      { title: "x".repeat(161) },
      { description: "" },
      { location: "" },
      { eventType: "Unknown" },
      { thumbnailUrl: "javascript:alert(1)" },
      { thumbnailUrl: "https://user:secret@example.com/photo.jpg" },
    ]) {
      const result = await create({ ...eventData(), ...change });
      assert.equal(result.status, 400);
    }
    assert.equal(saved.length, 0);
  });
});
