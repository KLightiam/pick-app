import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MAX_RATING_COMMENT } from '@pick/shared';
import { api } from '../api-instance.js';
import { Body, Button, Card, ErrorText, Field, colors } from '../ui.js';

/** Stars and an optional comment after a finished trip. `about` names who is being rated. */
export default function RateTrip({ tripId, about }) {
  const [rating, setRating] = useState(undefined); // undefined while loading, null if not rated yet
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api.myRating(tripId)
      .then(({ rating: mine }) => { if (live) setRating(mine); })
      .catch(() => { if (live) setRating(null); });
    return () => { live = false; };
  }, [tripId]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const { rating: saved } = await api.rateTrip(tripId, stars, comment.trim() || undefined);
      setRating(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (rating === undefined) return null;
  if (rating) {
    return <Body muted>You gave {about} {rating.stars} {rating.stars === 1 ? 'star' : 'stars'}. Thank you.</Body>;
  }
  return (
    <Card>
      <Body style={{ fontWeight: '600' }}>How was {about}?</Body>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}`}
            accessibilityState={{ selected: n <= stars }}
            onPress={() => setStars(n)}
            hitSlop={6}
          >
            <Text style={{ fontSize: 32, color: n <= stars ? '#E8A317' : colors.border }}>★</Text>
          </Pressable>
        ))}
      </View>
      {stars > 0 && (
        <>
          <Field
            placeholder="Anything to add? (optional)"
            value={comment}
            onChangeText={setComment}
            maxLength={MAX_RATING_COMMENT}
            multiline
          />
          <Button title="Send rating" onPress={send} busy={busy} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
