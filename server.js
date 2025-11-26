import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ENV VARS
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// ===============================
// WEBHOOK VERIFICATION (GET)
// ===============================
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("🔍 VERIFY REQUEST:", { mode, token, challenge });

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("🟢 WEBHOOK VERIFIED");
        return res.status(200).send(challenge);
    } else {
        console.log("🔴 VERIFY FAILED");
        return res.sendStatus(403);
    }
});

// ===============================
// WEBHOOK EVENTS (POST)
// ===============================
app.post("/webhook", (req, res) => {
    const body = req.body;

    // Respond to Meta immediately
    res.sendStatus(200);

    if (!body.object) return;

    // FACEBOOK & INSTAGRAM DM
    if (body.object === "page") {
        body.entry.forEach(entry => {

            // ➤ Messages (FB + IG)
            if (entry.messaging) {
                entry.messaging.forEach(event => {
                    if (event.message && event.message.text) {
                        console.log("💬 FB poruka:", event.message.text);
                    }
                });
            }

            // ➤ Instagram messaging webhook
            if (entry.changes) {
                entry.changes.forEach(change => {
                    if (change.field === "messages") {
                        const msg = change.value;

                        if (msg.message && msg.message.text) {
                            console.log("📩 IG DM:", msg.message.text);
                        }

                        if (msg.reaction) {
                            console.log("❤️ IG Reaction:", msg.reaction.emoji);
                        }
                    }
                });
            }

        });
    }
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`VERIFY_TOKEN = ${VERIFY_TOKEN ? "SET" : "MISSING"}`);
    console.log(`PAGE_ACCESS_TOKEN = ${PAGE_ACCESS_TOKEN ? "SET" : "MISSING"}`);
});
