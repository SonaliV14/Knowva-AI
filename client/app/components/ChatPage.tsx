'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { UserButton, useUser } from '@clerk/nextjs';
import styles from './ChatPage.module.css';

interface Doc {
  id: number;
  name: string;
  size: string;
  status: 'processing' | 'indexed';
}

interface Message {
  id: number;
  role: 'user' | 'ai';
  content: string;
  sources?: string[];
  streaming?: boolean;
}

export default function ChatPage() {
  const { user } = useUser();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 4000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  const addDoc = async (files: File[]) => {
    if (files.length > 5) {
      setErrorMsg('Maximum 5 files can be uploaded at a time.');
      return;
    }

    const newDocs: Doc[] = files.map((file) => ({
      id: Date.now() + Math.random(),
      name: file.name,
      size: formatSize(file.size),
      status: 'processing' as const,
    }));

    setDocs((prev) => [...prev, ...newDocs]);

    const form = new FormData();
    files.forEach((file) => form.append('pdf', file));

    try {
      const res = await fetch('http://localhost:8000/upload/pdf', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Upload failed.');
        setDocs((prev) =>
          prev.filter((d) => !newDocs.find((n) => n.id === d.id))
        );
        return;
      }
    } catch {
      // network error — still show as processing, worker may handle it
    }

    setTimeout(() => {
      setDocs((prev) =>
        prev.map((d) =>
          newDocs.find((n) => n.id === d.id) ? { ...d, status: 'indexed' } : d
        )
      );
    }, 2200);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    addDoc(Array.from(files));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeDoc = (id: number) =>
    setDocs((prev) => prev.filter((d) => d.id !== id));

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    if (docs.length === 0) {
      setErrorMsg('No files uploaded. Please upload a document first!');
      return;
    }

    const userMsgId = Date.now();
    const aiMsgId = userMsgId + 1;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text },
      { id: aiMsgId, role: 'ai', content: '', sources: [], streaming: true },
    ]);
    setInput('');
    setIsLoading(true);

    try {
      // Pass current indexed doc names so the server scopes the Qdrant search
      const indexedDocs = docs.filter((d) => d.status === 'indexed');
      const sources = indexedDocs.map((d) => d.name).join(',');
      const url = `http://localhost:8000/chat?message=${encodeURIComponent(text)}${sources ? `&sources=${encodeURIComponent(sources)}` : ''}`;

      const res = await fetch(url);
      if (!res.ok || !res.body) {
        throw new Error('Server error');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedText = '';
      let docSources: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));

            if (payload.type === 'docs') {
              docSources = (payload.docs || [])
                .map((d: { metadata?: { source?: string } }) =>
                  d.metadata?.source?.split('/').pop()
                )
                .filter(Boolean)
                .slice(0, 3);
            }

            if (payload.type === 'token') {
              streamedText += payload.token;
              const rendered = cleanResponse(streamedText);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: rendered, sources: docSources }
                    : m
                )
              );
            }

            if (payload.type === 'done') {
              const rendered = cleanResponse(payload.message || streamedText);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: rendered, sources: docSources, streaming: false }
                    : m
                )
              );
            }

            if (payload.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: payload.error || 'Something went wrong.', streaming: false }
                    : m
                )
              );
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.streaming
            ? {
                ...m,
                content:
                  "I'm having trouble connecting to the server. Make sure it's running on port 8000 and try again.",
                streaming: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const usePrompt = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const clearChat = () => setMessages([]);

  const userInitial =
    user?.firstName?.[0] ||
    user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ||
    'U';

  const indexedCount = docs.filter((d) => d.status === 'indexed').length;

  return (
    <div className={styles.root}>
      {/* ── SIDEBAR ── */}
      <aside className={styles.sidebar}>
        <div className={styles.sbHead}>
          <div className={styles.logo}>
            Knowva<span className={styles.accent}>.</span>AI
          </div>
          <div className={styles.logoSub}>// Document Intelligence</div>
        </div>

        {/* Upload zone */}
        <div className={styles.uploadWrap}>
          <div
            className={`${styles.drop} ${isDragging ? styles.dragging : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className={styles.dropIcon}>📎</div>
            <div className={styles.dropTitle}>Drop files or click to upload</div>
            <div className={styles.dropHint}>Max 5 files at a time</div>
            <div className={styles.pills}>
              {['PDF', 'TXT', 'DOCX', 'MD'].map((t) => (
                <span key={t} className={styles.pill}>{t}</span>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.docx,.md,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </div>

        {/* Doc list */}
        <div className={styles.docList}>
          <div className={styles.docLabel}>Uploaded Documents</div>
          {docs.length === 0 ? (
            <div className={styles.emptyDocs}>
              No documents yet.<br />Upload a file to get started.
            </div>
          ) : (
            docs.map((doc) => (
              <div key={doc.id} className={styles.docItem}>
                <div className={styles.docIcon}>{getFileIcon(doc.name)}</div>
                <div className={styles.docInfo}>
                  <div className={styles.docName} title={doc.name}>
                    {doc.name}
                  </div>
                  <div className={styles.docMeta}>
                    {doc.size} · {doc.status === 'processing' ? 'indexing…' : 'indexed'}
                  </div>
                  {doc.status === 'processing' && (
                    <div className={styles.progress}>
                      <div className={styles.progressFill} />
                    </div>
                  )}
                </div>
                <div
                  className={`${styles.statusDot} ${
                    doc.status === 'indexed' ? styles.statusOk : styles.statusProc
                  }`}
                />
                <button
                  className={styles.docRemove}
                  onClick={() => removeDoc(doc.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {/* User footer */}
        <div className={styles.sbFoot}>
          <UserButton afterSignOutUrl="/" />
          <div className={styles.userInfo}>
            <div className={styles.userName}>
              {user?.firstName ||
                user?.emailAddresses?.[0]?.emailAddress ||
                'User'}
            </div>
            <div className={styles.userPlan}>
              Free Plan · {docs.length} doc{docs.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </aside>

      {/* ── CHAT ── */}
      <main className={styles.chat}>
        {/* Header */}
        <div className={styles.chatHead}>
          <div>
            <div className={styles.chatTitle}>
              {messages.length === 0 ? 'New Conversation' : 'Active Session'}
            </div>
            <div className={styles.chatSub}>
              {docs.length > 0
                ? `${indexedCount} of ${docs.length} document${docs.length !== 1 ? 's' : ''} indexed`
                : 'Upload documents to begin'}
            </div>
          </div>
          <div className={styles.headActions}>
            <button className={styles.iconBtn} title="Clear chat" onClick={clearChat}>
              🗑
            </button>
            <button className={styles.iconBtn} title="New chat" onClick={clearChat}>
              ✏️
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className={styles.messages}>
          {messages.length === 0 ? (
            <div className={styles.welcome}>
              <div className={styles.welcomeIcon}>🧠</div>
              <h2 className={styles.welcomeTitle}>Ask Knowva anything</h2>
              <p className={styles.welcomeText}>
                Upload your documents in the sidebar, then ask questions in English. I&apos;ll search across everything and give you a clear,
                synthesized answer.
              </p>
              <div className={styles.suggestions}>
                {[
                  'What are the key points in my documents?',
                  'Summarize the main findings for me',
                  'What risks or concerns are mentioned?',
                  'Find any dates or deadlines mentioned',
                ].map((s) => (
                  <button
                    key={s}
                    className={styles.suggestion}
                    onClick={() => usePrompt(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className={styles.msgGroup}>
                  <div
                    className={`${styles.msg} ${
                      msg.role === 'user' ? styles.msgUser : ''
                    }`}
                  >
                    <div
                      className={`${styles.avatar} ${
                        msg.role === 'ai' ? styles.avatarAI : styles.avatarUser
                      }`}
                    >
                      {msg.role === 'ai' ? 'K' : userInitial}
                    </div>
                    <div
                      className={`${styles.msgBody} ${
                        msg.role === 'user' ? styles.msgBodyUser : ''
                      }`}
                    >
                      <div className={styles.sender}>
                        {msg.role === 'ai' ? 'Knowva' : 'You'}
                      </div>
                      {msg.role === 'ai' ? (
                        <>
                          {msg.content ? (
                            <div
                              className={`${styles.bubble} ${styles.bubbleAI}`}
                              dangerouslySetInnerHTML={{ __html: msg.content }}
                            />
                          ) : (
                            <div className={styles.typingBubble} style={{ display: 'inline-flex' }}>
                              <span className={styles.tDot} />
                              <span className={styles.tDot} />
                              <span className={styles.tDot} />
                            </div>
                          )}
                          {msg.sources && msg.sources.length > 0 && !msg.streaming && (
                            <div className={styles.sources}>
                              {msg.sources.map((s, i) => (
                                <span key={i} className={styles.sourcePill}>
                                  {getFileIcon(s)} {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                          {msg.content}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className={styles.inputArea}>
          <div className={styles.inputWrap}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder="Ask about your documents…"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className={styles.inputActions}>
              <button
                className={styles.attachBtn}
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
              <button
                className={styles.sendBtn}
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M14 2L2 7.5l5 1.5L8.5 14 14 2z" fill="white" />
                </svg>
              </button>
            </div>
          </div>
          <div className={styles.inputHint}>
            Enter to send · Shift+Enter for new line
          </div>
        </div>

        {/* Error Toast */}
        {errorMsg && (
          <div className={styles.errorToast}>
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)}>✕</button>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(filename: string): string {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return '📄';
  if (ext === 'docx' || ext === 'doc') return '📝';
  if (ext === 'md') return '📋';
  if (ext === 'txt') return '📃';
  return '📄';
}

function cleanResponse(text: string): string {
  const clean = text
    .replace(/\[Page \d+\]/gi, '')
    .replace(/\[p\.\s*\d+\]/gi, '')
    .replace(/\[Source:.*?\]/gi, '')
    .replace(/\(Source:.*?\)/gi, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  return clean
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .split('\n\n')
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}
