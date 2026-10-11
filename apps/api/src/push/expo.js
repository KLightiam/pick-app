// Sends push notifications through Expo's push service, which passes them on to Apple and Google.
// https://docs.expo.dev/push-notifications/sending-notifications/

export const isExpoPushToken = (token) => typeof token === 'string' && token.length <= 200
  && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

/**
 * send(messages) -> [{ token, ok, unregistered }], one per message.
 * `unregistered` means the app was uninstalled or the token is no longer valid, so it should be forgotten.
 */
export function expoPushSender({ accessToken, url = 'https://exp.host/--/api/v2/push/send', fetchFn = fetch } = {}) {
  return {
    async send(messages) {
      if (messages.length === 0) return [];
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        },
        body: JSON.stringify(messages),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Expo push responded ${res.status}: ${body.errors?.[0]?.message ?? ''}`);
      return messages.map((m, i) => {
        const ticket = body.data?.[i] ?? {};
        return { token: m.to, ok: ticket.status === 'ok', unregistered: ticket.details?.error === 'DeviceNotRegistered' };
      });
    },
  };
}
