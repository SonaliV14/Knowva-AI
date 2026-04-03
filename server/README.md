# Knowva.AI 🧠

A full-stack **Retrieval-Augmented Generation (RAG)** application that lets you upload PDF documents and chat with them using a locally-running AI.

---

## What It Does

Upload any PDF, and Knowva indexes it into a vector database. You can then ask questions in English and get accurate, context-aware answers drawn directly from your documents — all running on your own machine for free.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Next.js)                         │
│          Clerk Auth  →  Upload PDF  →  Chat Interface           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP (REST)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER (:8000)                        │
│                                                                 │
│   POST /upload/pdf          GET /chat?message=...               │
│        │                          │                             │
│        │ Enqueue job              │ 1. Embed query (local)      │
│        ▼                          │ 2. Search Qdrant            │
│   ┌─────────┐                     │ 3. Build context            │
│   │  Redis  │                     │ 4. Call Ollama              │
│   │ (Queue) │                     │ 5. Return answer            │
│   └────┬────┘                     │                             │
└────────│──────────────────────────┼─────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐       ┌─────────────────────┐
│     WORKER      │       │   Qdrant Vector DB   │
│                 │       │     (:6333)          │
│ 1. Load PDF     │──────▶│                      │
│ 2. Chunk text   │ store │  Collection:         │
│ 3. Embed chunks │       │  knowva-docs         │
│ 4. Upsert to DB │       │  (384-dim vectors)   │
└─────────────────┘       └─────────────────────┘
         ▲                          ▲
         │                          │ search
┌────────┴──────────────────────────┴─────────────┐
│              LOCAL AI STACK (Free)               │
│                                                  │
│  Embeddings: Xenova/all-MiniLM-L6-v2 (~25 MB)   │
│  LLM:        Ollama + llama3 / phi3 / mistral    │
└──────────────────────────────────────────────────┘
```

---

## Tech Stack

### Client
| Technology | Purpose |
|---|---|
| Next.js 15 | React framework with App Router |
| TypeScript | Type safety |
| Tailwind CSS v4 | Styling |
| shadcn/ui | UI component library |
| Clerk | Authentication & user management |

### Server
| Technology | Purpose |
|---|---|
| Node.js + Express | REST API server |
| BullMQ | Job queue for async PDF processing |
| Redis | Queue backend for BullMQ |
| Multer | PDF file upload handling |

### AI & Vector Search
| Technology | Purpose |
|---|---|
| `@xenova/transformers` | Local embedding model (no API key needed) |
| `Xenova/all-MiniLM-L6-v2` | Sentence embedding model (384 dimensions) |
| Qdrant | Vector database for storing & searching embeddings |
| Ollama | Local LLM runtime (free, runs on your machine) |
| llama3 / phi3 / mistral | LLM models for generating answers |

### PDF Processing
| Technology | Purpose |
|---|---|
| `@langchain/community` PDFLoader | Extracts text from PDFs |
| `@langchain/textsplitters` | Chunks text into 500-token segments |

---

## How It Works — Step by Step

### 1. PDF Upload & Indexing
1. User uploads a PDF via the client
2. The Express server saves the file to disk and pushes a job to the **Redis queue** via BullMQ
3. The **Worker** picks up the job and:
   - Loads the PDF using `PDFLoader`
   - Splits it into overlapping chunks (500 tokens, 50 overlap)
   - Generates a **384-dimension vector embedding** for each chunk using `all-MiniLM-L6-v2` (runs entirely locally)
   - Upserts all vectors + metadata (text, filename, page number) into **Qdrant**

### 2. Chat & Retrieval
1. User sends a question via the chat interface
2. The Express server:
   - Embeds the question using the same local model
   - Searches Qdrant for the **4 most semantically similar** chunks
   - Builds a context prompt from the retrieved chunks
   - Sends the context + question to **Ollama** (running locally)
3. Ollama generates a natural language answer grounded in the document content
4. The answer is returned to the client

---

## Prerequisites

Make sure the following are installed and running before starting:

- [Node.js](https://nodejs.org/) v18+
- [Redis](https://redis.io/) or [Memurai](https://www.memurai.com/) (Windows)
- [Qdrant](https://qdrant.tech/documentation/quick-start/) (via Docker or binary)
- [Ollama](https://ollama.com/download) with a model pulled

---

## Installation & Setup

### 1. Clone the repository
```bash
git clone https://github.com/your-username/Knowva.AI.git
cd Knowva.AI
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

### 4. Set up environment variables

In the `client` folder, create a `.env.local` file:
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

### 5. Pull an Ollama model (one-time)
```bash
ollama pull llama3    # ~4.7 GB — best quality
# or
ollama pull phi3      # ~2.3 GB — lighter, good for low RAM
```

### 6. Start Qdrant
```bash
# Using Docker
docker run -p 6333:6333 qdrant/qdrant
```

---

## Running the App

Open **4 separate terminals** and run in this order:

```bash
# Terminal 1 — Redis (skip if using Memurai on Windows, it auto-runs)
redis-server

# Terminal 2 — Ollama
ollama serve

# Terminal 3 — Worker (processes uploaded PDFs)
cd server
node worker.js

# Terminal 4 — Express API server
cd server
npm run dev

# Terminal 5 — Next.js client
cd client
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Usage

1. **Sign up / Log in** via Clerk authentication
2. **Upload a PDF** using the upload button
3. **Wait** for the worker to finish indexing (check the worker terminal for `✅ All chunks stored`)
4. **Ask questions** about your document in the chat

---


## Configuration

### Switching LLM models
In `server/index.js`, change the model name to any model you have pulled via Ollama:
```js
model: 'phi3',     // or 'mistral', 'llama3', 'gemma', etc.
```

### Chunk size
In `server/worker.js`, adjust chunking behavior:
```js
const splitter = new CharacterTextSplitter({
  chunkSize: 500,    // tokens per chunk
  chunkOverlap: 50,  // overlap between chunks
});
```

---

## System Requirements

| Component | Minimum RAM |
|---|---|
| llama3 | 8 GB |
| mistral | 8 GB |
| phi3 | 4 GB |

---
