/**
 * Socket.IO signaling for WebRTC video consultations.
 * Rooms are authenticated: a valid JWT plus membership of the appointment.
 * The doctor's client acts as the call initiator.
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from '../utils/auth.js';
import { getDb } from '../db/index.js';

interface SocketUser {
  userId: string;
  role: 'patient' | 'doctor' | 'admin';
  name: string;
}

export function attachSignaling(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string;
      const payload = token ? verifyToken(token) : null;
      if (!payload) return next(new Error('Unauthorized'));
      (socket.data as any).user = {
        userId: payload.sub,
        role: payload.role,
        name: payload.name,
      } satisfies SocketUser;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as SocketUser;

    socket.on(
      'join-room',
      async ({ roomId, token }: { roomId: string; token: string }, ack?: (r: unknown) => void) => {
        try {
          const payload = verifyToken(token);
          if (!payload) {
            ack?.({ ok: false, error: 'Invalid room token' });
            return;
          }
          const db = await getDb();
          const { rows } = await db.query(
            `SELECT a.id, a.patient_id, a.doctor_id FROM appointments a
             JOIN video_consultations v ON v.appointment_id = a.id
             WHERE v.room_id = $1`,
            [roomId]
          );
          const appt = rows[0];
          if (!appt || (appt.patient_id !== user.userId && appt.doctor_id !== user.userId)) {
            ack?.({ ok: false, error: 'Not a participant of this room' });
            return;
          }
          await socket.join(roomId);
          ack?.({ ok: true });
          socket.to(roomId).emit('peer-joined', { userId: user.userId, name: user.name, role: user.role });
        } catch {
          ack?.({ ok: false, error: 'Join failed' });
        }
      }
    );

    // WebRTC signaling relay
    socket.on('signal', ({ roomId, data }: { roomId: string; data: unknown }) => {
      socket.to(roomId).emit('signal', { from: user.userId, data });
    });

    socket.on('chat', ({ roomId, text }: { roomId: string; text: string }) => {
      if (typeof text === 'string' && text.length <= 1000) {
        socket.to(roomId).emit('chat', { from: user.name, text: text.slice(0, 1000), at: Date.now() });
      }
    });

    socket.on('leave-room', ({ roomId }: { roomId: string }) => {
      socket.leave(roomId);
      socket.to(roomId).emit('peer-left', { userId: user.userId });
    });

    socket.on('disconnecting', () => {
      for (const roomId of socket.rooms) {
        if (roomId !== socket.id) {
          socket.to(roomId).emit('peer-left', { userId: user.userId });
        }
      }
    });
  });

  return io;
}
