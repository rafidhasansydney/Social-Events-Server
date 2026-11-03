import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";

async function withApi(run) {
  let reads = 0;
  const app = createApp({
    eventModel: {
      find() {
        reads += 1;
        throw new Error("Unexpected database read");
      },
      findById() {
        reads += 1;
        throw new Error("Unexpected database read");
      },
    },
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run({
      url: `http://127.0.0.1:${server.address().port}`,
      reads: () => reads,
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("browse parameters reject repeated values, unsupported types and oversized search before querying", async () => {
  await withApi(async ({ url, reads }) => {
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1&limit=2",
      "type=Unknown",
      "type=Cleanup&type=Donation",
      "q=one&q=two",
      `q=${"x".repeat(101)}`,
    ]) {
      const response = await fetch(`${url}/api/events?${query}`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).ok, false);
    }
    assert.equal(reads(), 0);
  });
});

test("malformed event identifiers return a public JSON not-found response", async () => {
  await withApi(async ({ url, reads }) => {
    for (const id of ["not-an-id", "123", "12345678901234567890123g"]) {
      const response = await fetch(`${url}/api/events/${id}`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, "EVENT_NOT_FOUND");
    }
    assert.equal(reads(), 0);
  });
});

test("participation reads and writes require authentication before looking up events", async () => {
  await withApi(async ({ url, reads }) => {
    const id = "123456789012345678901234";
    const status = await fetch(`${url}/api/events/${id}/participation`);
    assert.equal(status.status, 401);
    const join = await fetch(`${url}/api/events/${id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(join.status, 401);
    assert.equal(reads(), 0);
  });
});

test("personal lists, edit data and event changes require authentication", async () => {
  await withApi(async ({ url, reads }) => {
    for (const path of ["mine", "joined", "123456789012345678901234/manage"])
      assert.equal((await fetch(`${url}/api/events/${path}`)).status, 401);
    for (const method of ["PUT", "DELETE"])
      assert.equal(
        (await fetch(`${url}/api/events/123456789012345678901234`, { method }))
          .status,
        401,
      );
    assert.equal(reads(), 0);
  });
});
