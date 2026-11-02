# Bandhan server

Express and MongoDB backend for the Bandhan community events platform.

## Local setup

Install dependencies with `npm ci`. Create `.env` using `.env.example` and set `MONGODB_URI` to your MongoDB connection string. The application database is selected by `MONGODB_DB_NAME`, which defaults to `bandhan`. Keep `.env` private.

Run `npm run dev` for development or `npm start` to run the server. Startup requires a working database connection and permission to create collections and indexes. Missing configuration or a failed connection stops startup with a nonzero exit code.

## Current endpoints

| Endpoint          | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `GET /api/health` | Confirms that the HTTP server is running.           |
| `GET /api/ready`  | Pings MongoDB and returns 503 if it is unavailable. |

Browser requests are allowed from the exact `CLIENT_URL` origin. Errors use `{ ok: false, error: { code, message, details? } }`.

## Data model

Events store a title, description, event type, image URL, location, future event date, creator ID and creator email. Creator identity is immutable. Event dates and creator IDs are indexed for upcoming events and organizer listings.

Joined events reference the original event and store the participant ID and email. A unique compound index on `eventId` and `userId` prevents duplicate participation once the index is initialized. Reading the referenced event keeps joined listings consistent with organizer updates.

Authentication and event endpoints belong to later phases. Creator and participant identities must come from the verified authentication session when those endpoints are added. Model fields and CORS alone do not provide authorization.

## Verification

Run `npm test`. Tests exercise configuration, startup failure, model validation, immutable ownership, HTTP health and readiness, CORS, request parsing and error responses without connecting to MongoDB.

Run `npm run db:check` to check the configured connection. For Atlas SRV connections, it checks DNS and certificate-verified TLS before testing authentication and a database ping. It prints no credentials and writes no data. A TLS failure before authentication does not establish whether the password is correct.

Live Atlas verification passed for authentication, database ping, collection/index creation, event writes and updates, joined-event references and duplicate-key enforcement. Temporary verification records were removed afterward. The automated test suite does not write data to a database.

Collections and indexes are initialized explicitly after connecting to MongoDB, so importing models cannot start database operations before a connection is ready.
