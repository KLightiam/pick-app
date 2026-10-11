import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api-instance.js';
import { Body, Button, Card, ErrorText, colors, styles } from '../ui.js';

const STATUS = {
  pending: { text: 'Waiting to be checked', color: colors.muted },
  approved: { text: 'Approved', color: colors.brand },
  rejected: { text: 'Not accepted', color: colors.danger },
};

/** The documents the driver's country asks for: what's uploaded, what's approved, and an upload button for each. */
export default function Documents() {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => api.documents().then(({ documents }) => setItems(documents)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const upload = async (kind, source) => {
    setError(null);
    try {
      const options = { mediaTypes: ['images'], quality: 0.7 }; // quality below 1 also turns iPhone HEIC photos into JPEG
      if (source === 'camera') {
        const { granted } = await ImagePicker.requestCameraPermissionsAsync();
        if (!granted) throw new Error('Pick needs the camera to photograph your document.');
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      setBusy(kind);
      const blob = await (await fetch(asset.uri)).blob();
      await api.uploadDocument(kind, blob, asset.mimeType ?? blob.type ?? 'image/jpeg');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (!items) return error ? <ErrorText>{error}</ErrorText> : null;
  return (
    <View style={{ gap: 10 }}>
      <Body style={{ fontWeight: '600' }}>Your documents</Body>
      {items.map(({ kind, label, document }) => {
        const status = document && STATUS[document.status];
        return (
          <Card key={kind}>
            <View style={styles.row}>
              <Body style={{ flex: 1 }}>{label}</Body>
              <Body style={{ color: status?.color ?? colors.muted, fontSize: 14 }}>{status?.text ?? 'Not uploaded'}</Body>
            </View>
            {document?.status === 'rejected' && document.rejectReason && <Body muted>{document.rejectReason}</Body>}
            {document?.status !== 'approved' && document?.status !== 'pending' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                {Platform.OS !== 'web' && (
                  <View style={{ flex: 1 }}>
                    <Button title="Take photo" onPress={() => upload(kind, 'camera')} busy={busy === kind} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Button
                    title={Platform.OS === 'web' ? 'Upload photo' : 'Choose photo'}
                    variant={Platform.OS === 'web' ? 'primary' : 'secondary'}
                    onPress={() => upload(kind, 'library')}
                    busy={busy === kind && Platform.OS === 'web'}
                  />
                </View>
              </View>
            )}
          </Card>
        );
      })}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
