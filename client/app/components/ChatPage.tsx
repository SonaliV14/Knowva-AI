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

  // Auto-dismiss error after 4 seconds
  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 4000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  const addDoc = async (files: File[]) => {
    // Check max 5 files
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
        // Remove the docs we just added since upload failed
        setDocs((prev) =>
          prev.filter((d) => !newDocs.find((n) => n.id === d.id))
        );
        return;
      }
    } catch {
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
    const arr = Array.from(files);
    addDoc(arr);
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

    // Check if any files have been uploaded
    if (docs.length === 0) {
      setErrorMsg('No files uploaded. Please upload a PDF first!');
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: 'user', content: text },
    ]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(
        `http://localhost:8000/chat?message=${encodeURIComponent(text)}`
      );
      const data = await res.json();

      const sources: string[] = (data.docs || [])
        .map((d: { metadata?: { source?: string } }) =>
          d.metadata?.source?.split('/').pop()
        )
        .filter(Boolean)
        .slice(0, 3);

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'ai',
          content: cleanResponse(
            data.message || 'I could not find an answer. Please try again.'
          ),
          sources,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'ai',
          content:
            "I'm having trouble connecting to the server. Make sure it's running on port 8000 and try again.",
          sources: [],
        },
      ]);
    } finally {
      setIsLoading(false);
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
            <div className={styles.dropHint}>Max 5 PDFs at a time</div>
            <div className={styles.pills}>
              {['PDF', 'TXT', 'DOCX', 'MD'].map((t) => (
                <span key={t} className={styles.pill}>{t}</span>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.docx,.md"
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
                <div className={styles.docIcon}>📄</div>
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
          {messages.length === 0 && !isLoading ? (
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
                          <div
                            className={`${styles.bubble} ${styles.bubbleAI}`}
                            dangerouslySetInnerHTML={{ __html: msg.content }}
                          />
                          {msg.sources && msg.sources.length > 0 && (
                            <div className={styles.sources}>
                              {msg.sources.map((s, i) => (
                                <span key={i} className={styles.sourcePill}>
                                  📄 {s}
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

              {isLoading && (
                <div className={styles.typingWrap}>
                  <div className={`${styles.avatar} ${styles.avatarAI}`}>K</div>
                  <div className={styles.typingBubble}>
                    <span className={styles.tDot} />
                    <span className={styles.tDot} />
                    <span className={styles.tDot} />
                  </div>
                </div>
              )}
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