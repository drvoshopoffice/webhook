// server.js – FB + IG messaging → detekcija telefona → Asana + Dr Vo Manager (parallel)
//
// Deploy on Render as the Meta webhook receiver during the transition period.
// Modes (DRVO_INTEGRATION_MODE):
//   ASANA_ONLY — existing Asana behaviour only (fallback)
//   BOTH       — Asana + Dr Vo Manager (intended transition mode)
//   DRVO_ONLY  — Dr Vo Manager only (do not activate until approved)
//
// Asana and Dr Vo delivery are isolated: failure of one never blocks the other.

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// -----------------------
// ENV PROMENLJIVE
// -----------------------
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test123";

const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_PROJECT_ID = process.env.ASANA_PROJECT_ID;
const ASANA_URL = "https://app.asana.com/api/1.0/tasks";

const DRVO_FORWARD_URL =
  process.env.DRVO_FORWARD_URL ||
  process.env.DRVO_INCOMING_URL ||
  "";
const META_FORWARD_SECRET = process.env.META_FORWARD_SECRET || "";
const DRVO_INTEGRATION_MODE = (
  process.env.DRVO_INTEGRATION_MODE || "BOTH"
).toUpperCase();
const DRVO_DELIVERY_PAUSED =
  String(process.env.DRVO_DELIVERY_PAUSED || "false").toLowerCase() === "true";

// ID koji se ignoriše (tvoj nalog)
const IGNORE_SENDER_ID = "17841451687614794";

function shouldCreateAsana() {
  return (
    DRVO_INTEGRATION_MODE === "ASANA_ONLY" ||
    DRVO_INTEGRATION_MODE === "BOTH"
  );
}

function shouldForwardToDrVo() {
  if (DRVO_DELIVERY_PAUSED) return false;
  return (
    DRVO_INTEGRATION_MODE === "DRVO_ONLY" ||
    DRVO_INTEGRATION_MODE === "BOTH"
  );
}

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

