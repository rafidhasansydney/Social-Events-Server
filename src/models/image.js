import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, immutable: true, maxlength: 128 },
    data: { type: Buffer, required: true, select: false },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
    bufferCommands: false,
    autoCreate: false,
    autoIndex: false,
  },
);

imageSchema.index({ ownerId: 1, createdAt: -1 });

export const UploadedImage =
  mongoose.models.UploadedImage || mongoose.model("UploadedImage", imageSchema);
