# Maxxchat

A small Discord-like chatroom app where one person creates a room code and other people join with that code.

## Run it locally

```bash
npm install
npm test
DATABASE_URL=postgres://localhost/maxxchat npm start
```

Open `http://localhost:3000`.

Requires Node.js 22 or newer and a PostgreSQL database. See [Railway account setup](RAILWAY-ACCOUNTS.md).

## Use it with another person

This app has a tiny realtime server built in. To make it truly online, deploy this folder to a Node host such as Render, Railway, Fly.io, or a VPS.

For Render:

1. Create a new Web Service.
2. Connect this project or upload the folder.
3. Use `npm start` as the start command.
4. Leave the port setting alone. The app reads Render's `PORT` automatically.
5. Share the deployed URL. One person creates a room, the other joins with the room code.

Accounts, profiles, room memberships, and the most recent 160 messages per room are stored in PostgreSQL. Sign up or sign in before creating or joining a room. Profile pictures are resized in the browser and saved with your account.

## Put it on GitHub

1. Create a new GitHub repository named `maxxchat`.
2. Upload this project folder, or push it with Git.
3. Make sure these root files are included:
   - `package.json`
   - `server.js`
   - `database.js`
   - `railway.json`
   - `public/index.html`
   - `public/styles.css`
   - `public/app.js`

## Deploy on Railway

1. In Railway, create a new project.
2. Choose `Deploy from GitHub repo`.
3. Pick your `maxxchat` repository.
4. Railway should detect this as a Node app and run `npm start`.
5. Open the generated Railway domain when the deployment finishes.

Before deploying, add PostgreSQL in the same project and configure `DATABASE_URL` and `NODE_ENV=production` on Maxxchat. Keep one replica for realtime messaging. The legacy Netlify folder is the previous guest-only version and does not include accounts.
