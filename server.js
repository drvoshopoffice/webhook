// server.js
// Webhook koji hvata FB + IG poruke,
// detektuje broj telefona i kreira Asana task,
// osim ako poruka dolazi sa određenog ID-a.

const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// ENV
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";

const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_PROJECT_ID = process.env.ASANA_PROJECT_ID;
const ASANA_URL = "https://app.asana.com/api/1.0/tasks";

// ID koji se ignoriše
const IGNORE_SENDER_ID = "17841451687614794";

// Regex za srpske telefone
const phoneRegex =
  /(\+?381|0)(6[0-9])[\s\-\/]?([0-9]{2,3})[\s\-\/]?([0-9]{2,3})[\s\-\/]?([0-9]{2,3})/g;

// -----------------------
// ASANA TASK
// -----------------------
async function createAsanaTask({ source, senderName, senderId, text, phones }) {
  if (!ASANA_TOKEN || !ASANA_PROJECT_ID) {
    console.warn("⚠️ ASANA_TOKEN ili ASANA_PROJECT_ID nisu podešeni – preskačem Asanu.");
    return;
  }

  const headers = {
    Authorization: `Bearer ${ASANA_TOKEN}`,
    "Content-Type": "application/json",
  };

  const payload = {
    data: {
      name: `Porudžbina (${source}) – ${senderName}`,
      notes: [
        `Izvor: ${source}`,
        `Ime: ${senderName}`,
        `ID: ${senderId}`,
        `Telefon(i): ${phones.join(", ")}`,
        "",
        "Poruka:",
        text,
      ].join("\n"),
      projects: [ASANA_PROJECT_ID],
    },
  };

  try {
    const res = await axios.post(ASANA_URL, payload, { headers });
    console.log("✅ Asana task kreiran:", res.data.data.gid);
  } catch (error) {
    console.error("❌ Greška Asana:", error.response?.data || error.message);
  }
}

// -----------------------
// VERIFY (GET)
// -----------------------
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

// -----------------------
// EVENTS (POST)
// -----------------------
app.post("/webhook", (req, res) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object === "page" || body.object === "instagram") {
    for (const entry of body.entry || []) {
      
      // FB + IG poruke
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const text = event.message?.text || "";
          const senderName = event.message?.from?.name || "Nepoznat";
          const senderId = event.sender?.id || "";
          const source = event.messaging_product || "facebook";

          // 🚫 Ignore internal sender
          if (senderId === IGNORE_SENDER_ID) {
            console.log("🚫 Ignorišem poruku (interni nalog):", senderId);
            continue;
          }

          if (text) {
            console.log("💬 PORUKA:", text);
            console.log(`👤 Od: ${senderName} (${senderId}) | Source: ${source}`);

            const phones = text.match(phoneRegex);
            if (phones) {
              console.log("📞 Detektovan broj:", phones);

              createAsanaTask({
                source,
                senderName,
                senderId,
                text,
                phones,
              });
            }
          }
        }
      }

      // Instagram "changes"
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "messages") {
            const msg = change.value;
            const text = msg.message?.text || "";
            const senderId = msg.message?.from?.id || "";
            const senderName = msg.message?.from?.name || "Nepoznat";

            // 🚫 Ignore internal
            if (senderId === IGNORE_SENDER_ID) {
              console.log("🚫 Ignorišem IG changes poruku:", senderId);
              continue;
            }

            if (text) {
              console.log("💬 IG poruka (changes):", text);
              console.log(`👤 Od: ${senderName} (${senderId})`);

              const phones = text.match(phoneRegex);
              if (phones) {
                console.log("📞 Detektovan broj:", phones);

                createAsanaTask({
                  source: "Instagram",
                  senderName,
                  senderId,
                  text,
                  phones,
                });
              }
            }
          }
        }
      }
    }
  }
});

// -----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook running on port ${PORT}`);
});
