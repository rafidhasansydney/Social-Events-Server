export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 5000);
  const mongoUri = env.MONGODB_URI?.trim();
  const databaseName = env.MONGODB_DB_NAME?.trim() || "bandhan";
  const clientUrl = env.CLIENT_URL || "http://localhost:3000";

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError("PORT must be a number between 1 and 65535.");
  }

  if (!mongoUri || !/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) {
    throw new ConfigurationError(
      "Set a valid MONGODB_URI in server/.env before starting the server.",
    );
  }

  if (/[/\\.\s"$*<>:|?\u0000]/.test(databaseName)) {
    throw new ConfigurationError(
      "MONGODB_DB_NAME contains an unsupported character.",
    );
  }

  try {
    const url = new URL(clientUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== clientUrl
    ) {
      throw new Error();
    }
  } catch {
    throw new ConfigurationError(
      "CLIENT_URL must be an HTTP or HTTPS origin without a trailing slash.",
    );
  }

  return { port, mongoUri, databaseName, clientUrl };
}
