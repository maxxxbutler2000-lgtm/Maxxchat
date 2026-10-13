# Maxxchat

A small Discord-like chatroom app where one person creates a room code and other people join with that code.

## Run it locally

```bash
node server.js
```

Open `http://localhost:3000`.

If you have npm installed, `npm start` does the same thing.

## Use it with another person

This app has a tiny realtime server built in. To make it truly online, deploy this folder to a Node host such as Render, Railway, Fly.io, or a VPS.

For Render:

1. Create a new Web Service.
2. Connect this project or upload the folder.
3. Use `npm start` as the start command.
4. Leave the port setting alone. The app reads Render's `PORT` automatically.
5. Share the deployed URL. One person creates a room, the other joins with the room code.

Rooms and messages are kept in server memory. That is perfect for casual temporary rooms, but restarting the server clears active rooms. Add a database if you want message history to survive restarts.

## Put it on GitHub

1. Create a new GitHub repository named `maxxchat`.
2. Upload this project folder, or push it with Git.
3. Make sure these root files are included:
   - `package.json`
   - `server.js`
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
