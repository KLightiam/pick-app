import { pushMessageFor } from './messages.js';

/**
 * Wraps the live-update notifier so that events people need to see also go to
 * their phones as push notifications. The live update goes out first, and
 * pushing never holds it up or breaks it.
 */
export function withPush(notifier, { tokens, sender }) {
  const push = async (userId, event, payload) => {
    const message = pushMessageFor(event, payload, userId);
    if (!message) return;
    const to = await tokens.listForUser(userId);
    if (to.length === 0) return;
    const { urgent, ...content } = message;
    const results = await sender.send(to.map((token) => ({
      to: token,
      ...content,
      sound: 'default',
      priority: 'high',
      channelId: urgent ? 'ride-requests' : 'trips',
      ...(urgent && { ttl: 60 }), // a ride request is worthless once the 60 seconds to accept are up
    })));
    await Promise.all(results.filter((r) => r.unregistered).map((r) => tokens.remove(r.token)));
  };

  return {
    ...notifier,
    toUser(userId, event, payload) {
      notifier.toUser(userId, event, payload);
      push(userId, event, payload).catch((err) => console.error('push', event, err.message));
    },
  };
}
