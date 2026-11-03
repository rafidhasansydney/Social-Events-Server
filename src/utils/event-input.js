import { HttpError } from "./http-error.js";

export function readEventInput(body) {
  if (!body || Array.isArray(body) || typeof body !== "object")
    throw new HttpError(
      400,
      "INVALID_EVENT",
      "Enter the details for your event.",
    );
  const data = {};
  for (const field of [
    "title",
    "description",
    "eventType",
    "thumbnailUrl",
    "location",
    "eventDate",
  ]) {
    if (typeof body[field] !== "string")
      throw new HttpError(
        400,
        "INVALID_EVENT",
        "Complete all event fields using text values.",
      );
    data[field] = body[field].trim();
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      data.eventDate,
    )
  )
    throw new HttpError(
      400,
      "INVALID_DATE",
      "Choose a valid event date and time.",
    );
  const date = new Date(`${data.eventDate.slice(0, 10)}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== data.eventDate.slice(0, 10)
  )
    throw new HttpError(400, "INVALID_DATE", "Choose a valid calendar date.");
  return data;
}
