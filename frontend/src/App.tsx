import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

const API = "http://localhost:8000";

type Role = "user" | "ai";
type Status = "checking" | "online" | "offline";
type Theme = "dark" | "light";

interface Message {
  id: number;
  role: Role;
  text: string;
}
interface BooksData {
  indexados: string[];
  pendentes: string[];
}
interface IndexingStatus {
  running: boolean;
  log: string[];
  error: string | null;
}

const SUGGESTIONS = [
  "Fale sobre o Projeto Terra",
  "Fale sobre os Arcanjos",
  "Fale sobre a Reencarnação",
  "Qual o propósito da alma?",
];

let msgId = 0;

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "dark",
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<Status>("checking");
  const [books, setBooks] = useState<BooksData>({
    indexados: [],
    pendentes: [],
  });
  const [showModal, setShowModal] = useState(false);
  const [indexing, setIndexing] = useState<IndexingStatus>({
    running: false,
    log: [],
    error: null,
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    checkHealth();
    fetchBooks();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [indexing.log]);

  useEffect(() => {
    if (indexing.running) {
      pollRef.current = setInterval(fetchIndexStatus, 1500);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
      if (indexing.log.length > 0) fetchBooks();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [indexing.running]);

  async function checkHealth() {
    try {
      const r = await fetch(`${API}/health`);
      setApiStatus(r.ok ? "online" : "offline");
    } catch {
      setApiStatus("offline");
    }
  }

  async function fetchBooks() {
    try {
      const r = await fetch(`${API}/livros`);
      const d = await r.json();
      setBooks({ indexados: d.indexados ?? [], pendentes: d.pendentes ?? [] });
    } catch {
      setBooks({ indexados: [], pendentes: [] });
    }
  }

  async function fetchIndexStatus() {
    try {
      const r = await fetch(`${API}/indexar/status`);
      const d: IndexingStatus = await r.json();
      setIndexing(d);
    } catch {
      /* ignore */
    }
  }

  async function startIndexing() {
    try {
      const r = await fetch(`${API}/indexar`, { method: "POST" });
      const d = await r.json();
      if (d.ok) setIndexing({ running: true, log: [d.mensagem], error: null });
      else setIndexing((p) => ({ ...p, error: d.mensagem }));
    } catch {
      setIndexing((p) => ({
        ...p,
        error: "Não foi possível conectar com a API.",
      }));
    }
  }

  async function resetarIndexacao() {
    if (
      !confirm(
        "Isso vai apagar todos os dados do banco vetorial e precisará re-indexar tudo. Continuar?",
      )
    )
      return;
    try {
      const r = await fetch(`${API}/indexar/resetar`, { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setIndexing({ running: false, log: [d.mensagem], error: null });
        await fetchBooks();
      } else {
        setIndexing((p) => ({ ...p, error: d.mensagem }));
      }
    } catch {
      setIndexing((p) => ({ ...p, error: "Erro ao resetar o banco." }));
    }
  }

  const sendMessage = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || loading) return;
      setMessages((prev) => [...prev, { id: ++msgId, role: "user", text: t }]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setLoading(true);
      try {
        const r = await fetch(`${API}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mensagem: t }),
        });
        const d = await r.json();
        setMessages((prev) => [
          ...prev,
          { id: ++msgId, role: "ai", text: d.resposta },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: ++msgId, role: "ai", text: "Erro ao conectar com a API." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  const statusLabel = {
    checking: "Verificando...",
    online: "API online",
    offline: "API offline",
  }[apiStatus];
  const totalBooks = books.indexados.length + books.pendentes.length;
  const hasPending = books.pendentes.length > 0;

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-orb" />
          <div>
            <div className="sidebar-title">IA Espiritualista</div>
            <div className="sidebar-subtitle">RAG de livros sagrados</div>
          </div>
        </div>

        <div className="sidebar-body">
          <div className="sidebar-label">Status</div>
          <div className="status-row">
            <div className={`status-dot ${apiStatus}`} />
            {statusLabel}
          </div>

          <div className="books-header">
            <span className="sidebar-label" style={{ padding: 0 }}>
              Livros
            </span>
            {totalBooks > 0 && (
              <span className="books-badge">
                {books.indexados.length}/{totalBooks}
              </span>
            )}
          </div>

          {books.indexados.length === 0 && books.pendentes.length === 0 ? (
            <span className="books-empty">Nenhum livro encontrado.</span>
          ) : (
            <>
              {books.indexados.map((b, i) => (
                <div key={i} className="book-row">
                  <span className="icon">📖</span>
                  <span>{b}</span>
                </div>
              ))}
              {books.pendentes.map((b, i) => (
                <div key={i} className="book-row pending">
                  <span className="icon">📄</span>
                  <span>{b}</span>
                  <span className="pending-tag">pendente</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="sidebar-footer">
          {(hasPending || books.indexados.length > 0) && (
            <button className="index-btn" onClick={() => setShowModal(true)}>
              {hasPending
                ? `Indexar ${books.pendentes.length} livro(s)`
                : "Gerenciar indexação"}
            </button>
          )}
          <button
            className="theme-btn"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? (
              <>
                <SunIcon /> Tema claro
              </>
            ) : (
              <>
                <MoonIcon /> Tema escuro
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        <div className="messages">
          {messages.length === 0 && !loading ? (
            <div className="welcome">
              <div className="welcome-orb" />
              <span className="welcome-eyebrow">Bem-vindo</span>
              <h2>Consulte os livros sagrados</h2>
              <p className="welcome-sub">
                {books.indexados.length === 0
                  ? "Nenhum livro indexado ainda. Use a sidebar para indexar os PDFs disponíveis."
                  : "Faça perguntas sobre os ensinamentos espirituais. As respostas vêm exclusivamente dos livros indexados."}
              </p>
              {books.indexados.length > 0 && (
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="chip"
                      onClick={() => sendMessage(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <div key={m.id} className={`msg-row ${m.role}`}>
                  <div className={`avatar ${m.role === "user" ? "u" : "a"}`}>
                    {m.role === "user" ? "👤" : "✦"}
                  </div>
                  <div className="bubble">{m.text}</div>
                </div>
              ))}
              {loading && (
                <div className="msg-row ai">
                  <div className="avatar a">✦</div>
                  <div className="bubble">
                    <div className="typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <div className="input-wrap">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKey}
              placeholder="Faça uma pergunta espiritual..."
              rows={1}
              disabled={loading}
            />
            <button
              className="send-btn"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              aria-label="Enviar"
            >
              <SendIcon />
            </button>
          </div>
          <p className="input-hint">
            Enter para enviar · Shift+Enter para nova linha
          </p>
        </div>
      </main>

      {/* ── Modal de indexação ── */}
      {showModal && (
        <div
          className="overlay"
          onClick={() => !indexing.running && setShowModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Indexação de livros</h2>
              {!indexing.running && (
                <button
                  className="modal-close"
                  onClick={() => setShowModal(false)}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="modal-list">
              {books.indexados.map((b, i) => (
                <div key={i} className="modal-item indexed">
                  <span className="dot">✓</span>
                  <span>{b}</span>
                </div>
              ))}
              {books.pendentes.map((b, i) => (
                <div key={i} className="modal-item pending">
                  <span className="dot">○</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>

            {indexing.log.length > 0 && (
              <div className="index-log">
                {indexing.log.map((l, i) => (
                  <div
                    key={i}
                    className={`log-line${l.startsWith("Erro") ? " err" : ""}`}
                  >
                    {l}
                  </div>
                ))}
                <div ref={logBottomRef} />
              </div>
            )}

            {indexing.error && (
              <div className="index-err">{indexing.error}</div>
            )}

            <div className="modal-foot">
              <button
                className="reset-btn"
                onClick={resetarIndexacao}
                disabled={indexing.running}
                title="Apaga o banco vetorial e re-indexa tudo do zero"
              >
                Limpar banco
              </button>
              {!hasPending && !indexing.running ? (
                <p className="all-good">Todos os livros indexados.</p>
              ) : (
                <button
                  className="start-btn"
                  onClick={startIndexing}
                  disabled={indexing.running || !hasPending}
                >
                  {indexing.running ? (
                    <>
                      <span className="spinner" />
                      Indexando...
                    </>
                  ) : (
                    `Indexar ${books.pendentes.length} livro(s)`
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
