import { useState } from 'react';
import { Platform, Share } from 'react-native';
import { api } from '../api-instance.js';
import { Body, Button, ErrorText } from '../ui.js';

/** Sends a link that lets a friend or family member follow the ride until it ends. */
export default function ShareTrip({ tripId }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const share = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { url } = await api.shareTrip(tripId);
      const message = `Follow my Pick ride: ${url}`;
      if (Platform.OS !== 'web') {
        await Share.share({ message });
      } else if (navigator.share) {
        await navigator.share({ text: message }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(url);
        setNote('Link copied. Paste it to whoever you want to follow your ride.');
      }
    } catch (err) {
      setError(err.message ?? "Couldn't share the link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button title="Share trip" variant="secondary" onPress={share} busy={busy} />
      {note && <Body muted>{note}</Body>}
      <ErrorText>{error}</ErrorText>
    </>
  );
}
