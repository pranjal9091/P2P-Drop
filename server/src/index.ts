import { WebSocketServer, WebSocket } from 'ws';

interface Client {
  id: string;
  ws: WebSocket;
  roomId?: string;
}

interface Room {
  id: string;
  clients: Map<string, Client>;
  createdAt: number;
}

const PORT = Number(process.env.PORT) || 8080;
const wss = new WebSocketServer({ port: PORT });

const rooms = new Map<string, Room>();

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing 0/O, 1/I
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function generatePeerId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// Clean up stale rooms older than 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    // Remove dead client references
    for (const [id, c] of room.clients.entries()) {
      if (c.ws.readyState !== WebSocket.OPEN) {
        room.clients.delete(id);
      }
    }
    if (room.clients.size === 0 || now - room.createdAt > 2 * 60 * 60 * 1000) {
      rooms.delete(roomId);
    }
  }
}, 15 * 60 * 1000);

wss.on('connection', (ws: WebSocket) => {
  const peerId = generatePeerId();
  const client: Client = { id: peerId, ws };

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'CREATE_ROOM': {
          let roomId = generateRoomId();
          while (rooms.has(roomId)) {
            roomId = generateRoomId();
          }

          const room: Room = {
            id: roomId,
            clients: new Map([[peerId, client]]),
            createdAt: Date.now()
          };

          client.roomId = roomId;
          rooms.set(roomId, room);

          ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            roomId,
            peerId
          }));
          console.log(`[Signaling] Room created: ${roomId} by Peer ${peerId}`);
          break;
        }

        case 'JOIN_ROOM': {
          const targetRoomId = (data.roomId || '').trim().toUpperCase();
          const room = rooms.get(targetRoomId);

          if (!room) {
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: 'Room not found or expired'
            }));
            return;
          }

          // Prune dead/closed clients from room before size check
          for (const [id, c] of room.clients.entries()) {
            if (c.ws.readyState !== WebSocket.OPEN) {
              room.clients.delete(id);
            }
          }

          // If client is already in the room, respond OK
          if (room.clients.has(peerId)) {
            ws.send(JSON.stringify({
              type: 'ROOM_JOINED',
              roomId: targetRoomId,
              peerId
            }));
            return;
          }

          if (room.clients.size >= 2) {
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: 'Room is full (max 2 peers allowed per transfer)'
            }));
            return;
          }

          client.roomId = targetRoomId;
          room.clients.set(peerId, client);

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            roomId: targetRoomId,
            peerId
          }));

          // Notify existing peer that someone joined
          for (const [otherId, otherClient] of room.clients.entries()) {
            if (otherId !== peerId && otherClient.ws.readyState === WebSocket.OPEN) {
              otherClient.ws.send(JSON.stringify({
                type: 'PEER_JOINED',
                peerId
              }));
            }
          }

          console.log(`[Signaling] Peer ${peerId} joined Room ${targetRoomId}`);
          break;
        }

        case 'OFFER': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (room) {
            for (const [otherId, otherClient] of room.clients.entries()) {
              if (otherId !== peerId && otherClient.ws.readyState === WebSocket.OPEN) {
                otherClient.ws.send(JSON.stringify({
                  type: 'OFFER',
                  offer: data.offer,
                  senderId: peerId
                }));
              }
            }
          }
          break;
        }

        case 'ANSWER': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (room) {
            for (const [otherId, otherClient] of room.clients.entries()) {
              if (otherId !== peerId && otherClient.ws.readyState === WebSocket.OPEN) {
                otherClient.ws.send(JSON.stringify({
                  type: 'ANSWER',
                  answer: data.answer,
                  senderId: peerId
                }));
              }
            }
          }
          break;
        }

        case 'ICE_CANDIDATE': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (room) {
            for (const [otherId, otherClient] of room.clients.entries()) {
              if (otherId !== peerId && otherClient.ws.readyState === WebSocket.OPEN) {
                otherClient.ws.send(JSON.stringify({
                  type: 'ICE_CANDIDATE',
                  candidate: data.candidate,
                  senderId: peerId
                }));
              }
            }
          }
          break;
        }

        case 'PING': {
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        }

        default:
          console.warn(`[Signaling] Unknown message type: ${data.type}`);
      }
    } catch (err) {
      console.error('[Signaling] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    if (client.roomId) {
      const room = rooms.get(client.roomId);
      if (room) {
        room.clients.delete(peerId);
        // Notify other client
        for (const [, otherClient] of room.clients.entries()) {
          if (otherClient.ws.readyState === WebSocket.OPEN) {
            otherClient.ws.send(JSON.stringify({
              type: 'PEER_DISCONNECTED',
              peerId
            }));
          }
        }
        if (room.clients.size === 0) {
          rooms.delete(client.roomId);
        }
      }
    }
    console.log(`[Signaling] Client disconnected: ${peerId}`);
  });
});

console.log(`🚀 P2P Drop Signaling Server running on ws://localhost:${PORT}`);
