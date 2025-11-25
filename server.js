// server.js
// Minimalni webhook: samo loguje FB + IG poruke

const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";

// --------------------
// 1) VERIFY (GET)
// --------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("🟢 WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  console.log("🔴 VERIFY FAILED");
  return res.sendStatus(403);
});

// --------------------
// 2) EVENTS (POST)
// --------------------
app.post("/webhook", (req, res) => {
  const body = req.body;

  // Facebook:  object === "page"
  // Instagram: object === "instagram" ili "instagram_account"
  if (
    body.object === "page" ||
    body.object === "instagram" ||
    body.object === "instagram_account"
  ) {
    for (const entry of body.entry || []) {
      const events =
        entry.messaging ||
        entry.standby || // IG ponekad koristi standby
        [];

      for (const event of events) {
        const senderId = event.sender && event.sender.id;
        const ts = event.timestamp
          ? new Date(event.timestamp).toISOString()
          : "no-ts";

        // LOGUJ PORUKE
        if (event.message) {
          const text = (event.message.text || "").trim();
          const fromEcho = event.message.is_echo === true;

          console.log(
            `💬 MSG | object: ${body.object} | sender: ${senderId} | echo: ${fromEcho} | time: ${ts}`
          );
          console.log(`   text: ${text}`);
        }

        // Ako želiš da vidiš i reakcije / ostalo, možeš i to da dodaš:
        if (event.reaction) {
          console.log(
            `💠 REACTION | object: ${body.object} | sender: ${senderId} | emoji: ${event.reaction.emoji} | action: ${event.reaction.action}`
          );
        }
      }
    }

    return res.sendStatus(200);
  }

  // Nešto što ne pratimo
  return res.sendStatus(404);
});

// --------------------
// 3) START SERVER
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server sluša na portu ${PORT}`);
});
