// server.js – FB + IG messaging → detekcija telefona → Asana task
// Uključuje fetch Instagram/Facebook username preko Graph API.

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
// FETCH USERNAME
// -----------------------
async function fetchUserName(psid) {
  try {
    const url = `https://graph.facebook.com/v21.0/${psid}?fields=name,username&access_token=${PAGE_ACCESS_TOKEN}`;
    const res = await axios.get(url);

    // Instagram korisnici često imaju samo username
    return (
      res.data.username ||
      res.data.name ||
      null
    );
  } catch (err) {
    console.log(
      "⚠️ Ne mogu da dobijem ime/username za",
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
    console.warn("⚠️ Asana nije podešena.");
    return;
  }

  const headers = {
    Authorization: `Bearer ${ASANA_TOKEN}`,
    "Content-Type": "application/json",
  };

  const taskName = `Porudžbina (${source}) – ${senderName}`;

  const notesLines = [
    `Izvor: ${source}`,
    `Korisnik: ${senderName}`,
    `ID: ${senderId}`,
    `Telefon(i): ${phones.join(", ")}`,
    "",
    "Poruka:",
    text,
  ];

  try {
    const payload = {
      data: {
        name: taskName,
        notes: notesLines.join("\n"),
        projects: [ASANA_PROJECT_ID],
      },
    };

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
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }

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
        const source = event.messaging_product || "facebook";

        if (!text) continue;

        // Ignoriši interne poruke
        if (senderId === IGNORE_SENDER_ID) {
          console.log("🚫 Ignorišem svoj ID:", senderId);
          continue;
        }

        // 🔍 fetch username/name
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
    // Instagram changes
    // --------------------------
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;

        const msg = change.value;
        const text = msg.message?.text || "";
        const senderId = msg.message?.from?.id || "";
        const nameFromIG = msg.message?.from?.username || msg.message?.from?.name;

        if (!text) continue;

        if (senderId === IGNORE_SENDER_ID) {
          console.log("🚫 Ignorišem svoj IG ID:", senderId);
          continue;
        }

        const senderName =
          nameFromIG ||
          (await fetchUserName(senderId)) ||
          "Nepoznat";

        console.log("💬 IG poruka:", text);
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
});
