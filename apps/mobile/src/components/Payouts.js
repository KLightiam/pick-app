import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { api } from '../api-instance.js';
import { formatMoney } from '../format.js';
import { Body, Button, Card, Choice, ErrorText, Field } from '../ui.js';

const STATUS = { pending: 'On its way', paid: 'Sent', failed: "Didn't go through" };

/**
 * Where Pick sends the driver's earnings. Ghana: their mobile money number.
 * Germany: Stripe's sign-up page, where they give their identity and bank details.
 */
export default function Payouts() {
  const [info, setInfo] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => api.payouts().then(setInfo).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!info) return error ? <ErrorText>{error}</ErrorText> : null;

  const { account, schedule, payouts } = info;
  const money = (minor) => formatMoney(minor, schedule.currency);
  const when = `Pick sends what it owes you every ${schedule.everyDays === 7 ? 'week' : `${schedule.everyDays} days`} once it's at least ${money(schedule.minimum)}.`;

  return (
    <Card>
      <Body style={{ fontWeight: '600' }}>Payouts</Body>
      {schedule.method === 'mobile_money'
        ? (editing || !account
          ? <MobileMoneyForm networks={info.networks} onSaved={() => { setEditing(false); load(); }} onCancel={account && (() => setEditing(false))} />
          : (
            <>
              <Body>{account.networkLabel} · {account.accountNumber}</Body>
              <Body muted>{account.accountName}</Body>
              <Button title="Change" variant="secondary" onPress={() => setEditing(true)} />
            </>
          ))
        : <StripeSignUp account={account} onCheck={load} />}
      <Body muted>{when}</Body>
      {payouts.slice(0, 5).map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Body muted>{new Date(p.createdAt).toLocaleDateString()} · {STATUS[p.status]}</Body>
          <Body muted>{money(p.amount)}</Body>
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function MobileMoneyForm({ networks, onSaved, onCancel }) {
  const [network, setNetwork] = useState(networks[0]?.code);
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setupPayouts({ network, number, name });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Body muted>Add the mobile money account Pick should pay.</Body>
      <Choice options={networks.map((n) => ({ value: n.code, label: n.label }))} value={network} onChange={setNetwork} />
      <Field label="Mobile money number" value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder="024 123 4567" />
      <Field label="Name on the account" value={name} onChangeText={setName} autoComplete="name" />
      <Button title="Save" onPress={save} busy={busy} disabled={!number || !name} />
      {onCancel && <Button title="Cancel" variant="secondary" onPress={onCancel} />}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

function StripeSignUp({ account, onCheck }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (account?.ready) return <Body>Paid to your bank through Stripe.</Body>;

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const { onboardingUrl } = await api.setupPayouts({});
      if (onboardingUrl) await Linking.openURL(onboardingUrl);
      else onCheck();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Body muted>Pick pays your bank through Stripe. Stripe asks for your ID and bank details on its own page.</Body>
      <Button title={account ? 'Finish setting up on Stripe' : 'Set up payouts'} onPress={open} busy={busy} />
      {account && <Button title="I've finished on Stripe" variant="secondary" onPress={onCheck} />}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
