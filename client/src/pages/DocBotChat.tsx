import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon } from '../components/ui';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  meta?: any;
}

interface ChatResponse {
  reply: string;
  suggestedSpecialty: string | null;
  emergency: boolean;
  quickReplies: string[];
  actionButtons: { label: string; action: string; payload?: string }[];
}

export default function DocBotChat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState<{ reply: string } | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ messages: Msg[] }>('/api/chat')
      .then((r) => setMessages(r.messages))
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || busy) return;
      setBusy(true);
      setInput('');
      setEmergency(null);
      setMessages((m) => [...m, { role: 'user', content: msg }]);
      try {
        const res: ChatResponse = await api<ChatResponse>('/api/chat', { method: 'POST', body: { message: msg } });
        setMessages((m) => [...m, { role: 'assistant', content: res.reply, meta: { buttons: res.actionButtons } }]);
        setQuickReplies(res.quickReplies ?? []);
        if (res.emergency) setEmergency({ reply: res.reply });
      } catch (err: any) {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: 'Sorry — I could not process that. ' + (err.message ?? '') },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  function handleButton(b: { label: string; action: string; payload?: string }) {
    if (b.action === 'call_emergency') {
      api<{ number: string }>('/api/emergency/number')
        .then((r) => {
          window.location.href = `tel:${r.number}`;
        })
        .catch(() => alert('Could not fetch the emergency number.'));
      api('/api/emergency', { method: 'POST', body: { kind: 'CALL_LOG' } }).catch(() => {});
    } else if (b.action === 'emergency_help') {
      navigate('/patient/emergency');
    } else if (b.action === 'show_specialty') {
      navigate(`/patient/find?specialty=${encodeURIComponent(b.payload ?? '')}`);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-11rem)] max-w-3xl flex-col">
      <div className="card flex items-center gap-3 p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Icon name="chat" className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-bold text-slate-900">DocBot — medical guidance assistant</h1>
          <p className="text-xs text-emerald-600">Online · guidance only, never a diagnosis</p>
        </div>
      </div>

      {emergency && (
        <div className="mt-3 rounded-2xl border-2 border-red-600 bg-red-50 p-4">
          <span className="badge-emergency">EMERGENCY</span>
          <p className="mt-2 text-sm font-medium text-red-800">{emergency.reply}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-danger !py-2 !text-sm"
              onClick={() =>
                api<{ number: string }>('/api/emergency/number')
                  .then((r) => {
                    window.location.href = `tel:${r.number}`;
                  })
                  .catch(() => {})
              }
            >
              <Icon name="phone" className="h-4 w-4" /> Call Emergency Services
            </button>
            <button className="btn-outline !py-2 !text-sm" onClick={() => navigate('/patient/emergency')}>
              <Icon name="alert" className="h-4 w-4" /> Emergency Help
            </button>
          </div>
        </div>
      )}

      <div className="card mt-3 flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="mr-10 rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-3 text-sm text-white">
              Hello, I am DocBot. Describe your symptoms (for example, "sore throat and ear pain") and I will suggest
              the right medical specialty and show you doctors. I provide general guidance only — not a diagnosis.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i}>
              <div
                className={`${
                  m.role === 'user' ? 'ml-10 rounded-tl-sm bg-slate-100' : 'mr-10 rounded-tr-sm bg-brand-600 text-white'
                } rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap`}
              >
                {m.content}
              </div>
              {Array.isArray(m.meta?.buttons) && m.meta.buttons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.meta.buttons.map((b: any, j: number) => (
                    <button key={j} className="btn-outline !py-1.5 !text-xs" onClick={() => handleButton(b)}>
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="mr-10 inline-block rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-3 text-sm text-white">
              <span className="inline-flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:120ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:240ms]" />
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 pt-3">
            {quickReplies.map((q) => (
              <button
                key={q}
                className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700"
                onClick={() => send(q)}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          className="flex gap-2 border-t border-slate-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            className="input flex-1"
            placeholder="Describe your symptoms…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button className="btn-primary" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">
        DocBot provides general guidance and is not a medical diagnosis. It cannot prescribe medication or handle
        emergencies — call emergency services instead.
      </p>
    </div>
  );
}
