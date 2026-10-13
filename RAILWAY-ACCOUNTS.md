# Railway Accounts Setup

This version requires PostgreSQL; it never silently falls back to temporary storage.

1. In the existing Railway project, add a PostgreSQL database.
2. On the Maxxchat service, add `DATABASE_URL` using the PostgreSQL service's variable reference (for a service named Postgres: `${{Postgres.DATABASE_URL}}`). Use Railway's private connection URL.
3. Set `NODE_ENV` to `production`. Keep one Maxxchat replica: live event connections currently live in one server process.
4. Deploy the repository with `npm start`. Tables are created automatically.

Passwords use salted scrypt hashes; sessions use random tokens in HttpOnly, SameSite cookies, with only token hashes stored in PostgreSQL. Sessions expire after 30 days. HTTPS is required in production.

Profiles contain a display name and optional resized image. Chat rooms persist their last 160 messages. Joining still requires the four-character room code, not an invitation approval. Codes are not strong security credentials; do not use rooms for sensitive information. No email verification or password-reset flow is included yet.

Enable database backups before relying on the app for important records. A Railway database may add charges according to your plan; review Railway's estimate before provisioning.

Local development requires `DATABASE_URL` pointing to a local PostgreSQL instance. Run `npm install`, `npm test`, then `npm start`. The earlier guest-only load-test script does not apply to this authenticated version.

## Owner Moderation

Set `OWNER_ACCOUNT_ID` to the UUID of the owner's actual, signed-in account (shown in My profile). Never grant the role by an unverified signup email. Only that account can access `/api/admin/rooms` or open the review dialog by typing `secretpanel` outside password fields. The shortcut is not a password.

The separate review archive preserves messages and participants for rooms created within the last 48 hours, independently of the normal 160-message room snapshot. Rooms outside that window are excluded immediately and archive rows are cleaned every five minutes. The ordinary chat snapshot remains saved. Existing rooms can only be backfilled from their remaining saved messages, not already removed history. Review history is read-only through the app, not tamper-proof evidence against a database administrator. Message attribution identifies an account, not the physical person using it.

The entry and signup screens disclose owner review. Review pages are paginated (50 rooms and 200 messages at a time), with More buttons to read all available entries.
