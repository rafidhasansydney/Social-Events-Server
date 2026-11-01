import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

app.use(
  cors({
    origin: [CLIENT_URL],
    credentials: true,
  })
);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

connectDB()
  .catch((err) => console.error("DB connection error:", err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
