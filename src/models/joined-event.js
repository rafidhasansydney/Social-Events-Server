import mongoose from "mongoose";
import { emailField } from "./event.js";

const joinedEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      immutable: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
    },
    userEmail: { ...emailField, immutable: true },
  },
  { timestamps: true, versionKey: false, bufferCommands: false, autoCreate: false, autoIndex: false },
);

joinedEventSchema.index({ eventId: 1, userId: 1 }, { unique: true });
joinedEventSchema.index({ userId: 1, createdAt: -1 });

export const JoinedEvent =
  mongoose.models.JoinedEvent ||
  mongoose.model("JoinedEvent", joinedEventSchema);
