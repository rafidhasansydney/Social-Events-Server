import { Event } from "./event.js";
import { JoinedEvent } from "./joined-event.js";
import { UploadedImage } from "./image.js";

export async function initializeModels() {
  const models = [Event, JoinedEvent, UploadedImage];
  await Promise.all(models.map((model) => model.createCollection()));
  await Promise.all(models.map((model) => model.createIndexes()));
}
