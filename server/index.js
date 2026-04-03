import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import { QdrantClient } from '@qdrant/js-client-rest';
import { pipeline } from '@xenova/transformers';
import { mkdir } from 'fs/promises';

// Make sure uploads folder exists
await mkdir('uploads', { recursive: true });

// ── Qdrant ──────────────────────────────────────────────────────────────────
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
const COLLECTION = 'knowva-docs';

// ── Local embedder (downloads model on first run, ~25 MB) ───────────────────
let embedder = null;
async function getEmbedder() {
  if (!embedder) {
    console.log('Loading embedding model for the first time...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('Embedding model ready.');
  }
  return embedder;
}
async function embed(text) {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// ── BullMQ queue ─────────────────────────────────────────────────────────────
const queue = new Queue('file-upload-queue', {
  connection: { host: 'localhost', port: 6379 },
});

// ── Multer storage ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed.'));
    }
    cb(null, true);
  },
});

const app = express();
app.use(cors());
app.use(express.json());

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ status: 'Knowva server is running!' }));

// ── Upload PDF (max 5 at a time) ─────────────────────────────────────────────
app.post('/upload/pdf', (req, res, next) => {
  upload.array('pdf', 5)(req, res, (err) => {
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Maximum 5 files can be uploaded at a time.',
      });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  // No files attached at all
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  // Extra safety check
  if (req.files.length > 5) {
    return res.status(400).json({
      error: 'Maximum 5 files can be uploaded at a time.',
    });
  }

  // Queue a separate job for each file
  for (const file of req.files) {
    await queue.add(
      'file-ready',
      JSON.stringify({
        filename: file.originalname,
        destination: file.destination,
        path: file.path,
      })
    );
  }

  return res.json({
    message: `${req.files.length} file(s) uploaded successfully. Indexing has started.`,
    filenames: req.files.map((f) => f.originalname),
  });
});

// ── Chat ─────────────────────────────────────────────────────────────────────
app.get('/chat', async (req, res) => {
  const userQuery = req.query.message;

  if (!userQuery || typeof userQuery !== 'string' || !userQuery.trim()) {
    return res.status(400).json({ error: 'Please provide a message.' });
  }

  try {
    // 1. Embed the user's query locally
    const queryVector = await embed(userQuery);

    // 2. Check collection exists
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION);
    if (!exists) {
      return res.status(200).json({
        message: 'No files uploaded. Please upload a PDF first to get started!',
        docs: [],
      });
    }

    // 3. Check if collection has any vectors
    const collectionInfo = await qdrant.getCollection(COLLECTION);
    const pointCount = collectionInfo.points_count ?? 0;
    if (pointCount === 0) {
      return res.status(200).json({
        message: 'No files uploaded. Please upload a PDF first to get started!',
        docs: [],
      });
    }

    // 4. Search Qdrant for the 4 nearest chunks
    const searchResults = await qdrant.search(COLLECTION, {
      vector: queryVector,
      limit: 4,
      with_payload: true,
    });

    // 5. Build context from retrieved chunks
    const contextText = searchResults
      .map((r, i) => {
        const source = r.payload?.source || `Document ${i + 1}`;
        return `[From: ${source}]\n${r.payload?.text ?? ''}`;
      })
      .join('\n\n---\n\n');

    const SYSTEM_PROMPT = `You are Knowva, a friendly and knowledgeable AI assistant that helps people find answers inside their uploaded documents.

Your goal is to answer the user's question in clear, natural, conversational English — the way a helpful colleague would explain something, not a machine reading out metadata.

Important rules:
- Write in plain English paragraphs. Be warm, direct, and easy to understand.
- NEVER include brackets, page numbers, or source labels inside your answer.
- If the answer comes from multiple documents, combine the information smoothly into one clear response.
- If you genuinely cannot find the answer in the documents, say so honestly in a friendly way.
- You can use **bold** to emphasize important terms or numbers.
- Keep responses focused — 2 to 4 short paragraphs is usually ideal.

Context retrieved from the user's uploaded documents:
${contextText || 'No relevant content was found in the uploaded documents.'}`;

    // 6. Call Ollama (runs locally, 100% free)
    const ollamaRes = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        stream: false,
        options: { temperature: 0.4, num_predict: 800 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userQuery },
        ],
      }),
    });

    if (!ollamaRes.ok) {
      const err = await ollamaRes.text();
      console.error('Ollama error:', err);
      return res.status(502).json({
        error: 'Could not reach the local Ollama model. Is Ollama running? Try: ollama serve',
      });
    }

    const ollamaData = await ollamaRes.json();
    const raw = ollamaData.message?.content ?? '';

    // Safety strip — remove any leftover bracket artifacts
    const clean = raw
      .replace(/\[Page \d+\]/gi, '')
      .replace(/\[p\.\s*\d+\]/gi, '')
      .replace(/\[Source:.*?\]/gi, '')
      .replace(/\(Source:.*?\)/gi, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\s{3,}/g, '\n\n')
      .trim();

    return res.json({
      message: clean,
      docs: searchResults.map((r) => ({
        pageContent: r.payload?.text,
        metadata: { source: r.payload?.source, page: r.payload?.page },
        score: r.score,
      })),
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({
      error: 'Something went wrong while processing your question. Please try again.',
    });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`\n🚀  Knowva server running → http://localhost:${PORT}\n`);
});