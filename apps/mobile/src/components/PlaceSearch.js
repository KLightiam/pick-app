import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../api-instance.js';
import { getCurrentLocation } from '../location.js';
import { Body, ErrorText, Field, colors, styles } from '../ui.js';

/**
 * Type an address, pick a result. `value` is a place: { name, address, location: { lat, lng } }.
 * With `allowCurrentLocation`, the first suggestion is the phone's own position.
 */
export default function PlaceSearch({ label, placeholder, value, onChange, near, allowCurrentLocation }) {
  const [text, setText] = useState(value?.name ?? '');
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (value) setText(value.name); }, [value]);

  useEffect(() => {
    const q = text.trim();
    if (!focused || q.length < 2 || q === value?.name) {
      setResults([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const { places } = await api.searchPlaces(q, near);
        if (live) { setResults(places); setError(null); }
      } catch (err) {
        if (live) setError(err.message);
      }
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [text, focused, near, value]);

  const choose = (place) => {
    onChange(place);
    setResults([]);
    setFocused(false);
  };

  const useCurrentLocation = async () => {
    try {
      const location = await getCurrentLocation();
      choose({ name: 'Current location', address: null, location, current: true });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        placeholder={placeholder}
        value={text}
        onChangeText={(t) => { setText(t); if (value) onChange(null); }}
        onFocus={() => setFocused(true)}
        autoCorrect={false}
      />
      {focused && (
        <View style={{ borderWidth: results.length || allowCurrentLocation ? 1 : 0, borderColor: colors.border, borderRadius: 10 }}>
          {allowCurrentLocation && (
            <Suggestion title="Use my current location" onPress={useCurrentLocation} />
          )}
          {results.map((p, i) => (
            <Suggestion key={`${p.location.lat},${p.location.lng},${i}`} title={p.name} subtitle={p.address} onPress={() => choose(p)} />
          ))}
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

function Suggestion({ title, subtitle, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
      <Text style={styles.body}>{title}</Text>
      {subtitle ? <Body muted>{subtitle}</Body> : null}
    </Pressable>
  );
}
