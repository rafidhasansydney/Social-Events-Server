import express from "express";
import cors from "cors";
import { checkDatabaseReadiness } from "./config/db.js";
import { errorHandler } from "./middleware/error-handler.js";
import { HttpError } from "./utils/http-error.js";

export function createApp({
  clientUrl = "http://localhost:3000",
  checkReadiness = checkDatabaseReadiness,
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
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

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
