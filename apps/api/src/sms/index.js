// Sends sign-in codes. "console" is for local development; "twilio" covers
// both Ghana and Germany with one account.
export function consoleSms() {
  return {
    async send(to, body) {
      console.log(`[sms] to ${to}: ${body}`);
    },
  };
}

export function twilioSms({ accountSid, authToken, from }) {
  if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  return {
    async send(to, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      });
      if (!res.ok) throw new Error(`Twilio send failed: ${res.status} ${await res.text()}`);
    },
  };
}

export function createSms(smsConfig) {
  if (smsConfig.provider === 'twilio') {
    return twilioSms({
      accountSid: smsConfig.twilioAccountSid,
      authToken: smsConfig.twilioAuthToken,
      from: smsConfig.twilioFrom,
    });
  }
  return consoleSms();
}
