// server.js
// Webhook koji hvata samo poruke sa FB i IG + ime pošiljaoca + detekcija telefona

const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";

// Regex za srpske brojeve telefona
const phoneRegex =
  /(\+?381|0)(6[0-9])[\s\-\/]?([0-9]{2,3})[\s\-\/]?([0-9]{2,3})[\s\-\/]?([0-9]{2,3})/g;

// -----------------------------------------------------
// VERIFY WEBHOOK (GET)
// -----------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("🔵 WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  console.log("🔴 WEBHOOK VERIFY FAILED");
  return res.sendStatus(403);
});

// -----------------------------------------------------
// HANDLE WEBHOOK EVENTS (POST)
// -----------------------------------------------------
app.post("/webhook", (req, res) => {
  const body = req.body;

  // Meta mora odgovor odmah
  res.sendStatus(200);

  // FB Messenger + IG Messaging
  if (body.object === "page" || body.object === "instagram") {
    for (const entry of body.entry || []) {
      
      // --------------------------
      // FB + IG poruke (messaging)
      // --------------------------
      if (entry.messaging) {
        for (const event of entry.messaging) {

          // Facebook i Instagram šalju ime u event.message.from.name
          const senderName = event.message?.from?.name || "Nepoznat pošiljalac";
          const senderId   = event.sender?.id || "N/A";
          const text       = event.message?.text || "";

          if (text) {
            console.log(`💬 NOVA PORUKA`);
            console.log(`👤 Od: ${senderName} (${senderId})`);
            console.log(`✉️  Tekst: ${text}`);

            const phones = text.match(phoneRegex);
            if (phones) console.log("📞 Detektovan broj:", phones);

            console.log("──────────────");
          }
        }
      }

      // --------------------------
      // IG (changes) webhook
      // --------------------------
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "messages") {
            const msg  = change.value;
            const text = msg.message?.text || "";
            const name = msg.message?.from?.name || "Nepoznat IG korisnik";

            if (text) {
              console.log(`💬 IG PORUKA`);
              console.log(`👤 Od: ${name}`);
              console.log(`✉️  Tekst: ${text}`);

              const phones = text.match(phoneRegex);
              if (phones) console.log("📞 Detektovan broj:", phones);

              console.log("──────────────");
            }
          }
        }
      }
    }
  }
});

// -----------------------------------------------------
// START SERVER
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
});
