import { Event } from "./event.js";
import { JoinedEvent } from "./joined-event.js";

export async function initializeModels() {
  const models = [Event, JoinedEvent];
  await Promise.all(models.map((model) => model.createCollection()));
  await Promise.all(models.map((model) => model.createIndexes()));
}
