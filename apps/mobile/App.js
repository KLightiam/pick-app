import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api } from './src/api-instance.js';
import { connectLive } from './src/live.js';
import { clearToken, loadToken } from './src/session.js';
import { registerForPush, unregisterPush } from './src/push.js';
import { Body, Button, Screen, colors, styles } from './src/ui.js';
import SignIn from './src/screens/SignIn.js';
import RiderHome from './src/screens/rider/RiderHome.js';
import DriverHome from './src/screens/driver/DriverHome.js';

// One app for riders and drivers: the account's role decides which screens it shows.
export default function App() {
  const [user, setUser] = useState(undefined); // undefined while loading, null when signed out
  const [live, setLive] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const loadUser = async () => {
    setLoadError(null);
    if (!(await loadToken())) return setUser(null);
    try {
      const { user: me } = await api.me();
      setUser(me);
    } catch (err) {
      if (err.status !== 401) return setLoadError(err.message);
      await clearToken();
      setUser(null);
    }
  };
  useEffect(() => { loadUser(); }, []);

  // The live connection lasts as long as the user is signed in.
  useEffect(() => {
    if (!user) return undefined;
    let socket;
    loadToken().then((token) => {
      socket = connectLive(token);
      setLive(socket);
    });
    return () => { socket?.disconnect(); setLive(null); };
  }, [user]);

  // Ride requests and trip updates reach the phone as push notifications when the app is closed.
  useEffect(() => { if (user) registerForPush(api); }, [user]);

  const signOut = async () => {
    await unregisterPush(api);
    await clearToken();
    setUser(null);
  };

  return (
    <SafeAreaProvider>
      <WebFrame>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <StatusBar style="dark" />
          {user === undefined && !loadError && <ActivityIndicator style={{ flex: 1 }} />}
          {user === undefined && loadError && (
            <Screen>
              <Body>{loadError}</Body>
              <Button title="Try again" onPress={loadUser} />
            </Screen>
          )}
          {user === null && <SignIn onSignedIn={setUser} />}
          {user && (
            <View style={{ flex: 1 }}>
              <View style={[styles.row, { paddingHorizontal: 20, paddingTop: 8 }]}>
                <Text style={[styles.body, { fontWeight: '700', color: colors.brand }]}>Pick</Text>
                <Pressable accessibilityRole="button" onPress={signOut}>
                  <Text style={styles.muted}>Sign out</Text>
                </Pressable>
              </View>
              {user.role === 'driver' ? <DriverHome live={live} /> : <RiderHome user={user} live={live} />}
            </View>
          )}
        </SafeAreaView>
      </WebFrame>
    </SafeAreaProvider>
  );
}

// In a wide browser window the app sits in a phone-width column instead of stretching across the screen.
function WebFrame({ children }) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web' || width < 600) return children;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', paddingVertical: 24 }}>
      <View
        style={{
          flex: 1, width: 440, maxWidth: '100%', borderRadius: 16, overflow: 'hidden',
          borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
        }}
      >
        {children}
      </View>
    </View>
  );
}
