import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { ConfigurationError } from "./env.js";

export function createAuth({ connection, clientUrl, env = process.env }) {
  const secret = env.BETTER_AUTH_SECRET;
  const authUrl = env.BETTER_AUTH_URL || "http://localhost:5000";
  if (
    !secret ||
    secret.length < 32 ||
    /placeholder|paste_|your_/i.test(secret)
  ) {
    throw new ConfigurationError(
      "Set a random BETTER_AUTH_SECRET of at least 32 characters.",
    );
  }
  try {
    const url = new URL(authUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== authUrl)
      throw new Error();
  } catch {
    throw new ConfigurationError(
      "BETTER_AUTH_URL must be an HTTP or HTTPS origin without a trailing slash.",
    );
  }
  const googleConfigured =
    env.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com") &&
    env.GOOGLE_CLIENT_SECRET?.startsWith("GOCSPX-");

  return betterAuth({
    appName: "Bandhan",
    baseURL: authUrl,
    secret,
    database: mongodbAdapter(connection.db, { client: connection.getClient() }),
    trustedOrigins: [clientUrl],
    advanced: { ipAddress: { ipAddressHeaders: ["x-bandhan-client-ip"] } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      autoSignIn: true,
    },
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
          },
        }
      : {},
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== "test",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    disabledPaths: [
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/verify-email",
      "/delete-user",
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const { password, name, image } = ctx.body || {};
        if (
          typeof password !== "string" ||
          password.length < 6 ||
          password.length > 128 ||
          !/[A-Z]/.test(password) ||
          !/[a-z]/.test(password)
        ) {
          throw new APIError("BAD_REQUEST", {
            message:
              "Use 6–128 characters with an uppercase and a lowercase letter.",
          });
        }
        if (
          typeof name !== "string" ||
          !name.trim() ||
          name.trim().length > 100
        ) {
          throw new APIError("BAD_REQUEST", {
            message: "Enter your name using up to 100 characters.",
          });
        }
        try {
          if (
            typeof image !== "string" ||
            image.length > 2048 ||
            !["http:", "https:"].includes(new URL(image).protocol)
          )
            throw new Error();
        } catch {
          throw new APIError("BAD_REQUEST", {
            message: "Enter a valid HTTP or HTTPS profile image URL.",
          });
        }
        return {
          context: { ...ctx, body: { ...ctx.body, name: name.trim() } },
        };
      }),
    },
    plugins: [
      jwt({
        jwt: {
          issuer: authUrl,
          audience: clientUrl,
          expirationTime: "15m",
          definePayload: ({ session }) => ({ sessionId: session.id }),
        },
      }),
    ],
  });
}
