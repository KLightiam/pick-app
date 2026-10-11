import { useEffect, useMemo, useRef } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../ui.js';
import { mapHtml } from './mapHtml.js';

/**
 * The live map: a small Leaflet page, sent each new scene (see scene.js).
 * On phones the page runs in a WebView; in the browser, in an iframe.
 */
export default function LiveMap({ scene, height = 240 }) {
  const html = useMemo(() => mapHtml(), []);
  const Frame = Platform.OS === 'web' ? BrowserFrame : PhoneFrame;
  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <Frame html={html} scene={scene} />
    </View>
  );
}

function PhoneFrame({ html, scene }) {
  const ref = useRef(null);
  const ready = useRef(false);
  const send = () => ref.current?.injectJavaScript(`window.pickUpdate && window.pickUpdate(${JSON.stringify(scene)}); true;`);
  useEffect(() => { if (ready.current) send(); });
  return (
    <WebView
      ref={ref}
      source={{ html }}
      originWhitelist={['*']}
      onLoadEnd={() => { ready.current = true; send(); }}
      scrollEnabled={false}
      setSupportMultipleWindows={false}
    />
  );
}

// The page is our own, so it isn't sandboxed: it shares the app's origin, and tile servers see where requests come from.
function BrowserFrame({ html, scene }) {
  const ref = useRef(null);
  const ready = useRef(false);
  const send = () => ref.current?.contentWindow?.postMessage({ pickScene: scene }, '*');
  useEffect(() => { if (ready.current) send(); });
  return (
    <iframe
      ref={ref}
      title="Map"
      srcDoc={html}
      onLoad={() => { ready.current = true; send(); }}
      style={{ border: 0, width: '100%', height: '100%' }}
    />
  );
}
