// server.js – FB + IG messaging → detekcija telefona → Asana task
// Koristi name/username kad može, inače ID. Ignoriše tvoj nalog.

// -----------------------
// IMPORTI & CONFIG
// -----------------------
const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// Meta env
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";

// Asana env
const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_PROJECT_ID = process.env.ASANA_PROJECT_ID;
const ASANA_URL = "https://app.asana.com/api/1.0/tasks";

// ID koji se ignoriše (tvoj nalog)
const IGNORE_SENDER_ID = "17841451687614794";

// Regex za srpske telefone
const phoneRegex =
  /(\+?381|0)(6[0-9])[\s\-\/]?([0-9]{2,3})[\s\-\/]?([0-9]{2,3})[\s\-\/]?([0-9]{2,3})/g;

// -----------------------
// FETCH USER NAME (FB/IG PSID -> name)
// -----------------------
async function fetchUserName(psid) {
  try {
    // username je deprecated za FB; tražimo samo name
    const url = `https://graph.facebook.com/v21.0/${psid}?fields=name&access_token=${PAGE_ACCESS_TOKEN}`;
    const res = await axios.get(url);
    return res.data.name || null;
  } catch (err) {
    console.log(
      "⚠️ Ne mogu da dobijem ime za",
      psid,
      "-",
      err.response?.data?.error?.message || err.message
    );
    return null;
  }
}

// -----------------------
// ASANA TASK
// -----------------------
async function createAsanaTask({ source, senderName, senderId, text, phones }) {
  if (!ASANA_TOKEN || !ASANA_PROJECT_ID) {
    console.warn("⚠️ Asana nije podešena – preskačem kreiranje taska.");
    return;
  }

  const headers = {
    Authorization: `Bearer ${ASANA_TOKEN}`,
    "Content-Type": "application/json",
  };

  // Ako nema ime, koristi ID u nazivu taska
  const displayName =
    senderName && senderName !== "Nepoznat" ? senderName : senderId;

  const taskName = `Porudžbina (${source}) – ${displayName}`;

  const notesLines = [
    `Izvor: ${source}`,
    `Korisnik: ${senderName}`,
    `ID: ${senderId}`,
    `Telefon(i): ${phones.join(", ")}`,
    "",
    "Poruka:",
    text,
  ];

  const payload = {
    data: {
      name: taskName,
      notes: notesLines.join("\n"),
      projects: [ASANA_PROJECT_ID],
    },
  };

  try {
    const res = await axios.post(ASANA_URL, payload, { headers });
    console.log("✅ Asana task kreiran:", res.data.data.gid);
  } catch (err) {
    console.error(
      "❌ Greška Asana:",
      err.response?.data || err.message
    );
  }
}

// -----------------------
// VERIFY WEBHOOK
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
// WEBHOOK EVENTS
// -----------------------
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Meta očekuje odgovor odmah
  res.sendStatus(200);

  if (body.object !== "page" && body.object !== "instagram") return;

  for (const entry of body.entry || []) {
    // --------------------------
    // FB + IG poruke (entry.messaging)
    // --------------------------
    if (entry.messaging) {
      for (const event of entry.messaging) {
        const text = event.message?.text || "";
        const senderId = event.sender?.id || "";
        const source = event.messaging_product || "facebook"; // 'facebook' ili 'instagram'

        if (!text) continue;

        // ignoriši tvoj nalog
        if (senderId === IGNORE_SENDER_ID) {
          console.log("🚫 Ignorišem svoj ID:", senderId);
          continue;
        }

        // pokušaj da dobiješ ime sa Graph API-ja
        const senderName =
          (await fetchUserName(senderId)) || "Nepoznat";

        console.log("💬 PORUKA:", text);
        console.log(`👤 Od: ${senderName} (${senderId}) | Source: ${source}`);

        const phones = text.match(phoneRegex);
        if (phones) {
          console.log("📞 Detektovan broj:", phones);

          createAsanaTask({
            source: source === "instagram" ? "Instagram" : "Facebook",
            senderName,
            senderId,
            text,
            phones,
          });
        }

        console.log("──────────────");
      }
    }

    // --------------------------
    // Instagram "changes" (ponekad IG šalje poruke ovde)
    // --------------------------
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;

        const msg = change.value;
        const text = msg.message?.text || "";
        const senderId = msg.message?.from?.id || "";
        const nameFromIG =
          msg.message?.from?.username || msg.message?.from?.name;

        if (!text) continue;

        if (senderId === IGNORE_SENDER_ID) {
          console.log("🚫 Ignorišem svoj IG ID (changes):", senderId);
          continue;
        }

        // prvo probaj šta IG sam pošalje, pa onda Graph API, pa "Nepoznat"
        const senderName =
          nameFromIG ||
          (await fetchUserName(senderId)) ||
          "Nepoznat";

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

        console.log("──────────────");
      }
    }
  }
});

// -----------------------
// START SERVER
// -----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook radi na portu ${PORT}`);
  console.log(`   VERIFY_TOKEN set: ${!!VERIFY_TOKEN}`);
  console.log(`   PAGE_ACCESS_TOKEN set: ${!!PAGE_ACCESS_TOKEN}`);
  console.log(`   ASANA_TOKEN set: ${!!ASANA_TOKEN}`);
  console.log(`   ASANA_PROJECT_ID set: ${!!ASANA_PROJECT_ID}`);
});
