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
| `POST /api/events` | Creates an event for the authenticated organizer. Requires JWT and active session. |
| `GET /api/events` | Public future events, sorted by event date and ID. Optional `limit` from 1 to 100, supported cause as `type`, and title/location search as `q`. |
| `GET /api/events/:id` | Public event details, including past events, with a `hasStarted` flag. |
| `GET /api/events/:id/participation` | The authenticated member's participation status for one event. |
| `POST /api/events/:id/join` | Joins a future event for the verified member. Requires JWT and active session. |
| `GET /api/events/mine` | Current organiser's events, newest created first. Protected. |
| `GET /api/events/joined` | Current participant's events, sorted by event date. Protected. |
| `GET /api/events/:id/manage` | Owner-only data for the edit form. |
| `PUT /api/events/:id` | Validates and updates an event owned by the authenticated member. |
| `DELETE /api/events/:id` | Atomically removes an owned event and its participation records. |
| `PATCH /api/me` | Updates the current member's name, image, bio and area after JWT/session checks. |
| `POST /api/uploads?kind=event` | Accepts one authenticated multipart photo in the `image` field. Use `kind=profile` for profile sizing. |
| `GET /api/images/:id` | Public immutable WebP photo delivery. |

Browser requests are allowed from the exact `CLIENT_URL` origin. Errors use `{ ok: false, error: { code, message, details? } }`.

## Data model

Events store a title, description, event type, image URL, location, future event date, creator ID and creator email. Creator identity is immutable. Event dates and creator IDs are indexed for upcoming events and organizer listings.

Joined events reference the original event and store the participant ID and email. A unique compound index on `eventId` and `userId` prevents duplicate participation once the index is initialized. Reading the referenced event keeps joined listings consistent with organizer updates.

Event creation accepts only `title`, `description`, `eventType`, `thumbnailUrl`, `location` and an ISO date-time string with a timezone as `eventDate`. It validates field types, required values, length limits, supported causes, HTTP(S) image URLs and strictly future dates. Calendar dates that do not exist are rejected. Creator ID and email come from `req.auth`; supplied ownership fields are ignored. Public event responses exclude organizer IDs and email addresses.

Upcoming queries exclude past events, sort by `eventDate` and `_id`, and apply MongoDB `.limit()` when requested. Type and search filters run before the limit. Searches match literal, case-insensitive text in titles and locations; regular-expression characters are escaped. Query values are validated as single strings and search terms are limited to 100 characters. The homepage requests `limit=6`.

Public event details include title, description, type, image, location, date and creation time. Organizer identity and email remain excluded. Invalid or missing IDs return a JSON 404. Past details remain readable while new participation is rejected with 409.

Participation identity comes from the verified active session. The event ID comes from the route; request body identities are ignored. Organisers receive 403 if they try to join their own event. Participation status returns `organizer` and `joined` booleans for the current member; organisers report `joined: false`. Public event responses still omit creator IDs and emails.

Joining, editing and deletion use MongoDB transactions. A private event revision serialises new participation against deletion, so a concurrent delete cannot leave a new orphan participation record. The unique event/user index remains in place. New joins return 201, while repeating a join returns 200 with `alreadyJoined: true`. The configured MongoDB deployment must support transactions, as the current Atlas deployment does.

Management endpoints verify creator ID against the JWT-backed active session. GET, PUT and DELETE for another organiser's event return 403. PUT accepts the same six event fields as creation and validates the saved document. An unchanged date may remain in the past; a changed date must be future. Creator identity is never accepted from the edit body. Deletion removes the event and participation records in one transaction; missing events return 404.

The private joined listing reads the authenticated member's event references, loads current event data and sorts by `eventDate` then `_id`. It includes past events for the history view. Missing/deleted events and legacy self-participation are excluded. The organiser listing includes only the current member's events and supplies a `hasStarted` flag for All/Upcoming/Past views. These fixed routes are registered before the public `/:id` route.

