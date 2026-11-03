import { HttpError } from "./http-error.js";

export const PROFILE_FIELDS = ["name", "image", "bio", "location"];

export function parseProfile(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "INVALID_PROFILE", "Enter your profile details.");
  const result = {};
  for (const [field, max, label] of [
    ["name", 100, "name"],
    ["bio", 400, "bio"],
    ["location", 100, "area"],
  ]) {
    if (body[field] === undefined) continue;
    if (
      typeof body[field] !== "string" ||
      body[field].trim().length > max ||
      (field === "name" && !body[field].trim())
    )
      throw new HttpError(
        400,
        "INVALID_PROFILE",
        `Enter your ${label} using ${field === "name" ? "1–" : "up to "}${max} characters.`,
      );
    result[field] = body[field].trim();
  }
  if (body.image !== undefined) {
    try {
      if (typeof body.image !== "string" || body.image.length > 2048)
        throw new Error();
      const image = new URL(body.image);
      if (
        !["http:", "https:"].includes(image.protocol) ||
        image.username ||
        image.password
      )
        throw new Error();
      result.image = body.image.trim();
    } catch {
      throw new HttpError(
        400,
        "INVALID_PROFILE",
        "Choose a photo or enter a valid HTTP or HTTPS image link.",
      );
    }
  }
  return result;
}
