import { io } from 'socket.io-client';
import { getToken } from './api.js';

const BASE = import.meta.env.VITE_API_BASE || '';
let socket = null;

export function connectSocket() {
  // Return the SAME instance even while it's still connecting. Gating on
  // `socket.connected` let React StrictMode's double-invoked effect create a
  // second socket before the first finished connecting — both joined every room,
  // so messages arrived (and rendered) twice. One socket only.
  if (socket) return socket;
  socket = io(BASE || '/', {
    // `desktop` tells the server this client can receive remote control (Electron app)
    auth: { token: getToken(), desktop: !!window.desktop?.remote },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function getSocket() {
  return socket || connectSocket();
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
