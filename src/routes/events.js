import { Router } from "express";
import { Event, EVENT_TYPES } from "../models/event.js";
import { JoinedEvent } from "../models/joined-event.js";
import { HttpError } from "../utils/http-error.js";
import { readEventInput } from "../utils/event-input.js";

const publicFields =
  "title description eventType thumbnailUrl location eventDate createdAt";

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

  async function findEvent(id, includeOwner = false) {
    const event = await eventModel
      .findById(id)
      .select(`${publicFields}${includeOwner ? " creatorId" : ""}`)
      .lean();
    if (!event)
      throw new HttpError(
        404,
        "EVENT_NOT_FOUND",
        "This event could not be found.",
      );
    return event;
  }

  async function ownedEvent(id, userId, session) {
    const event = await eventModel.findById(id).session(session || null);
    if (!event)
      throw new HttpError(
        404,
        "EVENT_NOT_FOUND",
        "This event could not be found.",
      );
    if (event.creatorId !== userId)
      throw new HttpError(
        403,
        "EVENT_FORBIDDEN",
        "You can only manage events you created.",
      );
    return event;
  }

  function listEvent(event) {
    return {
      ...event,
      hasStarted: new Date(event.eventDate).getTime() <= Date.now(),
    };
  }

  router.get("/mine", authenticate, async (req, res) => {
    const events = await eventModel
      .find({ creatorId: req.auth.id })
      .sort({ createdAt: -1, _id: -1 })
      .select(`${publicFields} updatedAt`)
      .lean();
    res.json({ ok: true, events: events.map(listEvent) });
  });

  router.get("/joined", authenticate, async (req, res) => {
    const participations = await joinedEventModel
      .find({ userId: req.auth.id })
      .select("eventId")
      .lean();
    const events = await eventModel
      .find({
        _id: { $in: participations.map((item) => item.eventId) },
        creatorId: { $ne: req.auth.id },
      })
      .sort({ eventDate: 1, _id: 1 })
      .select(publicFields)
      .lean();
    res.json({ ok: true, events: events.map(listEvent) });
  });

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
    const event = await findEvent(req.params.id, true);
    const organizer = event.creatorId === req.auth.id;
    const joined = Boolean(
      !organizer &&
        (await joinedEventModel.exists({
          eventId: req.params.id,
          userId: req.auth.id,
        })),
    );
    res.json({ ok: true, joined, organizer });
  });

  router.post("/:id/join", authenticate, async (req, res) => {
    const alreadyJoined = await eventModel.db.transaction(async (session) => {
      const event = await eventModel
        .findById(req.params.id)
        .select("creatorId eventDate")
        .session(session)
        .lean();
      if (!event)
        throw new HttpError(
          404,
          "EVENT_NOT_FOUND",
          "This event could not be found.",
        );
      if (event.creatorId === req.auth.id)
        throw new HttpError(
          403,
          "ORGANIZER_CANNOT_JOIN",
          "You’re organising this event. Manage it from your events.",
        );
      if (new Date(event.eventDate).getTime() <= Date.now())
        throw new HttpError(
          409,
          "EVENT_ENDED",
          "This event has already started. Choose another upcoming gathering.",
        );
      await eventModel.updateOne(
        { _id: event._id },
        { $inc: { revision: 1 } },
        { session, timestamps: false },
      );
      const existing = await joinedEventModel
        .exists({ eventId: event._id, userId: req.auth.id })
        .session(session);
      if (existing) return true;
      await joinedEventModel.create(
        [
          {
            eventId: event._id,
            userId: req.auth.id,
            userEmail: req.auth.email,
          },
        ],
        { session },
      );
      return false;
    });
    res
      .status(alreadyJoined ? 200 : 201)
      .json({ ok: true, joined: true, alreadyJoined });
  });

  router.get("/:id/manage", authenticate, async (req, res) => {
    const event = await ownedEvent(req.params.id, req.auth.id);
    const result = event.toObject();
    delete result.creatorId;
    delete result.creatorEmail;
    delete result.revision;
    res.json({ ok: true, event: result });
  });

  router.put("/:id", authenticate, async (req, res) => {
    const data = readEventInput(req.body);
    const event = await eventModel.db.transaction(async (session) => {
      const current = await ownedEvent(req.params.id, req.auth.id, session);
      current.set(data);
      await current.save({ session });
      return current.toObject();
    });
    delete event.creatorId;
    delete event.creatorEmail;
    delete event.revision;
    res.json({ ok: true, event });
  });

  router.delete("/:id", authenticate, async (req, res) => {
    await eventModel.db.transaction(async (session) => {
      await ownedEvent(req.params.id, req.auth.id, session);
      await eventModel.deleteOne(
        { _id: req.params.id, creatorId: req.auth.id },
        { session },
      );
      await joinedEventModel.deleteMany(
        { eventId: req.params.id },
        { session },
      );
    });
    res.json({ ok: true });
  });

  router.post("/", authenticate, async (req, res) => {
    const data = readEventInput(req.body);
    const event = await eventModel.create({
      ...data,
      creatorId: req.auth.id,
      creatorEmail: req.auth.email,
    });
    const result = event.toObject();
    delete result.creatorId;
    delete result.creatorEmail;
    delete result.revision;
    res.status(201).json({ ok: true, event: result });
  });

  return router;
}
