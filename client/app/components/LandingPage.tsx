'use client';

import { useState, useEffect } from 'react';
import { SignInButton, SignUpButton, SignedIn, SignedOut } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import styles from './LandingPage.module.css';

export default function LandingPage() {
  const router = useRouter();
  const [activeModal, setActiveModal] = useState<'signin' | 'signup' | null>(null);
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');

  // Close modal on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveModal(null);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  // Scroll reveal
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add(styles.visible);
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll(`.${styles.reveal}`).forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const openModal = (tab: 'signin' | 'signup') => {
    setActiveModal(tab);
    setActiveTab(tab);
  };

  const features = [
    { icon: '📄', title: 'Multi-Document Search', desc: 'Upload dozens of PDFs and text files. Knowva searches across all of them simultaneously.' },
    { icon: '💬', title: 'Natural Conversation', desc: 'Ask follow-up questions, rephrase, dig deeper. Knowva remembers context throughout your session.' },
    { icon: '🔍', title: 'Source Citations', desc: 'Every answer links back to the document it came from. Verify anything in one click.' },
    { icon: '⚡', title: 'Instant Processing', desc: 'Documents are indexed in seconds using vector embeddings. Ask your first question right away.' },
    { icon: '🧠', title: 'Synthesized Answers', desc: 'Not just search results — Knowva combines info from multiple sources into one clear answer.' },
    { icon: '🔒', title: 'Private by Default', desc: 'Your documents stay yours. Isolated per user, encrypted at rest. Never used for training.' },
  ];

  const steps = [
    { n: '1', title: 'Upload Your Documents', desc: 'Drag and drop PDFs or text files. We handle chunking, embedding, and indexing automatically.' },
    { n: '2', title: 'Ask your question in English', desc: 'Type your question naturally. No keywords or special syntax — just ask like you would a colleague.' },
    { n: '3', title: 'Get a Clear Answer', desc: 'Receive a synthesized, human-language answer with source references — not a wall of results.' },
  ];

  return (
    <div className={styles.root}>
      {/* noise overlay */}
      <div className={styles.noise} aria-hidden />

      {/* ── NAV ── */}
      <nav className={styles.nav}>
        <div className={styles.logo}>
          Knowva<span className={styles.accent}>.</span>AI
        </div>
        <div className={styles.navActions}>
          <SignedOut>
            <button className={styles.btnGhost} onClick={() => openModal('signin')}>
              Sign In
            </button>
            <button className={styles.btnPrimary} onClick={() => openModal('signup')}>
              Get Started →
            </button>
          </SignedOut>
          <SignedIn>
            <button className={styles.btnPrimary} onClick={() => router.push('/chat')}>
              Go to Chat →
            </button>
          </SignedIn>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className={styles.hero}>
        <div className={`${styles.orb} ${styles.orb1}`} aria-hidden />
        <div className={`${styles.orb} ${styles.orb2}`} aria-hidden />

        <div className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden />
          RAG-Powered Intelligence
        </div>

        <h1 className={styles.h1}>
          Ask Anything.<br />
          <span className={styles.h1Outline}>Across</span> Every Document.
        </h1>

        <p className={styles.sub}>
          Upload your PDFs and text files. Ask in plain English. Get clear,
          synthesized answers drawn from everything you've shared.
        </p>

        <div className={styles.cta}>
          <button className={styles.btnHero} onClick={() => openModal('signup')}>
            Start for Free →
          </button>
          <button
            className={styles.btnDemo}
            onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
          >
            See How It Works
          </button>
        </div>

        {/* Stats */}
        <div className={styles.stats}>
          {[
            { num: '50+', label: 'Document Formats' },
            { num: '<2s', label: 'Average Response' },
            { num: 'GPT‑4o', label: 'Powered Core' },
          ].map((s) => (
            <div key={s.label} className={styles.stat}>
              <div className={styles.statNum}>{s.num}</div>
              <div className={styles.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Chat preview card */}
        <div className={styles.preview}>
          <div className={styles.previewBar}>
            <span className={styles.dotR} />
            <span className={styles.dotY} />
            <span className={styles.dotG} />
          </div>
          <div className={styles.previewMsgs}>
            <div className={`${styles.previewMsg} ${styles.previewMsgUser}`}>
              <div className={`${styles.previewAvatar} ${styles.avatarUser}`}>You</div>
              <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                What are the main risks in the Q3 financial report?
              </div>
            </div>
            <div className={styles.previewMsg}>
              <div className={`${styles.previewAvatar} ${styles.avatarAI}`}>K</div>
              <div className={`${styles.bubble} ${styles.bubbleAI}`}>
                Based on the Q3 report, there are three main risks: rising supply chain costs (up 18%),
                slower growth in Europe, and data privacy regulatory uncertainty heading into Q4.
              </div>
            </div>
            <div className={styles.previewMsg}>
              <div className={`${styles.previewAvatar} ${styles.avatarUser}`}>You</div>
              <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                Which section covers the supply chain issue?
              </div>
            </div>
            <div className={styles.previewMsg}>
              <div className={`${styles.previewAvatar} ${styles.avatarAI}`}>K</div>
              <div className={`${styles.bubble} ${styles.bubbleAI}`}>
                <div className={styles.typing}>
                  <span className={styles.tDot} />
                  <span className={styles.tDot} />
                  <span className={styles.tDot} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className={`${styles.section} ${styles.reveal}`}>
        <div className={styles.sectionLabel}>Capabilities</div>
        <h2 className={styles.sectionTitle}>
          Everything you need to know — right when you need it.
        </h2>
        <div className={styles.featuresGrid}>
          {features.map((f) => (
            <div key={f.title} className={styles.card}>
              <div className={styles.cardIcon}>{f.icon}</div>
              <div className={styles.cardTitle}>{f.title}</div>
              <div className={styles.cardDesc}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <div className={styles.how} id="how">
        <div className={`${styles.howInner} ${styles.reveal}`}>
          <div className={styles.sectionLabel}>How It Works</div>
          <h2 className={styles.sectionTitle}>Three steps from document to insight.</h2>
          <div className={styles.steps}>
            {steps.map((s) => (
              <div key={s.n} className={styles.step}>
                <div className={styles.stepNum}>{s.n}</div>
                <div className={styles.stepTitle}>{s.title}</div>
                <div className={styles.stepDesc}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer className={styles.footer}>
        <div className={styles.logo}>
          Knowva<span className={styles.accent}>.</span>AI
        </div>
        <div>© 2025 Knowva.AI — Intelligence across your documents.</div>
        <div>Built with LangChain, Qdrant &amp; GPT‑4o</div>
      </footer>

      {/* ── AUTH MODAL ── */}
      {activeModal && (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveModal(null);
          }}
        >
          <div className={styles.modal}>
            <button className={styles.modalClose} onClick={() => setActiveModal(null)}>
              ✕
            </button>
            <div className={styles.modalLogo}>
              Knowva<span className={styles.accent}>.</span>AI
            </div>
            <div className={styles.modalTag}>Intelligence across your documents</div>

            {/* Tabs */}
            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${activeTab === 'signin' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('signin')}
              >
                Sign In
              </button>
              <button
                className={`${styles.tab} ${activeTab === 'signup' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('signup')}
              >
                Sign Up
              </button>
            </div>

            {activeTab === 'signin' ? (
              <SignInForm onSwitch={() => setActiveTab('signup')} />
            ) : (
              <SignUpForm onSwitch={() => setActiveTab('signin')} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  return (
    <>
      <div className={styles.formGroup}>
        <label className={styles.label}>Email address</label>
        <input className={styles.input} type="email" placeholder="you@example.com" />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label}>Password</label>
        <input className={styles.input} type="password" placeholder="••••••••" />
      </div>
      <SignInButton mode="modal">
        <button className={styles.submit}>Sign In to Knowva</button>
      </SignInButton>
      <div className={styles.divider}>or continue with</div>
      <SignInButton mode="modal">
        <button className={styles.social}>
          <GoogleIcon /> Continue with Google
        </button>
      </SignInButton>
      <div className={styles.modalFoot}>
        Don&apos;t have an account?{' '}
        <button className={styles.switchBtn} onClick={onSwitch}>Sign up free</button>
      </div>
    </>
  );
}

function SignUpForm({ onSwitch }: { onSwitch: () => void }) {
  return (
    <>
      <div className={styles.formGroup}>
        <label className={styles.label}>Full name</label>
        <input className={styles.input} type="text" placeholder="Jane Smith" />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label}>Email address</label>
        <input className={styles.input} type="email" placeholder="you@example.com" />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label}>Password</label>
        <input className={styles.input} type="password" placeholder="At least 8 characters" />
      </div>
      <SignUpButton mode="modal">
        <button className={styles.submit}>Create Free Account</button>
      </SignUpButton>
      <div className={styles.divider}>or sign up with</div>
      <SignUpButton mode="modal">
        <button className={styles.social}>
          <GoogleIcon /> Continue with Google
        </button>
      </SignUpButton>
      <div className={styles.modalFoot}>
        Already have an account?{' '}
        <button className={styles.switchBtn} onClick={onSwitch}>Sign in</button>
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}