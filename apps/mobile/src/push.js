import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';

// Push notifications reach people when the Pick app is closed: ride requests for drivers, trip updates for riders.
// While the app is open the live connection already shows everything, so no banner is shown then.
// Expo push tokens need the app's EAS project id (`eas init` adds it to app.json); without one, pushes stay off.

// Expo Go can't receive pushes (on Android, even loading expo-notifications there throws), so the module is only
// loaded in real builds, the first time it's needed.
let Notifications;
function loadNotifications() {
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  if (!Notifications) {
    Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
      }),
    });
  }
  return Notifications;
}

let registered = null; // this phone's token, once given to the API

/** Asks for permission and gives this phone's push token to the API. Returns the token, or null when pushes are off. */
export async function registerForPush(api) {
  if (!Device.isDevice) return null;
  const Notifications = loadNotifications();
  if (!Notifications) return null; // the browser or Expo Go
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('No EAS project id in app.json: push notifications are off');
    return null;
  }
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('ride-requests', {
        name: 'Ride requests', importance: Notifications.AndroidImportance.MAX, sound: 'default', vibrationPattern: [0, 400, 200, 400],
      });
      await Notifications.setNotificationChannelAsync('trips', {
        name: 'Trip updates', importance: Notifications.AndroidImportance.HIGH, sound: 'default',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken(token, Platform.OS);
    registered = token;
    return token;
  } catch (err) {
    console.warn('push registration', err.message);
    return null;
  }
}

/** On sign-out: stop sending this account's notifications to this phone. */
export async function unregisterPush(api) {
  if (!registered) return;
  const token = registered;
  registered = null;
  await api.unregisterPushToken(token).catch(() => {});
}
