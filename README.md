# ![logo](client/app/favicon.svg) Knowva-AI

> **Ask anything. Across every document.**

Knowva-AI is a full-stack **Retrieval-Augmented Generation (RAG)** application that lets you upload PDF documents and have intelligent, context-aware conversations with them — entirely on your own machine, with no paid API keys required.

Upload your files. Ask in English. Get clear, synthesized answers drawn directly from your documents.

---


## What Does It Do?

- 📄 **Upload PDFs** — Drag and drop up to 5 PDFs at a time into the sidebar
- 🔍 **Semantic Search** — Finds the most relevant passages using vector similarity, not keyword matching
- 💬 **Natural Chat** — Ask follow-up questions in English and get synthesized answers
- 📎 **Source Tracking** — Every answer shows which document it came from
- 🔒 **Private by Default** — All processing happens locally, documents are never sent to external servers
- ⚡ **Fast Indexing** — Documents are chunked, embedded, and stored in seconds using a local embedding model

---

## Key Characteristics

| Characteristic | Detail |
|---|---|
| **100% Free to Run** | No OpenAI or cloud API keys needed |
| **Fully Local AI** | Embeddings and LLM run entirely on your machine |
| **Multi-Document** | Search and synthesize across multiple PDFs simultaneously |
| **Async Processing** | PDF indexing happens in the background via a job queue |
| **Secure** | Documents isolated per user, never used for model training |
| **Scalable Architecture** | Queue-based worker pattern handles concurrent uploads cleanly |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Next.js 15)                          │
│                                                                     │
│   Landing Page → Clerk Auth → Chat Interface → PDF Upload           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP REST API
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   EXPRESS SERVER (Port 8000)                         │
│                                                                     │
│   POST /upload/pdf              GET /chat?message=...               │
│        │                               │                            │
│        │ Save file to disk             │ 1. Embed query (local)     │
│        │ Push job to queue             │ 2. Check collection exists │
│        ▼                               │ 3. Search Qdrant           │
│   ┌──────────┐                         │ 4. Build context prompt    │
│   │  Redis   │                         │ 5. Call Ollama             │
│   │ (BullMQ) │                         │ 6. Return clean answer     │
│   └────┬─────┘                         │                            │
└────────│───────────────────────────────┼────────────────────────────┘
         │                               │
         ▼                               ▼
┌─────────────────────┐       ┌───────────────────────┐
│      WORKER         │       │   Qdrant Vector DB    │
│                     │       │     (Port 6333)       │
│  1. Load PDF        │─────▶│                       │
│  2. Chunk text      │ upsert│  Collection:          │
│  3. Embed chunks    │       │  knowva-docs          │
│  4. Store vectors   │       │  384-dim Cosine       │
└─────────────────────┘       └───────────────────────┘
         ▲                               ▲
         │                               │ vector search
┌────────┴───────────────────────────────┴────────────┐
│                 LOCAL AI STACK                      │
│                                                     │
│  Embeddings → Xenova/all-MiniLM-L6-v2  (~25 MB)     │
│  LLM        → Ollama + llama3 / phi3 / mistral      │
└─────────────────────────────────────────────────────┘
```

---

## How It Works — Step by Step

### Phase 1: Document Indexing

```
User uploads PDF
      │
      ▼
Express server saves file → disk (uploads/)
      │
      ▼
Job pushed to Redis queue via BullMQ
      │
      ▼
Worker picks up the job
      │
      ├── PDFLoader extracts raw text
      │
      ├── CharacterTextSplitter chunks into 500-token segments
      │        with 50-token overlap
      │
      ├── all-MiniLM-L6-v2 generates 384-dim embedding
      │        for each chunk (runs locally, no API)
      │
      └── Vectors + metadata upserted into Qdrant
               (text, source filename, page number)
```

### Phase 2: Chat & Retrieval

```
User sends a question
      │
      ▼
Query embedded using same local model (all-MiniLM-L6-v2)
      │
      ▼
Qdrant searches for top 4 most similar chunks (Cosine similarity)
      │
      ▼
Retrieved chunks assembled into a context prompt
      │
      ▼
Ollama (llama3) generates a natural language answer
      │
      ▼
