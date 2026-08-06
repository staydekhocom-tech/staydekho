const axios = require('axios');

async function sendSMS(phone, message) {
  const authKey    = process.env.MSG91_AUTH_KEY;
  const senderId   = process.env.MSG91_SENDER_ID || 'STDKHO';

  if (!authKey) {
    console.log(`\n📱 SMS to +91-${phone}: ${message}\n`);
    return;
  }

  await axios.post(
    'https://api.msg91.com/api/v5/flow/',
    {
      template_id: process.env.MSG91_FLOW_TEMPLATE_ID || process.env.MSG91_TEMPLATE_ID,
      short_url:   '0',
      mobiles:     `91${phone}`,
      message,
    },
    { headers: { authkey: authKey, 'Content-Type': 'application/json' } }
  );
}

async function sendOtpSMS(phone, otp) {
  const authKey    = process.env.MSG91_AUTH_KEY;

  if (!authKey) {
    console.log(`\n📱 OTP for +91-${phone}: ${otp} (valid 10 min)\n`);
    return;
  }

  const body = { mobile: `91${phone}`, otp };
  if (process.env.MSG91_TEMPLATE_ID) body.template_id = process.env.MSG91_TEMPLATE_ID;

  try {
    const r = await axios.post(
      'https://api.msg91.com/api/v5/otp',
      body,
      { headers: { authkey: authKey, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ OTP SMS sent to +91-${phone}:`, r.data);
  } catch (err) {
    console.error(`❌ OTP SMS failed +91-${phone}:`, err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendSMS, sendOtpSMS };
