// server.js
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;   // ostavljeno, ali se ne koristi
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";
const ASANA_TOKEN = process.env.ASANA_TOKEN;               // ostavljeno, ali se ne koristi
const ASANA_PROJECT_ID = process.env.ASANA_PROJECT_ID;     // ostavljeno, ali se ne koristi

// ------------------------
// 1) VERIFY WEBHOOK
// ------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("🟢 WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ------------------------
// 2) RECEIVE EVENTS
// ------------------------
app.post("/webhook", (req, res) => {
  const body = req.body;

  if (
    body.object === "page" ||
    body.object === "instagram" ||
    body.object === "instagram_account"
  ) {
    for (const entry of body.entry || []) {
      const events =
        entry.messaging ||
        entry.standby ||
        [];

      for (const event of events) {
        const sender = event.sender?.id;

        // LOG messages
        if (event.message) {
          console.log(`💬 Message from ${sender}: ${event.message.text}`);
        }

        // LOG reactions
        if (event.reaction) {
          console.log(
            `💠 Reaction from ${sender}: ${event.reaction.emoji} (${event.reaction.action})`
          );
        }
      }
    }

    return res.sendStatus(200);
  }

  return res.sendStatus(404);
});

// ------------------------
// 3) START SERVER
// ------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook listening on port ${PORT}`);
});
