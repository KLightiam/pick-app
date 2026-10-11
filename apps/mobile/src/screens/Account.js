import { useState } from 'react';
import { ScrollView } from 'react-native';
import { api } from '../api-instance.js';
import { Body, Button, Card, ErrorText, Title } from '../ui.js';

/** The signed-in person's account: sign out, or delete the account for good. */
export default function Account({ user, onSignOut, onDeleted, onBack }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Title>Your account</Title>
      <Card>
        <Body style={{ fontWeight: '600' }}>{user.name ?? 'No name'}</Body>
        <Body muted>{user.phone}</Body>
        <Body muted>{user.role === 'driver' ? 'Driver' : 'Rider'}</Body>
      </Card>
      <Button title="Back" onPress={onBack} />
      <Button title="Sign out" variant="secondary" onPress={onSignOut} />

      {!confirming
        ? <Button title="Delete account" variant="secondary" onPress={() => setConfirming(true)} />
        : (
          <Card>
            <Body style={{ fontWeight: '600' }}>Delete your account?</Body>
            <Body>
              {user.role === 'driver'
                ? 'Your name, number, car, documents and payout details are removed, and you can no longer drive with this account. '
                : 'Your name and number are removed. '}
              Pick keeps a record of past trips and payments, without your details. This can't be undone.
            </Body>
            <Button title="Yes, delete my account" variant="danger" onPress={remove} busy={busy} />
            <Button title="Keep my account" variant="secondary" onPress={() => setConfirming(false)} />
          </Card>
        )}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
