import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import { QdrantClient } from '@qdrant/js-client-rest';
import { pipeline } from '@xenova/transformers';
import { mkdir } from 'fs/promises';

await mkdir('uploads', { recursive: true });

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
const COLLECTION = 'knowva-docs';

const ALLOWED_EXTS = new Set(['.pdf', '.txt', '.docx', '.md']);
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/octet-stream', // fallback some OSes use for .docx/.md
]);

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

const queue = new Queue('file-upload-queue', {
  connection: { host: 'localhost', port: 6379 },
});

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
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (!ALLOWED_EXTS.has(ext) && !ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new Error('Only PDF, TXT, DOCX, and MD files are allowed.'));
    }
    cb(null, true);
  },
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.json({ status: 'Knowva server is running!' }));

app.post('/upload/pdf', (req, res, next) => {
  upload.array('pdf', 5)(req, res, (err) => {
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Maximum 5 files can be uploaded at a time.' });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  if (req.files.length > 5) {
    return res.status(400).json({ error: 'Maximum 5 files can be uploaded at a time.' });
  }

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

app.get('/chat', async (req, res) => {
  const userQuery = req.query.message;
  // Comma-separated list of currently active filenames from the client
  const sourcesParam = req.query.sources;

  if (!userQuery || typeof userQuery !== 'string' || !userQuery.trim()) {
    return res.status(400).json({ error: 'Please provide a message.' });
  }

  try {
    const queryVector = await embed(userQuery);

    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION);
    if (!exists) {
      return res.status(200).json({
        message: 'No files uploaded. Please upload a document first to get started!',
        docs: [],
      });
    }

    const collectionInfo = await qdrant.getCollection(COLLECTION);
    const pointCount = collectionInfo.points_count ?? 0;
    if (pointCount === 0) {
      return res.status(200).json({
        message: 'No files uploaded. Please upload a document first to get started!',
        docs: [],
      });
    }

    // Build an optional filter to scope results to only the user's current files
    const activeFilenames = sourcesParam
      ? sourcesParam.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const searchOptions = {
      vector: queryVector,
      limit: 4,
      with_payload: true,
    };

    if (activeFilenames.length > 0) {
      searchOptions.filter = {
        should: activeFilenames.map((name) => ({
          key: 'source',
          match: { value: name },
        })),
      };
    }

    const searchResults = await qdrant.search(COLLECTION, searchOptions);

    if (searchResults.length === 0) {
      return res.status(200).json({
        message: "I couldn't find relevant content in your uploaded documents. The files may still be indexing — please wait a moment and try again.",
        docs: [],
      });
    }

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
${contextText}`;

    const ollamaRes = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3',
        stream: true,
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

    // Stream the response back as Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send the source docs metadata first
    const docsPayload = searchResults.map((r) => ({
      pageContent: r.payload?.text,
      metadata: { source: r.payload?.source, page: r.payload?.page },
      score: r.score,
    }));
    res.write(`data: ${JSON.stringify({ type: 'docs', docs: docsPayload })}\n\n`);

    // Stream tokens
    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const token = parsed.message?.content ?? '';
          if (token) {
            fullText += token;
            res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
          }
          if (parsed.done) {
            const clean = fullText
              .replace(/\[Page \d+\]/gi, '')
              .replace(/\[p\.\s*\d+\]/gi, '')
              .replace(/\[Source:.*?\]/gi, '')
              .replace(/\(Source:.*?\)/gi, '')
              .replace(/\[\d+\]/g, '')
              .replace(/\s{3,}/g, '\n\n')
              .trim();
            res.write(`data: ${JSON.stringify({ type: 'done', message: clean })}\n\n`);
          }
        } catch {
          // incomplete JSON line — skip
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Something went wrong while processing your question. Please try again.',
      });
    }
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Something went wrong.' })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`\n  Knowva server running → http://localhost:${PORT}\n`);
});
