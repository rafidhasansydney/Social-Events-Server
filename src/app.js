import express from "express";
import cors from "cors";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { requireAuth } from "./middleware/require-auth.js";
import { checkDatabaseReadiness } from "./config/db.js";
import { errorHandler } from "./middleware/error-handler.js";
import { HttpError } from "./utils/http-error.js";
import { createEventRouter } from "./routes/events.js";
import { createImageRouter } from "./routes/images.js";
import { parseProfile, PROFILE_FIELDS } from "./utils/profile.js";

export function createApp({
  clientUrl = "http://localhost:3000",
  checkReadiness = checkDatabaseReadiness,
  auth,
  authUrl = "http://localhost:5000",
  eventModel,
  imageModel,
  joinedEventModel,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === clientUrl) return callback(null, true);
        callback(
          new HttpError(
            403,
            "ORIGIN_NOT_ALLOWED",
            "This origin is not allowed.",
          ),
        );
      },
      credentials: true,
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  if (auth)
    app.all("/api/auth/*splat", (req, res, next) => {
      req.headers["x-bandhan-client-ip"] = req.socket.remoteAddress;
      return toNodeHandler(auth)(req, res, next);
    });
  app.use(express.json({ limit: "100kb" }));
  const authenticate = auth
    ? requireAuth({ auth, issuer: authUrl, audience: clientUrl })
    : (req, res, next) =>
        next(new HttpError(401, "UNAUTHORIZED", "Please log in to continue."));
  app.use(
    "/api/events",
    createEventRouter({ authenticate, eventModel, joinedEventModel }),
  );
  app.use("/api", createImageRouter({ authenticate, clientUrl, imageModel }));
  if (auth) {
    app.patch("/api/me", authenticate, async (req, res) => {
      const body = parseProfile(req.body);
      if (
        !Object.keys(body).length ||
        Object.keys(req.body).some((key) => !PROFILE_FIELDS.includes(key))
      )
        throw new HttpError(
          400,
          "INVALID_PROFILE",
          "You can update your name, photo, area and bio.",
        );
      const response = await auth.api.updateUser({
        body,
        headers: fromNodeHeaders(req.headers),
        asResponse: true,
      });
      const result = await response.json();
      if (!response.ok)
        throw new HttpError(
          response.status,
          "PROFILE_UPDATE_FAILED",
          result.message || "Your profile could not be saved.",
        );
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      res.json({ ok: true });
    });
    app.get(
      "/api/me",
      requireAuth({ auth, issuer: authUrl, audience: clientUrl }),
      (req, res) => {
        res.json({ ok: true, user: req.auth });
      },
    );
  }

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, message: "Server is running" });
  });

  app.get("/api/ready", async (req, res) => {
    if (!(await checkReadiness())) {
      throw new HttpError(
        503,
        "DATABASE_UNAVAILABLE",
        "The database is not ready.",
      );
    }
    res.json({ ok: true, message: "Server and database are ready" });
  });

  app.use((req, res, next) =>
    next(new HttpError(404, "NOT_FOUND", "This endpoint does not exist.")),
  );
  app.use(errorHandler);
  return app;
}
