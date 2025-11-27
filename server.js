// server.js – FB + IG messaging → detekcija telefona → Asana task
// Ispravna razlika između FB i IG izvora, bez username deprecated problema.

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
// Pomoćne funkcije
// -----------------------

// Odredi da li je poruka sa FB ili IG (za entry.messaging)
function getSourceForMessaging(event, bodyObject) {
  const prod = (event.messaging_product || "").toLowerCase();
  if (prod === "instagram") return "Instagram";
  if (prod === "facebook") return "Facebook";
  if (bodyObject === "instagram") return "Instagram";
  return "Facebook";
}

// Odredi izvor za entry.changes
function getSourceForChange(change, bodyObject) {
  const prod = (change.value?.messaging_product || "").toLowerCase();
  if (prod === "instagram") return "Instagram";
  if (prod === "facebook") return "Facebook";
  if (bodyObject === "instagram") return "Instagram";
  return "Facebook";
}

// Samo za Facebook – pokušaj da dohvatiš name
async function fetchUserName(psid) {
  try {
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

// Kreiranje Asana taska
async function createAsanaTask({ source, senderName, senderId, text, phones }) {
  if (!ASANA_TOKEN || !ASANA_PROJECT_ID) {
    console.warn("⚠️ Asana nije podešena – preskačem kreiranje taska.");
    return;
  }

  const headers = {
    Authorization: `Bearer ${ASANA_TOKEN}`,
    "Content-Type": "application/json",
  };

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

        if (!text) continue;

        // ignoriši tvoj nalog
        if (senderId === IGNORE_SENDER_ID) {
          console.log("🚫 Ignorišem svoj ID:", senderId);
          continue;
        }

        const source = getSourceForMessaging(event, body.object);
        let senderName = "Nepoznat";

        // Za Facebook probaj da povučeš ime; za Instagram NE zovemo Graph (da izbegnemo #200)
        if (source === "Facebook") {
          senderName = (await fetchUserName(senderId)) || "Nepoznat";
        }

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

        console.log("────────────────────────────────────────────────────────────────────────────────────");
      }
    }

    // --------------------------
    // Instagram "changes" (IG Graph webhook)
    // --------------------------
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;

        const msg = change.value;
        const text = msg.message?.text || "";
        const senderId = msg.message?.from?.id || "";
        const source = getSourceForChange(change, body.object);

        if (!text) continue;

        if (senderId === IGNORE_SENDER_ID) {
          console.log("🚫 Ignorišem svoj IG ID (changes):", senderId);
          continue;
        }

        // IG često šalje username/name u samom webhooku
        const nameFromIG =
          msg.message?.from?.username || msg.message?.from?.name;

        let senderName = nameFromIG || "Nepoznat";

        // Ako se desi da je source zapravo Facebook (ređe) i nemamo ime, možemo probati Graph:
        if (senderName === "Nepoznat" && source === "Facebook") {
          senderName = (await fetchUserName(senderId)) || "Nepoznat";
        }

        console.log("💬 IG poruka (changes):", text);
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

        console.log("────────────────────────────────────────────────────────────────────────────────────");
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
