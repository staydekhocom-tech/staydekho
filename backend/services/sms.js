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
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authKey || !templateId) {
    console.log(`\n📱 OTP for +91-${phone}: ${otp} (valid 10 min)\n`);
    return;
  }

  await axios.post(
    'https://api.msg91.com/api/v5/otp',
    { template_id: templateId, mobile: `91${phone}`, otp },
    { headers: { authkey: authKey, 'Content-Type': 'application/json' } }
  );
}

module.exports = { sendSMS, sendOtpSMS };
