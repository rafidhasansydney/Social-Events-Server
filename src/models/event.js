import mongoose from "mongoose";

export const EVENT_TYPES = [
  "Cleanup",
  "Plantation",
  "Donation",
  "Education",
  "Health",
  "Food Drive",
];

function isImageUrl(value) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const emailField = {
  type: String,
  required: [true, "An email address is required."],
  trim: true,
  lowercase: true,
  maxlength: 254,
  match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address."],
};

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Enter an event title."],
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      required: [true, "Describe your event."],
      trim: true,
      maxlength: 10000,
    },
    eventType: {
      type: String,
      required: [true, "Choose an event type."],
      enum: EVENT_TYPES,
    },
    thumbnailUrl: {
      type: String,
      required: [true, "Add an event image URL."],
      trim: true,
      maxlength: 2048,
      validate: {
        validator: isImageUrl,
        message: "Use an HTTP or HTTPS image URL.",
      },
    },
    location: {
      type: String,
      required: [true, "Enter the event location."],
      trim: true,
      maxlength: 300,
    },
    eventDate: {
      type: Date,
      required: [true, "Choose an event date."],
      validate: {
        validator(value) {
          if (
            !this.isNew &&
            typeof this.isModified === "function" &&
            !this.isModified("eventDate")
          )
            return true;
          return value.getTime() > Date.now();
        },
        message: "The event date must be in the future.",
      },
    },
    creatorId: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
      maxlength: 128,
    },
    creatorEmail: { ...emailField, immutable: true },
  },
  { timestamps: true, versionKey: false, bufferCommands: false, autoCreate: false, autoIndex: false },
);

eventSchema.index({ eventDate: 1, _id: 1 });
eventSchema.index({ creatorId: 1, createdAt: -1 });

export const Event =
  mongoose.models.Event || mongoose.model("Event", eventSchema);
