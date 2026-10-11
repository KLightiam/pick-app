import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from './config.js';

/** Opens the live connection used for offers, trip updates and driver locations. */
export function connectLive(token) {
  return io(API_URL, { auth: { token }, transports: ['websocket'] });
}

/** Runs handler(payload) whenever `event` arrives on the live connection. */
export function useLiveEvent(live, event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!live) return undefined;
    const listener = (payload) => ref.current(payload);
    live.on(event, listener);
    return () => live.off(event, listener);
  }, [live, event]);
}
