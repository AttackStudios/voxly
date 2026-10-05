import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// TEMP fake database (replace later with real DB)
let servers = [
  { id: "1", name: "My First Server", inviteCode: "ABC123" }
];

let members = []; // { userId, serverId }

// JOIN SERVER endpoint (user enters code)
app.post("/api/join-server", (req, res) => {
  const { code } = req.body;

  const server = servers.find(s => s.inviteCode === code);

  if (!server) {
    return res.status(400).json({ error: "Invalid invite code" });
  }

  // Fake logged-in user ID for now
  const userId = "USER123";

  members.push({ userId, serverId: server.id });

  console.log("Members:", members);

  res.json({ serverId: server.id });
});

// Start server
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