Response cleaned and returned to the client with source citations
```

---

## Tech Stack

### Frontend (client/)

| Technology | Version | Purpose |
|---|---|---|
| Next.js | 15.3.0 | React framework with App Router |
| TypeScript | ^5 | Type safety across the codebase |
| Tailwind CSS | ^4 | Utility-first styling |
| CSS Modules | — | Scoped component styles |
| Clerk | ^6.15.0 | Authentication & user management |
| Lucide React | ^0.488.0 | Icon library |

### Backend (server/)

| Technology | Version | Purpose |
|---|---|---|
| Node.js | >=18 | Runtime |
| Express | 4.x | REST API server |
| BullMQ | ^5.49.0 | Job queue for async PDF processing |
| Redis | — | Queue backend for BullMQ |
| Multer | 1.4.5-lts.2 | PDF file upload handling |

### AI & Vector Search

| Technology | Purpose |
|---|---|
| `@xenova/transformers` | Runs embedding model locally in Node.js |
| `Xenova/all-MiniLM-L6-v2` | Sentence embedding model (384 dimensions) |
| Qdrant | High-performance vector database |
| Ollama | Local LLM runtime — free, no API key |
| llama3 / phi3 / mistral | LLM models for answer generation |

### PDF Processing

| Technology | Purpose |
|---|---|
| `@langchain/community` PDFLoader | Extracts text content from PDF files |
| `@langchain/textsplitters` | Splits text into overlapping chunks |

### Infrastructure

| Technology | Purpose |
|---|---|
| Docker / Docker Compose | Runs Qdrant vector database |
| Redis / Memurai (Windows) | Backs the BullMQ job queue |

---

## Project Structure

```
Knowva-AI/
│
├── docker-compose.yml            # Starts Qdrant
│
├── client/                       # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx            # Root layout with Clerk provider
│   │   ├── page.tsx              # Root route → Landing page
│   │   ├── chat/
│   │   │   └── page.tsx          # Protected chat route
│   │   └── components/
│   │       ├── LandingPage.tsx   # Landing page with auth modal
│   │       ├── LandingPage.module.css
│   │       ├── ChatPage.tsx      # Main chat interface
│   │       └── ChatPage.module.css
│   ├── middleware.ts             # Clerk auth — protects /chat
│   └── package.json
│
└── server/                       # Node.js backend
    ├── index.js                  # Express API (upload + chat routes)
    ├── worker.js                 # BullMQ worker (PDF processing)
    ├── uploads/                  # Temporary PDF storage (gitignored)
    └── package.json
```

---

## Prerequisites

Make sure all of these are installed before starting:

- [Node.js](https://nodejs.org/) v18+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Qdrant)
- [Redis](https://redis.io/) or [Memurai](https://www.memurai.com/) on Windows
- [Ollama](https://ollama.com/download) with a model pulled

---

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/your-username/Knowva-AI.git
cd Knowva-AI
```

### 2. Install client dependencies
```bash
cd client
npm install
```

### 3. Install server dependencies
```bash
cd server
npm install --legacy-peer-deps
```

### 4. Configure environment variables

Create `client/.env.local`:
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

### 5. Pull an Ollama model (one-time setup)
```bash
ollama pull llama3      # ~4.7 GB — best quality
# or
ollama pull phi3        # ~2.3 GB — lighter option
```

---

## Running the Application

Open **5 separate terminals** and run in this exact order:

```bash
# Terminal 1 — Qdrant (via Docker)
docker-compose up

# Terminal 2 — Redis
redis-server
# (skip if using Memurai on Windows — it runs automatically)

# Terminal 3 — Ollama
ollama serve

# Terminal 4 — Backend worker
cd server
node worker.js

# Terminal 5 — Backend API server
cd server
npm run dev

# Terminal 6 — Frontend
cd client
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Usage Guide

1. **Sign up or log in** using Clerk authentication on the landing page
2. **Upload PDFs** by dragging files into the sidebar or clicking the upload zone
   - Maximum **5 files** can be uploaded at a time
   - Only PDF files are accepted
3. **Wait for indexing** — watch for the status dot to turn green (indexed)
4. **Ask a question** in the chat input in plain English
5. **Read the answer** — Knowva shows a synthesized response with source document tags below each reply

---

## Configuration

### Switch LLM model
In `server/index.js`, change the model to any model you have pulled via Ollama:
```js
model: 'phi3',     // or 'mistral', 'gemma', 'llama3', etc.
```

### Adjust chunk size
In `server/worker.js`:
```js
const splitter = new CharacterTextSplitter({
  chunkSize: 500,    // tokens per chunk — increase for more context
  chunkOverlap: 50,  // overlap between chunks — helps with boundary issues
});
```

---

## System Requirements

| Model | Minimum RAM |
|---|---|
| llama3 | 8 GB |
| mistral | 8 GB |
| phi3 | 4 GB |

---