## Photos and editable profiles

Uploads require both a valid JWT and an active cookie session. Multer accepts one JPG, PNG or WebP file, at most 4 MB, with no extra multipart fields. Sharp verifies actual image data, rejects unsupported/animated formats and images over 40 megapixels, orients the photo, removes metadata and converts it to WebP. Event photos fit within 1600×1600 and profile photos within 512×512 without enlargement. Compressed output is limited to 1 MB. Upload attempts are limited to 30 per member per hour per running server process.

The `UploadedImage` collection stores compressed bytes, dimensions and the authenticated uploader ID. Public responses return image URLs and dimensions; they do not expose uploader identities. Images are served with `image/webp`, `nosniff` and immutable cache headers. This uses the existing MongoDB connection and storage allowance; no media API key or writable hosting disk is required. Older image files are retained when a profile photo is replaced.

The profile endpoint accepts only `name`, `image`, `bio` and `location` and updates the current BetterAuth user. Names are trimmed and limited to 100 characters, bios to 400 and areas to 100. Email, user ID and other account fields cannot be changed through this endpoint. The same field validation runs on BetterAuth's direct update route. Additional bio and location fields default to empty strings for new users; older users can leave them empty.

## Authentication

Set a stable random `BETTER_AUTH_SECRET` of at least 32 characters. Set `BETTER_AUTH_URL` to the public auth origin, with `http://localhost:5000` for local development. Google OAuth uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and an authorized redirect URI of `BETTER_AUTH_URL/api/auth/callback/google`.

Registration requires a name, valid profile image URL, email and a password with 6–128 characters containing an uppercase and a lowercase letter. Successful registration signs the user in. Email verification and password reset are disabled for this assignment.

JWTs expire after 15 minutes and are verified for signature, algorithm, expiration, issuer and audience. Protected endpoints also verify that the associated cookie session is still active, so logout revokes API access immediately. The client requests tokens as needed and does not persist JWTs in browser storage.

The frontend proxies `/api/*` to this server. Set the frontend `API_URL` to the backend origin in hosting configuration. For production on separate hosting domains, set `BETTER_AUTH_URL` to the public frontend proxy origin and add that origin's Google callback URI. Keep `CLIENT_URL` equal to the frontend origin. Verify HTTPS cookies, trusted proxy client IP handling and OAuth after deployment.

Google OAuth consent is configured in Google Auth Platform. While the app is in Testing mode, add the Google accounts used for testing under Audience. A real browser sign-in on localhost verified Google account linking, the callback, an active session and access to the protected account page. Repeat this verification after deployment.

## Verification

Run `npm test`. Tests exercise configuration, startup failure, model validation, immutable ownership, event and profile request validation, browse query validation, malformed event IDs, authentication for participation and personal management, image decoding/resizing, identity spoofing, HTTP health and readiness, CORS, request parsing and error responses without connecting to MongoDB.

Run `npm run db:check` to check the configured connection. For Atlas SRV connections, it checks DNS and certificate-verified TLS before testing authentication and a database ping. It prints no credentials and writes no data. A TLS failure before authentication does not establish whether the password is correct.

Live Atlas verification passed for authentication, database ping, collection/index creation, event writes and updates, joined-event references and duplicate-key enforcement. Temporary verification records were removed afterward. The automated test suite does not write data to a database.

Collections and indexes are initialized explicitly after connecting to MongoDB, so importing models cannot start database operations before a connection is ready.

Run `npm run auth:check` for an isolated live authentication, profile, photo and event check. It creates a uniquely named temporary database and tests password validation, registration, login, sessions, JWT tampering, logout revocation and Google redirect configuration. It also verifies profile persistence, media processing, event creation, discovery, two-account management isolation, owner-join rejection, editing and date rules, joined-list ordering and live details, transactional deletion and a simultaneous join/delete race. It removes only that test database afterward. It does not complete real Google consent or sign-in.
