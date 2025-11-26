// server.js
// Minimalni webhook: loguje FB i IG poruke + reakcije (nema Asane)

const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// ENV
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";

// ------------------------------
// WEBHOOK VERIFICATION (GET)
// (isto kao u tvom starom fajlu koji radi)
// ------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔍 VERIFY REQUEST:", { mode, token, challenge });
  console.log("   EXPECTED TOKEN:", VERIFY_TOKEN);

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("🔵 WEBHOOK VERIFIED");
      return res.status(200).send(challenge);
    } else {
      console.log("🔴 WEBHOOK VERIFY FAILED");
      return res.sendStatus(403);
    }
  }

  return res.sendStatus(404);
});

// ------------------------------
// WEBHOOK EVENTS (POST)
// ------------------------------
app.post("/webhook", (req, res) => {
  const body = req.body;

  console.log("🔍 RECEIVED BODY:", body);

  // obavezno FB-u odmah odgovorimo 200
  res.sendStatus(200);

  // Facebook Messenger + Instagram Messaging idu pod object: "page"
  if (body.object === "page") {
    for (const entry of body.entry || []) {
      const pageId = entry.id;

      // 1) FB/IG poruke preko Messenger API-ja
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const product = event.messaging_product || "facebook"; // "instagram" ili "facebook"
          const fromId = event.sender && event.sender.id;

          if (event.message) {
            const text = (event.message.text || "").trim();
            console.log(
              `💬 ${product.toUpperCase()} MSG | from: ${fromId} | text: ${text}`
            );
          }

          if (event.reaction) {
            console.log(
              `💠 ${product.toUpperCase()} REACTION | from: ${fromId} | emoji: ${event.reaction.emoji} | action: ${event.reaction.action}`
            );
          }
        }
      }

      // 2) (opciono) IG webhookovi preko Instagram Graph API-ja
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "messages") {
            const v = change.value;

            if (v.message && v.message.text) {
              console.log(
                `📩 IG (changes) MSG | text: ${v.message.text}`
              );
            }
            if (v.reaction) {
              console.log(
                `❤️ IG (changes) REACTION | emoji: ${v.reaction.emoji}`
              );
            }
          }
        }
      }
    }
  }
});

// ------------------------------
// START SERVER
// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`   VERIFY_TOKEN set: ${!!VERIFY_TOKEN}`);
  console.log(`   PAGE_ACCESS_TOKEN set: ${!!PAGE_ACCESS_TOKEN}`);
});
