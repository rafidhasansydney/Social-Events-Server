import { Router } from "express";
import { Event } from "../models/event.js";
import { HttpError } from "../utils/http-error.js";

const publicFields =
  "title description eventType thumbnailUrl location eventDate createdAt";
const fields = [
  "title",
  "description",
  "eventType",
  "thumbnailUrl",
  "location",
  "eventDate",
];

export function createEventRouter({ authenticate, eventModel = Event }) {
  const router = Router();

  router.get("/", async (req, res) => {
    const limit = req.query.limit;
    if (
      limit !== undefined &&
      (typeof limit !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit))
    )
      throw new HttpError(
        400,
        "INVALID_LIMIT",
        "Choose a limit between 1 and 100.",
      );
    let query = eventModel
      .find({ eventDate: { $gt: new Date() } })
      .sort({ eventDate: 1, _id: 1 })
      .select(publicFields);
    if (limit !== undefined) query = query.limit(Number(limit));
    const events = await query.lean();
    res.json({ ok: true, events });
  });

  router.post("/", authenticate, async (req, res) => {
    const body = req.body;
    if (!body || Array.isArray(body) || typeof body !== "object")
      throw new HttpError(
        400,
        "INVALID_EVENT",
        "Enter the details for your event.",
      );
    const data = {};
    for (const field of fields) {
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
    const calendarDate = new Date(`${data.eventDate.slice(0, 10)}T00:00:00.000Z`);
    if (
      !Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== data.eventDate.slice(0, 10)
    )
      throw new HttpError(400, "INVALID_DATE", "Choose a valid calendar date.");
    const event = await eventModel.create({
      ...data,
      creatorId: req.auth.id,
      creatorEmail: req.auth.email,
    });
    const result = event.toObject();
    delete result.creatorId;
    delete result.creatorEmail;
    res.status(201).json({ ok: true, event: result });
  });

  return router;
}
