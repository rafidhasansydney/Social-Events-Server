import mongoose from "mongoose";

mongoose.set("bufferCommands", false);

export async function connectDB({ mongoUri, databaseName }) {
  await mongoose.connect(mongoUri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    maxPoolSize: 10,
    autoIndex: true,
  });
  await mongoose.connection.db.command({ ping: 1 });
  return mongoose.connection;
}

export async function checkDatabaseReadiness() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db.command({ ping: 1 }, { timeoutMS: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
