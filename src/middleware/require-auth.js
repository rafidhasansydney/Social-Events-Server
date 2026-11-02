import { createLocalJWKSet, jwtVerify } from "jose";
import { fromNodeHeaders } from "better-auth/node";
import { HttpError } from "../utils/http-error.js";

export function requireAuth({ auth, issuer, audience }) {
  return async (req, res, next) => {
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || "");
    if (!match)
      throw new HttpError(401, "AUTH_REQUIRED", "Please log in to continue.");
    const keys = await auth.api.getJwks();
    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], createLocalJWKSet(keys), {
        issuer,
        audience,
        algorithms: ["EdDSA"],
      }));
    } catch {
      throw new HttpError(
        401,
        "INVALID_TOKEN",
        "Your session has expired. Please log in again.",
      );
    }
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (
      !session ||
      payload.sub !== session.user.id ||
      payload.sessionId !== session.session.id
    ) {
      throw new HttpError(
        401,
        "SESSION_EXPIRED",
        "Your session has expired. Please log in again.",
      );
    }
    req.auth = session.user;
    next();
  };
}
