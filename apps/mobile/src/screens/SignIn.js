import { useState } from 'react';
import { api } from '../api-instance.js';
import { saveToken } from '../session.js';
import { Body, Button, Choice, ErrorText, Field, Screen, Title } from '../ui.js';

const ROLES = [
  { value: 'rider', label: 'I need rides' },
  { value: 'driver', label: 'I drive' },
];

/** Phone number, then the texted code. New numbers also choose rider or driver and give a name. */
export default function SignIn({ onSignedIn }) {
  const [step, setStep] = useState('phone'); // phone | code | profile
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState('rider');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () => run(async () => {
    await api.requestCode(phone.trim());
    setStep('code');
  });

  const finish = async (body) => {
    const { token, user } = await api.verify(body);
    await saveToken(token);
    onSignedIn(user);
  };

  const verify = () => run(async () => {
    try {
      await finish({ phone: phone.trim(), code: code.trim() });
    } catch (err) {
      // The API asks new numbers to choose a role before it checks the code.
      if (err.status === 400 && /role/.test(err.message)) return setStep('profile');
      throw err;
    }
  });

  const createAccount = () => run(() => finish({
    phone: phone.trim(), code: code.trim(), role, name: name.trim() || undefined,
  }));

  return (
    <Screen>
      <Title>Pick</Title>
      {step === 'phone' && (
        <>
          <Body>Enter your mobile number. We'll text you a code.</Body>
          <Field
            label="Mobile number"
            placeholder="+233 24 123 4567 or +49 151 2345678"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
          />
          <Button title="Send code" onPress={sendCode} busy={busy} disabled={phone.trim().length < 8} />
        </>
      )}
      {step === 'code' && (
        <>
          <Body>Enter the 6-digit code we sent to {phone}.</Body>
          <Field
            label="Code"
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          <Button title="Continue" onPress={verify} busy={busy} disabled={code.trim().length !== 6} />
          <Button title="Use a different number" variant="secondary" onPress={() => { setCode(''); setStep('phone'); }} />
        </>
      )}
      {step === 'profile' && (
        <>
          <Body>Welcome to Pick. How will you use it?</Body>
          <Choice options={ROLES} value={role} onChange={setRole} />
          <Field label="Your name" placeholder="Ama Mensah" autoComplete="name" value={name} onChangeText={setName} />
          <Button title="Create account" onPress={createAccount} busy={busy} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
