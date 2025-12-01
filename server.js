// server.js – FB + IG messaging → detekcija telefona → Asana task

const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// -----------------------
// ENV PROMENLJIVE
// -----------------------
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";

const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_PROJECT_ID = process.env.ASANA_PROJECT_ID;
const ASANA_URL = "https://app.asana.com/api/1.0/tasks";

// ID koji se ignoriše (tvoj nalog)
const IGNORE_SENDER_ID = "17841451687614794";

// -----------------------
// TELEFON – REGEX + NORMALIZACIJA
// -----------------------

// Hvata realne srpske mobilne brojeve bez obzira na razmake/crtice/slash
// Primeri koje pokriva:
//  - 0641234567
//  - 064 123 4567
//  - 069 583-683-3
//  - +38164/123-45-67
const phoneRegex =
  /(\+?381|0)\s*6\d(?:[\s\-\/]*\d){6,8}/g;

/**
 * Ekstraktuje brojeve iz teksta i normalizuje ih:
 * - uklanja razmake, crtice, slash
 * - 0xxxxxxxx → +381xxxxxxxx
 * - ako već ima +381, ostaje
 */
function extractPhones(text) {
  const matches = text.match(phoneRegex);
  if (!matches) return null;

  return matches.map((raw) => {
    // Ukloni sve osim + i cifara
    let cleaned = raw.replace(/[^\d+]/g, "");

    // Ako počinje sa 0 → prebaci u +381
    if (cleaned.startsWith("0")) {
      cleaned = "+381" + cleaned.slice(1);
    }

    return cleaned;
  });
}

// -----------------------
// POMOĆNE FUNKCIJE ZA IZVOR (FB / IG)
// -----------------------
function getSourceForMessaging(event, bodyObject) {
  const prod = (event.messaging_product || "").toLowerCase();
  if (prod === "instagram") return "Instagram";
  if (prod === "facebook") return "Facebook";
  if (bodyObject === "instagram") return "Instagram";
  return "Facebook";
}

function getSourceForChange(change, bodyObject) {
  const prod = (change.value?.messaging_product || "").toLowerCase();
  if (prod === "instagram") return "Instagram";
  if (prod === "facebook") return "Facebook";
  if (bodyObject === "instagram") return "Instagram";
  return "Facebook";
}

// -----------------------
// FETCH USER NAME (samo FB)
// -----------------------
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

  // Ako nema ime, koristi ID u nazivu
  const displayName =
    senderName && senderName !== "Nepoznat" ? senderName : senderId;

  const taskName = `[IME I PREZIME] - [ARTIKAL] - (${source}) – ${displayName}`;

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
// VERIFY WEBHOOK (GET)
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
// WEBHOOK EVENTS (POST)
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

        if (!text) continue;

        // Ignoriši tvoj nalog
        if (senderId === IGNORE_SENDER_ID) {
          console.log("🚫 Ignorišem svoj ID:", senderId);
          continue;
        }

        const source = getSourceForMessaging(event, body.object);

        // Pokušaj da izvučeš ime direktno iz eventa (retko prisutno)
        const rawNameFromEvent =
          event.message?.from?.username ||
          event.message?.from?.name ||
          null;

        let senderName = rawNameFromEvent || "Nepoznat";

        // Za Facebook – probaj preko Graph API ako nemamo ime
        if (senderName === "Nepoznat" && source === "Facebook") {
          senderName = (await fetchUserName(senderId)) || "Nepoznat";
        }

        console.log("💬 PORUKA:", text);
        console.log(`👤 Od: ${senderName} (${senderId}) | Source: ${source}`);

        const phones = extractPhones(text);
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

        console.log("──────────────");
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

        const nameFromIG =
          msg.message?.from?.username || msg.message?.from?.name;

        let senderName = nameFromIG || "Nepoznat";

        // Ako se desi da je source ipak Facebook i nemamo ime, probaj Graph
        if (senderName === "Nepoznat" && source === "Facebook") {
          senderName = (await fetchUserName(senderId)) || "Nepoznat";
        }

        console.log("💬 IG poruka (changes):", text);
        console.log(`👤 Od: ${senderName} (${senderId}) | Source: ${source}`);

        const phones = extractPhones(text);
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
