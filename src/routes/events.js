import { Router } from "express";
import { Event, EVENT_TYPES } from "../models/event.js";
import { JoinedEvent } from "../models/joined-event.js";
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

export function createEventRouter({
  authenticate,
  eventModel = Event,
  joinedEventModel = JoinedEvent,
}) {
  const router = Router();
  router.param("id", (req, res, next, id) => {
    if (!/^[a-f\d]{24}$/i.test(id))
      return next(
        new HttpError(404, "EVENT_NOT_FOUND", "This event could not be found."),
      );
    next();
  });

  async function findEvent(id) {
    const event = await eventModel.findById(id).select(publicFields).lean();
    if (!event)
      throw new HttpError(
        404,
        "EVENT_NOT_FOUND",
        "This event could not be found.",
      );
    return event;
  }

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
    const filter = { eventDate: { $gt: new Date() } };
    const { type, q } = req.query;
    if (type !== undefined) {
      if (typeof type !== "string" || !EVENT_TYPES.includes(type))
        throw new HttpError(
          400,
          "INVALID_EVENT_TYPE",
          "Choose a supported event type.",
        );
      filter.eventType = type;
    }
    if (q !== undefined) {
      if (typeof q !== "string" || q.trim().length > 100)
        throw new HttpError(
          400,
          "INVALID_SEARCH",
          "Search using up to 100 characters.",
        );
      if (q.trim()) {
        const search = {
          $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        };
        filter.$or = [{ title: search }, { location: search }];
      }
    }
    let query = eventModel
      .find(filter)
      .sort({ eventDate: 1, _id: 1 })
      .select(publicFields);
    if (limit !== undefined) query = query.limit(Number(limit));
    const events = await query.lean();
    res.json({ ok: true, events });
  });

  router.get("/:id", async (req, res) => {
    const event = await findEvent(req.params.id);
    res.json({
      ok: true,
      event,
      hasStarted: new Date(event.eventDate).getTime() <= Date.now(),
    });
  });

  router.get("/:id/participation", authenticate, async (req, res) => {
    await findEvent(req.params.id);
    const joined = Boolean(
      await joinedEventModel.exists({
        eventId: req.params.id,
        userId: req.auth.id,
      }),
    );
    res.json({ ok: true, joined });
  });

  router.post("/:id/join", authenticate, async (req, res) => {
    const event = await findEvent(req.params.id);
    if (new Date(event.eventDate).getTime() <= Date.now())
      throw new HttpError(
        409,
        "EVENT_ENDED",
        "This event has already started. Choose another upcoming gathering.",
      );
    try {
      await joinedEventModel.create({
        eventId: event._id,
        userId: req.auth.id,
        userEmail: req.auth.email,
      });
      res.status(201).json({ ok: true, joined: true, alreadyJoined: false });
    } catch (error) {
      if (error.code !== 11000) throw error;
      res.json({ ok: true, joined: true, alreadyJoined: true });
    }
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
    const calendarDate = new Date(
      `${data.eventDate.slice(0, 10)}T00:00:00.000Z`,
    );
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
