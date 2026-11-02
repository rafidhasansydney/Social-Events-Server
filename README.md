# Bandhan server

Express and MongoDB backend for the Bandhan community events platform.

## Local setup

Install dependencies with `npm ci`. Create `.env` using `.env.example` and set `MONGODB_URI` to your MongoDB connection string. The application database is selected by `MONGODB_DB_NAME`, which defaults to `bandhan`. Keep `.env` private.

Run `npm run dev` for development or `npm start` to run the server. Startup requires a working database connection and permission to create collections and indexes. Missing configuration or a failed connection stops startup with a nonzero exit code.

## Current endpoints

| Endpoint          | Purpose                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `GET /api/health` | Confirms that the HTTP server is running.                             |
| `GET /api/ready`  | Pings MongoDB and returns 503 if it is unavailable.                   |
| `/api/auth/*`     | BetterAuth registration, login, sessions, Google OAuth, JWT and JWKS. |
| `GET /api/me`     | Returns the authenticated user after JWT and active-session checks.   |

Browser requests are allowed from the exact `CLIENT_URL` origin. Errors use `{ ok: false, error: { code, message, details? } }`.

## Data model

Events store a title, description, event type, image URL, location, future event date, creator ID and creator email. Creator identity is immutable. Event dates and creator IDs are indexed for upcoming events and organizer listings.

Joined events reference the original event and store the participant ID and email. A unique compound index on `eventId` and `userId` prevents duplicate participation once the index is initialized. Reading the referenced event keeps joined listings consistent with organizer updates.

Event endpoints belong to later phases. Creator and participant identities must come from `req.auth`, which the authentication middleware populates from the verified active session. Never accept ownership or participation identity from request bodies.

## Authentication

Set a stable random `BETTER_AUTH_SECRET` of at least 32 characters. Set `BETTER_AUTH_URL` to the public auth origin, with `http://localhost:5000` for local development. Google OAuth uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and an authorized redirect URI of `BETTER_AUTH_URL/api/auth/callback/google`.

Registration requires a name, valid profile image URL, email and a password with 6–128 characters containing an uppercase and a lowercase letter. Successful registration signs the user in. Email verification and password reset are disabled for this assignment.

JWTs expire after 15 minutes and are verified for signature, algorithm, expiration, issuer and audience. Protected endpoints also verify that the associated cookie session is still active, so logout revokes API access immediately. The client requests tokens as needed and does not persist JWTs in browser storage.

The frontend proxies `/api/*` to this server. Set the frontend `API_URL` to the backend origin in hosting configuration. For production on separate hosting domains, set `BETTER_AUTH_URL` to the public frontend proxy origin and add that origin's Google callback URI. Keep `CLIENT_URL` equal to the frontend origin. Verify HTTPS cookies, trusted proxy client IP handling and OAuth after deployment.

Google OAuth consent is configured in Google Auth Platform. While the app is in Testing mode, add the Google accounts used for testing under Audience. A real browser sign-in is needed to verify account consent and the OAuth callback.

## Verification

Run `npm test`. Tests exercise configuration, startup failure, model validation, immutable ownership, HTTP health and readiness, CORS, request parsing and error responses without connecting to MongoDB.

Run `npm run db:check` to check the configured connection. For Atlas SRV connections, it checks DNS and certificate-verified TLS before testing authentication and a database ping. It prints no credentials and writes no data. A TLS failure before authentication does not establish whether the password is correct.

Live Atlas verification passed for authentication, database ping, collection/index creation, event writes and updates, joined-event references and duplicate-key enforcement. Temporary verification records were removed afterward. The automated test suite does not write data to a database.

Collections and indexes are initialized explicitly after connecting to MongoDB, so importing models cannot start database operations before a connection is ready.

Run `npm run auth:check` for an isolated live authentication check. It creates a uniquely named temporary database, checks password validation, registration, login, sessions, JWT tampering, logout revocation and Google redirect configuration, and removes only that test database afterward. It does not complete real Google consent or sign-in.
