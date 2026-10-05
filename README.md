# Discord Clone (invite-only)

A self-hosted Discord-style platform: servers + channels, DMs, group chats, voice/video
calls, screen sharing, **remote desktop control** (consent-gated), global + per-server
**ranks**, and **bottom-right desktop notifications** with inline quick-reply + quick-call.

Login-only / invite-only: there is **no public sign-up**. Accounts are created by the
owner with the admin CLI and the credentials are handed to friends.

## Stack
- **Backend** (`server/`): Node + Express + Socket.IO. Pure-JS JSON database (`server/data/db.json`,
  no native modules), `bcryptjs` password hashing, JWT auth (30-day tokens).
- **Frontend** (`src/`): React + Vite. Talks to the backend over REST + Socket.IO.
- **Desktop app** (`electron/`): Electron wrapper that adds the custom bottom-right toast
  window (reply + call) and native mouse/keyboard injection (`@nut-tree-fork/nut-js`) for
  remote control. The plain web app works in any browser too (minus the custom toast +
  remote-control injection).

## Run it

```bash
npm install

# 1) create accounts (this is the ONLY way users are made)
npm run admin -- create-user you@example.com 'YourPassword' 'Your Name' owner
npm run admin -- create-user friend@example.com 'TheirPassword' 'Friend Name'

# 2) start backend + web app (two processes)
npm run stack          # = server (:3001) + vite dev (:5173)

# 3) optionally launch the desktop app (adds toasts + remote control)
npm run electron       # loads http://localhost:5173

# …or all three at once:
npm run app
```

Open http://localhost:5173 and log in with an account you created.

## Admin CLI (account & rank management)

```bash
npm run admin -- create-user <email> <password> "<Display Name>" [owner|staff]
npm run admin -- list-users
npm run admin -- set-rank <email> <owner|staff|none>     # global rank (shows in ALL servers)
npm run admin -- reset-password <email> <newPassword>
npm run admin -- rename <email> "<New Name>"
npm run admin -- delete-user <email>
```

## Ranks
- **Global ranks** (`owner`, `staff`) live on the user and show in **every** server with a
  colored badge. Set via the admin CLI. Global owner/staff can moderate any server.
- **Server ranks** (`admin`, `mod`, `member`) apply to **one** server only. Set in-app by
  clicking a member in the member list (if you can manage that server).

## Features
- **Servers & channels** — create servers (get an invite code), text + voice channels.
- **DMs & group chats** — start a 1:1 or multi-person group from the Home panel or a member.
- **Realtime** — messages, typing, presence (online/offline) over Socket.IO.
- **Voice / video calls** — WebRTC mesh. Call from a DM header (📞 / 📹) or join a voice channel.
- **Screen share** — 🖥️ in a call. In Electron it auto-grants screen capture.
- **Remote control** — while screen-sharing, the viewer clicks "Request control"; the sharer
  must click **Allow**. Then the viewer's mouse/keyboard over the video drive the sharer's
  machine (Electron + nut-js). The sharer can hit **Stop control** anytime. macOS will prompt
  for Accessibility permission on first use (System Settings → Privacy → Accessibility).
- **Desktop notifications** — bottom-right toast with sender, message, a quick-reply field,
  and a quick-call button. Native (separate always-on-top window) in Electron; in-app toast
  in the browser.

## Making it reachable from anywhere (US/Canada/etc.)
Currently it runs on localhost. To expose it to friends without port-forwarding, run a
tunnel pointing at the backend port and serve the built frontend from it. Easiest options:

```bash
npm run build                          # builds dist/
cloudflared tunnel --url http://localhost:3001    # free public https URL
# or: tailscale funnel 3001
```
For cross-network WebRTC (calls between different homes), add a TURN server to
`ICE_SERVERS` in `src/lib/webrtc.js` (STUN is already configured).

## Security notes
- `server/data/` (database + JWT secret) is gitignored — never commit it.
- This is built for a trusted friend group. Remote control is real remote access; only
  grant it to people you trust, and revoke when done.
