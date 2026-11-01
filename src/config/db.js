import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.startsWith("PLACEHOLDER")) {
    console.warn(
      "MONGODB_URI is not set yet. Server starts without a database connection."
    );
    return;
  }
  await mongoose.connect(uri);
  console.log("MongoDB connected");
}
