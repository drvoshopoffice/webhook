// server.js
// -------------------------------------
//  Meta Messenger → Webhook → Asana
//  Triger: reakcija stranice na poruku
// -------------------------------------

const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// ------------------------------
// CONFIG (iz .env fajla)
// ------------------------------
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;   // FB page token
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";
const ASANA_TOKEN = process.env.ASANA_TOKEN;               // Asana PAT
const ASANA_PROJECT_ID = process.env.ASANA_PROJECT_ID;     // Asana project GID

// Emoji koji trigeruje Asana task.
// Ubacio sam 👍 i ✅, slobodno promeni po želji.
const TARGET_REACTIONS = ["👍", "✅"];

// ------------------------------
// WEBHOOK VERIFICATION (GET)
// ------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("🔵 WEBHOOK VERIFIED");
      return res.status(200).send(challenge);
    } else {
      console.log("🔴 WEBHOOK VERIFY FAILED");
      return res.sendStatus(403);
    }
  }

  res.sendStatus(404);
});

// ------------------------------
// WEBHOOK EVENTS (POST)
// ------------------------------
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Za debug – po potrebi uključi:
  // console.log("RAW EVENT:", JSON.stringify(body, null, 2));

  if (body.object === "page") {
    for (const entry of body.entry || []) {
      const pageId = entry.id; // ID tvoje FB stranice
      const events = entry.messaging || [];

      for (const event of events) {
        // 1) Poruke (nije obavezno, ali korisno za debug)
        if (event.message) {
          console.log("💬 Poruka:", event.message.text);
        }

        // 2) Reakcije
        if (event.reaction) {
          const { emoji, action, mid } = event.reaction;
          const fromPage =
            event.sender && event.sender.id && event.sender.id === pageId;

          console.log(
            "💠 Reaction event:",
            "emoji:", emoji,
            "| action:", action,
            "| fromPage:", fromPage
          );

          // Triger samo ako:
          //  - reakcija je DODATA (react, ne unreact)
          //  - emoji je jedan od TARGET_REACTIONS
          //  - reakciju je poslala STRANICA (ti kao page)
          if (
            action === "react"
          ) {
            try {
              await handleReactionTrigger(event, pageId);
            } catch (err) {
              console.error("❌ Greška u handleReactionTrigger:", err.message);
            }
          }
        }
      }
    }

    return res.sendStatus(200);
  }

  res.sendStatus(404);
});

// ------------------------------
// HANDLE: reakcija stranice → Asana
// ------------------------------
async function handleReactionTrigger(event, pageId) {
  const customerPsid = event.recipient.id; // kupac
  const messageId = event.reaction.mid;    // ID poruke na koju si reagovao

  console.log(
    "🧩 Trigger iz reakcije (od page-a). PSID kupca:",
    customerPsid,
    "| MID:",
    messageId
  );

  // 1) Dovuci detalje poruke sa Graph API
  const url =
    `https://graph.facebook.com/v24.0/${messageId}` +
    `?fields=message,from,created_time,conversation{id,link}` +
    `&access_token=${PAGE_ACCESS_TOKEN}`;

  const resp = await axios.get(url);
  const data = resp.data;

  console.log("DATA:", data);

  const messageText = data.message || "(nema teksta)";
  const createdTime = data.created_time || "";
  const customerName = data.from?.name || "Nepoznato ime";

  const conversationId = data.conversation?.id || "";
  const conversationLink =
    data.conversation?.link ||
    (conversationId
      ? `https://www.facebook.com/messages/t/${conversationId}`
      : "");

  console.log("📦 Kreiram Asana task za:", customerName, "|", messageText);

  await createAsanaTask({
    customerName,
    messageText,
    createdTime,
    conversationLink,
  });
}

// ------------------------------
// CREATE ASANA TASK
// ------------------------------
async function createAsanaTask({
  customerName,
  messageText,
  createdTime,
  conversationLink,
}) {
  if (!ASANA_TOKEN || !ASANA_PROJECT_ID) {
    console.warn("⚠️ ASANA_TOKEN ili ASANA_PROJECT_ID nisu podešeni.");
    return;
  }

  const taskName = `FB porudžbina – ${customerName}`;
  const notesLines = [
    `Poruka: ${messageText}`,
    "",
    `Vreme: ${createdTime}`,
    "",
  ];

  if (conversationLink) {
    notesLines.push(`Razgovor: ${conversationLink}`);
  }

  const taskNotes = notesLines.join("\n");

  const payload = {
    data: {
      name: taskName,
      notes: taskNotes,
      projects: [ASANA_PROJECT_ID],
    },
  };

  const res = await axios.post(
    "https://app.asana.com/api/1.0/tasks",
    payload,
    {
      headers: {
        Authorization: `Bearer ${ASANA_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("✅ ASANA TASK KREIRAN:", res.data.data.gid);
}

// ------------------------------
// START SERVER
// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
