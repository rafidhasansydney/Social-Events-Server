import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { prepareImage } from "../src/routes/images.js";
import { parseProfile } from "../src/utils/profile.js";

test("profile fields are trimmed and optional details may be cleared", () => {
  assert.deepEqual(
    parseProfile({ name: "  A Member  ", bio: "  ", location: "  Dhaka  " }),
    { name: "A Member", bio: "", location: "Dhaka" },
  );
  assert.deepEqual(parseProfile({ bio: "", location: "" }), {
    bio: "",
    location: "",
  });
});

test("profile validation rejects invalid types, oversized details and unsafe image URLs", () => {
  for (const body of [
    null,
    [],
    { name: "  " },
    { name: "x".repeat(101) },
    { bio: "x".repeat(401) },
    { location: "x".repeat(101) },
    { bio: {} },
    { image: "javascript:alert(1)" },
    { image: "https://user:secret@example.com/pic.png" },
  ])
    assert.throws(
      () => parseProfile(body),
      (error) => error.status === 400,
    );
});

test("uploads are decoded, reduced to the appropriate size and stored as WebP", async () => {
  const source = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#244b3b" },
  })
    .jpeg()
    .toBuffer();
  const event = await prepareImage(source, "event");
  assert.equal(event.width, 1600);
  assert.equal(event.height, 800);
  const profile = await prepareImage(source, "profile");
  assert.equal(profile.width, 512);
  assert.equal(profile.height, 256);
  const metadata = await sharp(profile.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
});

test("an upload must contain a supported image even if its file extension or MIME type claims otherwise", async () => {
  for (const bytes of [
    Buffer.from("not an image"),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    ),
  ])
    await assert.rejects(
      prepareImage(bytes),
      (error) => error.status === 400 && error.code === "INVALID_IMAGE",
    );
});
