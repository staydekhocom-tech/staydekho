const axios = require('axios');

async function sendSMS(phone, message) {
  const authKey    = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authKey || !templateId || templateId.includes('your_dlt')) {
    console.log(`\n📱 SMS to +91-${phone}: ${message}\n`);
    return;
  }

  try {
    await axios.post(
      'https://api.msg91.com/api/v5/flow/',
      { template_id: templateId, short_url: '0', mobiles: `91${phone}` },
      { headers: { authkey: authKey, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('MSG91 SMS error:', err.response?.data || err.message);
    throw err;
  }
}

async function sendOtpSMS(phone, otp) {
  const authKey    = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID;

  if (!authKey || !templateId) {
    console.log(`\n📱 OTP for +91-${phone}: ${otp} (valid 10 min)\n`);
    return;
  }

  try {
    const r = await axios.post(
      'https://api.msg91.com/api/v5/otp',
      { template_id: templateId, mobile: `91${phone}`, otp },
      { headers: { authkey: authKey, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ OTP SMS sent to +91-${phone}:`, r.data);
  } catch (err) {
    console.error(`❌ OTP SMS failed +91-${phone}:`, err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendSMS, sendOtpSMS };
