import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api, getToken } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Icon, Spinner } from '../components/ui';

type Phase = 'loading' | 'waiting' | 'connecting' | 'connected' | 'ended' | 'error';

export default function VideoRoom() {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDoctor = user?.role === 'doctor';

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [info, setInfo] = useState<{ otherParty: string; start: string; date: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chat, setChat] = useState<{ from: string; text: string }[]>([]);

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const roomIdRef = useRef('');
  const roleRef = useRef(isDoctor);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const room = await api<any>(`/api/video/room/${appointmentId}`);
        if (disposed) return;
        roomIdRef.current = room.roomId;
        setInfo({ otherParty: room.otherParty, start: room.appointment.start, date: room.appointment.date });

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localRef.current) localRef.current.srcObject = stream;

        const socket = io('/', { auth: { token: getToken() ?? '' } });
        socketRef.current = socket;
        (window as any).__docbotGetToken = () => localStorage.getItem('docbot_token');

        socket.on('connect', () => {
          socket.emit('join-room', { roomId: room.roomId, token: room.token }, async (r: any) => {
            if (!r?.ok) {
              setError(r?.error ?? 'Join failed');
              setPhase('error');
              return;
            }
            setPhase('waiting');
          });
        });

        socket.on('peer-joined', async () => {
          if (!roleRef.current) return; // doctor initiates
          await createOffer();
        });

        socket.on('signal', async ({ data }: any) => {
          const pc = pcRef.current;
          if (!pc) return;
          if (data.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { roomId: roomIdRef.current, data: answer });
          } else if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
          } else if (data.type === 'candidate') {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch {
              /* ignore late candidates */
            }
          }
        });

        socket.on('peer-left', () => {
          setPhase('ended');
          cleanup();
        });

        socket.on('chat', (m: any) => setChat((c) => [...c, { from: m.from, text: m.text }]));

        async function setupPc(): Promise<RTCPeerConnection> {
          if (pcRef.current) return pcRef.current;
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
          });
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));
          pc.ontrack = (ev) => {
            if (remoteRef.current && ev.streams[0]) {
              remoteRef.current.srcObject = ev.streams[0];
              setPhase('connected');
            }
          };
          pc.onconnectionstatechange = () => {
            if (['failed', 'disconnected'].includes(pc.connectionState)) setPhase('ended');
            if (pc.connectionState === 'connected') setPhase('connected');
          };
          pcRef.current = pc;
          return pc;
        }

        async function createOffer() {
          const pc = await setupPc();
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('signal', { roomId: roomIdRef.current, data: offer });
        }
      } catch (err: any) {
        if (disposed) return;
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera/microphone permission denied. Allow access and reload to join the call.'
            : err.message ?? 'Could not open the consultation room.'
        );
        setPhase('error');
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  async function startCall() {
    try {
      await api(`/api/video/${appointmentId}/start`, { method: 'POST' });
      setCallStarted(true);
      setInfo((i) => (i ? { ...i } : i));
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function endCall() {
    try {
      await api(`/api/video/${appointmentId}/end`, { method: 'POST' });
    } catch {
      /* already ended */
    }
    setPhase('ended');
    cleanup();
  }

  function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatText.trim() || !socketRef.current) return;
    socketRef.current.emit('chat', { roomId: roomIdRef.current, text: chatText.trim() });
    setChat((c) => [...c, { from: 'You', text: chatText.trim() }]);
    setChatText('');
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  }

  function toggleCam() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCamOff(!track.enabled);
    }
  }

  if (phase === 'error') {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
          <Icon name="video" className="h-6 w-6" />
        </span>
        <h1 className="mt-3 text-lg font-bold text-slate-900">Cannot open the call</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <button className="btn-primary mt-5" onClick={() => navigate(-1)}>← Go back</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">
            Consultation {info ? `with ${info.otherParty}` : ''}
          </h1>
          <p className="text-sm text-slate-500">
            {info ? `${info.date} at ${info.start} · WebRTC peer-to-peer` : ''}
          </p>
        </div>
        {isDoctor ? (
          phase === 'connected' || callStarted ? (
            <button className="btn-danger" onClick={endCall}>End consultation</button>
          ) : (
            <button className="btn-success" onClick={startCall}>Start Call</button>
          )
        ) : (
          <span className="badge bg-slate-100 text-slate-500">The doctor will start the call</span>
        )}
      </div>

      <div className="card relative overflow-hidden bg-slate-900">
        <div className="grid aspect-video place-items-center">
          <video ref={remoteRef} autoPlay playsInline className="h-full w-full object-cover" />
          {phase !== 'connected' && (
            <div className="absolute inset-0 grid place-items-center bg-slate-900/80 text-center text-slate-300">
              {phase === 'loading' && <Spinner label="Preparing the room…" />}
              {phase === 'waiting' && (
                <div>
                  <Icon name="phone" className="mx-auto h-8 w-8" />
                  <p className="mt-2 text-sm">
                    {roleRef.current
                      ? 'Waiting for your patient to join… (they will connect automatically)'
                      : 'Waiting for the doctor to start the call…'}
                  </p>
                </div>
              )}
              {phase === 'ended' && (
                <div>
                  <Icon name="check" className="mx-auto h-8 w-8" />
                  <p className="mt-2 text-sm">Call ended.</p>
                  <button className="btn-primary mt-3" onClick={() => navigate(isDoctor ? '/doctor/video' : '/patient/video')}>
                    Back to consultations
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <video
          ref={localRef}
          autoPlay
          muted
          playsInline
          className="absolute bottom-3 right-3 h-28 w-40 rounded-xl border-2 border-white/30 object-cover shadow-lg"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button className={muted ? 'btn-danger' : 'btn-outline'} onClick={toggleMute}>
          {muted ? '🔇 Unmute' : '🎙 Mute'}
        </button>
        <button className={camOff ? 'btn-danger' : 'btn-outline'} onClick={toggleCam}>
          {camOff ? 'camera off — turn on' : '📷 Turn camera off'}
        </button>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-bold text-slate-700">In-call chat</h3>
        <div className="max-h-32 space-y-1 overflow-y-auto text-sm">
          {chat.map((m, i) => (
            <div key={i}><b>{m.from}:</b> {m.text}</div>
          ))}
          {chat.length === 0 && <p className="text-xs text-slate-400">Messages are visible only during the call.</p>}
        </div>
        <form className="mt-2 flex gap-2" onSubmit={sendChat}>
          <input className="input flex-1" placeholder="Type a message…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
          <button className="btn-outline">Send</button>
        </form>
      </div>
    </div>
  );
}