function platformEnum(source) {
  return source === "Instagram" ? "INSTAGRAM" : "FACEBOOK";
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
// ASANA TASK (unchanged formatting)
// -----------------------
async function createAsanaTask({ source, senderName, senderId, text, phones }) {
  if (!shouldCreateAsana()) {
    return { skipped: true, reason: DRVO_INTEGRATION_MODE };
  }

  if (!ASANA_TOKEN || !ASANA_PROJECT_ID) {
    console.warn("⚠️ Asana nije podešena – preskačem kreiranje taska.");
    return { skipped: true, reason: "missing_credentials" };
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
    const res = await axios.post(ASANA_URL, payload, { headers, timeout: 15000 });
    const gid = res.data?.data?.gid;
    console.log("✅ Asana task kreiran:", gid);
    return { ok: true, gid };
  } catch (err) {
    console.error(
      "❌ Greška Asana:",
      err.response?.data || err.message
    );
    return { ok: false, error: err.response?.data || err.message };
  }
}

// -----------------------
// DR VO MANAGER FORWARD (isolated)
// -----------------------
function signDrVoPayload(rawBody, timestamp) {
  if (!META_FORWARD_SECRET) return null;
  return (
    "sha256=" +
    crypto
      .createHmac("sha256", META_FORWARD_SECRET)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex")
  );
}

async function forwardToDrVo({
  source,
  senderName,
  senderId,
  text,
  phones,
  messageId,
  pageId,
  timestamp,
  hasAttachment,
  integrationEventId,
}) {
  if (!shouldForwardToDrVo()) {
    return { skipped: true, reason: DRVO_DELIVERY_PAUSED ? "paused" : DRVO_INTEGRATION_MODE };
  }

  if (!DRVO_FORWARD_URL || !META_FORWARD_SECRET) {
    console.warn("⚠️ DRVO_FORWARD_URL ili META_FORWARD_SECRET nisu podešeni.");
    return { skipped: true, reason: "missing_credentials" };
  }

  const payload = {
    platform: platformEnum(source),
    pageId: pageId || "unknown",
    senderId,
    messageId: messageId || `render_${Date.now()}_${senderId}`,
    text,
    timestamp: timestamp || Date.now(),
    senderName,
    phones: phones || [],
    messageDirection: "INBOUND",
    hasAttachment: Boolean(hasAttachment),
    integrationEventId:
      integrationEventId ||
      `${platformEnum(source)}:${pageId || "unknown"}:${messageId || Date.now()}`,
  };

  const rawBody = JSON.stringify(payload);
  const ts = String(Date.now());
  const signature = signDrVoPayload(rawBody, ts);

  const headers = {
    Authorization: `Bearer ${META_FORWARD_SECRET}`,
    "Content-Type": "application/json",
    "X-DrVo-Timestamp": ts,
  };
  if (signature) {
    headers["X-DrVo-Signature"] = signature;
  }

  try {
    const res = await axios.post(DRVO_FORWARD_URL, rawBody, {
      headers,
      timeout: 15000,
      // axios string body — send as already-serialized JSON
      transformRequest: [(data) => data],
    });
    console.log("✅ Forwarded to Dr Vo:", res.data);
    return { ok: true, data: res.data };
  } catch (err) {
    console.error(
      "❌ Greška Dr Vo forward:",
      err.response?.data || err.message
    );
    return { ok: false, error: err.response?.data || err.message };
  }
}

/**
 * Fire Asana and Dr Vo independently. Do not await Dr Vo before Asana.
 * Do not let either failure block the other.
 */
async function deliverPhoneDetection(ctx) {
  const asanaPromise = createAsanaTask(ctx).catch((err) => ({
    ok: false,
    error: err.message,
  }));
  const drvoPromise = forwardToDrVo(ctx).catch((err) => ({
    ok: false,
    error: err.message,
  }));

  const [asana, drvo] = await Promise.all([asanaPromise, drvoPromise]);
  return { asana, drvo };
}

async function handleInboundMessage({
  text,
  senderId,
  source,
  senderName,
  messageId,
  pageId,
  timestamp,
  hasAttachment,
}) {
  if (!text) return;
  if (senderId === IGNORE_SENDER_ID) {
    console.log("🚫 Ignorišem svoj ID:", senderId);
    return;
  }

  console.log("💬 PORUKA:", text);
  console.log(`👤 Od: ${senderName} (${senderId}) | Source: ${source}`);

  const phones = extractPhones(text);
  if (phones) {
    console.log("📞 Detektovan broj:", phones);
    const result = await deliverPhoneDetection({
      source,
      senderName,
      senderId,
      text,
      phones,
      messageId,
      pageId,
      timestamp,
      hasAttachment,
    });
    console.log("📦 Delivery:", JSON.stringify(result));
  }

  console.log("──────────────");
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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: DRVO_INTEGRATION_MODE,
    asana: shouldCreateAsana(),
    drvo: shouldForwardToDrVo(),
    paused: DRVO_DELIVERY_PAUSED,
  });
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
    const pageId = entry.id || "";

    // --------------------------
    // FB + IG poruke (entry.messaging)
    // --------------------------
    if (entry.messaging) {
      for (const event of entry.messaging) {
        const text = event.message?.text || "";
        const senderId = event.sender?.id || "";
        const source = getSourceForMessaging(event, body.object);

        const rawNameFromEvent =
          event.message?.from?.username ||
          event.message?.from?.name ||
          null;

        let senderName = rawNameFromEvent || "Nepoznat";

        if (senderName === "Nepoznat" && source === "Facebook") {
          senderName = (await fetchUserName(senderId)) || "Nepoznat";
        }

        await handleInboundMessage({
          text,
          senderId,
          source,
          senderName,
          messageId: event.message?.mid,
          pageId,
          timestamp: event.timestamp,
          hasAttachment: Boolean(event.message?.attachments?.length),
        });
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

        const nameFromIG =
          msg.message?.from?.username || msg.message?.from?.name;

        let senderName = nameFromIG || "Nepoznat";

        if (senderName === "Nepoznat" && source === "Facebook") {
          senderName = (await fetchUserName(senderId)) || "Nepoznat";
        }

        await handleInboundMessage({
          text,
          senderId,
          source,
          senderName,
          messageId: msg.message?.mid || msg.message_id,
          pageId,
          timestamp: msg.timestamp || Date.now(),
          hasAttachment: Boolean(msg.message?.attachments?.length),
        });
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
  console.log(`   DRVO_INTEGRATION_MODE: ${DRVO_INTEGRATION_MODE}`);
  console.log(`   DRVO_FORWARD_URL set: ${!!DRVO_FORWARD_URL}`);
  console.log(`   META_FORWARD_SECRET set: ${!!META_FORWARD_SECRET}`);
  console.log(`   DRVO_DELIVERY_PAUSED: ${DRVO_DELIVERY_PAUSED}`);
});

module.exports = {
  extractPhones,
  shouldCreateAsana,
  shouldForwardToDrVo,
  createAsanaTask,
  forwardToDrVo,
  deliverPhoneDetection,
};
