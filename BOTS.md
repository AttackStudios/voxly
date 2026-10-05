# Voxly Bot API

Voxly bots work a lot like Discord bots. A bot is a special account that you
control with a **token**. It can read messages in the servers it's added to,
reply with text or rich **embeds**, edit and delete its own messages, and DM
people.

## 1. Make a bot

1. In Voxly, open **User Settings → Developer Portal**.
2. Type a name and click **New Bot**.
3. **Copy the token right away.** It's only shown once. If you lose it, click
   **Reset Token**, which also kills the old one.
4. Copy the bot's **ID**. Then, in a server you own or admin, go to
   **Server Settings → Bots** and paste the ID. Bots you own also appear there as
   one-click **Add** buttons.

Keep the token secret. Anyone who has it can act as your bot.

## 2. Authentication

| Where | How |
|---|---|
| REST | header `Authorization: Bot <token>` |
| Realtime | Socket.IO, `io(BASE_URL, { auth: { botToken: '<token>' } })` |

`BASE_URL` is your Voxly site, e.g. `https://voxly-30dh.onrender.com`. Every ID
is a UUID string.

## 3. Realtime events (Socket.IO)

| Event | Payload |
|---|---|
| `ready` | `{ user, servers }`, sent on every (re)connect |
| `message:new` | a **Message** (any channel of your servers, or your DMs) |
| `message:updated` | a **Message** |
| `message:deleted` | `{ id, channelId, dmId }` |
| `server:joined` | `{ server }`, when someone adds your bot |
| `server:member-joined` / `server:member-left` | member changes |

Your bot automatically receives messages from every channel in its servers,
including channels created later.

### Message

```json
{
  "id": "uuid", "channelId": "uuid|null", "dmId": "uuid|null", "serverId": "uuid",
  "authorId": "uuid", "author": { "id": "...", "displayName": "Amy", "bot": false },
  "content": "cat!help", "mentions": ["userId"], "attachments": [{ "url": "/uploads/..." }],
  "embeds": [], "replyToId": null, "createdAt": 1760000000000
}
```

## 4. REST endpoints

All endpoints live under `BASE_URL/api/v1`.

| Method | Path | Notes |
|---|---|---|
| GET | `/users/@me` | your bot |
| GET | `/users/:id` | any user |
| GET | `/servers` | servers your bot is in |
| GET | `/servers/:id` | server + `channels` |
| GET | `/servers/:id/members` | members with `serverRank`, `isOwner` |
| GET | `/servers/:id/members/:userId` | one member, plus `canManage` (owner/admin) |
| GET | `/channels/:id` | `{ id, name, type, serverId }` (DM ids give `type: "dm"`) |
| GET | `/channels/:id/messages?limit=50` | recent history (max 100) |
| POST | `/channels/:id/messages` | send: `{ content?, embeds?, replyToId? }` |
| PATCH | `/messages/:id` | edit your message: `{ content?, embeds? }` |
| DELETE | `/messages/:id` | delete (yours, or any if your bot is a moderator) |
| POST | `/dms` | `{ userId }` returns `{ id }`, then POST to `/channels/{id}/messages` |

`:id` in `/channels/:id/messages` can be a server channel or a DM conversation.
A bot can only DM people it shares a server with.

Errors come back as `{ "error": "..." }` with status 400, 401, 403 or 404.

## 5. Formatting

Message text supports Discord-style markdown:

- `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `||spoiler||`
- `` `code` `` and fenced code blocks
- `> quotes`, `# headings`
- `<@userId>` mentions (these ping the user), `<#channelId>` channel links
- `<t:UNIX:R>` timestamps (styles `t T d D f F R`)

### Embeds (up to 5 per message)

```json
{
  "title": "A wild cat has appeared! 🐱", "description": "Be quick to claim it!",
  "url": "https://…", "color": 5793266,
  "author": { "name": "Cat Bot", "icon_url": "https://…" },
  "fields": [{ "name": "Catnip", "value": "**6** 🌿", "inline": true }],
  "thumbnail": { "url": "https://…" }, "image": { "url": "https://…" },
  "footer": { "text": "Claim it by typing cat" }, "timestamp": "2026-10-05T12:00:00Z"
}
```

## 6. Minimal Python bot

```python
import asyncio, aiohttp, socketio

BASE, TOKEN = "https://voxly-30dh.onrender.com", "PASTE_TOKEN"
sio = socketio.AsyncClient()

@sio.on("message:new")
async def on_message(msg):
    if msg["author"]["bot"] or msg["content"] != "!ping":
        return
    async with aiohttp.ClientSession(headers={"Authorization": f"Bot {TOKEN}"}) as http:
        await http.post(f"{BASE}/api/v1/channels/{msg['channelId'] or msg['dmId']}/messages",
                        json={"content": "Pong! 🏓", "replyToId": msg["id"]})

async def main():
    await sio.connect(BASE, auth={"botToken": TOKEN}, transports=["websocket"])
    await sio.wait()

asyncio.run(main())
```

`pip install "python-socketio[asyncio_client]" aiohttp`

## 7. Minimal Node bot

```js
import { io } from 'socket.io-client';
const BASE = 'https://voxly-30dh.onrender.com', TOKEN = 'PASTE_TOKEN';
const sock = io(BASE, { auth: { botToken: TOKEN }, transports: ['websocket'] });
sock.on('message:new', async (m) => {
  if (m.author.bot || m.content !== '!ping') return;
  await fetch(`${BASE}/api/v1/channels/${m.channelId || m.dmId}/messages`, {
    method: 'POST', headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Pong! 🏓', replyToId: m.id }),
  });
});
```
