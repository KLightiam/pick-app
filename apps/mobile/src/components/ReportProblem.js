import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MAX_REPORT_DETAILS, REPORT_CATEGORIES } from '@pick/shared';
import { api } from '../api-instance.js';
import { Body, Button, Card, ErrorText, Field, colors } from '../ui.js';

/** "Report a problem" with a trip: pick what happened, add details, and Pick's team follows it up. */
export default function ReportProblem({ tripId }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.reportProblem(tripId, category, details.trim() || undefined);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) return <Body muted>Thanks for telling us. Pick's team will look into it and get in touch if needed.</Body>;
  if (!open) return <Button title="Report a problem" variant="secondary" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <Body style={{ fontWeight: '600' }}>What happened?</Body>
      <View style={{ gap: 6 }}>
        {REPORT_CATEGORIES.map((c) => (
          <Pressable
            key={c.code}
            accessibilityRole="radio"
            accessibilityState={{ checked: c.code === category }}
            onPress={() => setCategory(c.code)}
            style={{
              borderWidth: c.code === category ? 2 : 1,
              borderColor: c.code === category ? colors.brand : colors.border,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <Text style={{ fontSize: 15, color: colors.text }}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      {category === 'safety' && (
        <Body>If you are in danger now, call 112 first.</Body>
      )}
      <Field
        placeholder="Tell us more (optional)"
        value={details}
        onChangeText={setDetails}
        maxLength={MAX_REPORT_DETAILS}
        multiline
      />
      <Button title="Send report" onPress={send} busy={busy} disabled={!category} />
      <Button title="Never mind" variant="secondary" onPress={() => setOpen(false)} />
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
