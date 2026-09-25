// ╔══════════════════════════════════════════════════════╗
// ║  WhatsApp Cloud API — delivery status webhook          ║
// ║  Meta calls this AFTER accepting a message, with the   ║
// ║  real outcome: sent -> delivered -> read, or failed.   ║
// ║  Without this, "accepted" in our own logs is the last  ║
// ║  thing we ever know about a message.                   ║
// ╚══════════════════════════════════════════════════════╝
const router = require('express').Router();

// ── Meta's one-time verification handshake ──────────────
// Set this exact string in Meta App Dashboard → WhatsApp → Configuration →
// Webhook, and as WHATSAPP_VERIFY_TOKEN in Railway env vars.
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  console.warn('❌ WhatsApp webhook verification failed — token mismatch');
  return res.sendStatus(403);
});

// ── Actual delivery/status events ───────────────────────
router.post('/', (req, res) => {
  try {
    const entry   = req.body?.entry?.[0];
    const change  = entry?.changes?.[0]?.value;
    const statuses = change?.statuses || [];

    for (const s of statuses) {
      // status: "sent" | "delivered" | "read" | "failed"
      if (s.status === 'failed') {
        const err = s.errors?.[0];
        console.error(
          `❌ WA DELIVERY FAILED to +${s.recipient_id} | msg=${s.id} | ` +
          `code=${err?.code} | title=${err?.title} | detail=${err?.error_data?.details || err?.message}`
        );
      } else {
        console.log(`📬 WA status: ${s.status} | +${s.recipient_id} | msg=${s.id}`);
      }
    }

    // Inbound messages from customers land here too (change.messages) —
    // not handled yet, just acknowledged so Meta doesn't retry.
  } catch (e) {
    console.error('WhatsApp webhook processing error:', e.message);
  }

  // Meta requires a fast 200 regardless of what we did with the payload,
  // or it will retry (and eventually disable) the webhook.
  res.sendStatus(200);
});

module.exports = router;
