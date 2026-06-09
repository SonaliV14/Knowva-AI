import { Worker } from 'bullmq';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { CharacterTextSplitter } from '@langchain/textsplitters';
import { QdrantClient } from '@qdrant/js-client-rest';
import { pipeline } from '@xenova/transformers';
import { readFile } from 'fs/promises';
import path from 'path';

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
const COLLECTION = 'knowva-docs';
const VECTOR_SIZE = 384;

let embedder = null;
async function getEmbedder() {
  if (!embedder) {
    console.log('Loading embedding model...');
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

async function ensureCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
    console.log(`Created Qdrant collection: ${COLLECTION}`);
  }
}

async function loadDocuments(filePath, filename) {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.pdf') {
    const loader = new PDFLoader(filePath);
    return loader.load();
  }

  // txt and md — read as plain text
  if (ext === '.txt' || ext === '.md') {
    const content = await readFile(filePath, 'utf-8');
    return [{ pageContent: content, metadata: { source: filename } }];
  }

  // docx — extract text from XML parts
  if (ext === '.docx') {
    const { default: JSZip } = await import('jszip');
    const buffer = await readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) throw new Error('Invalid DOCX: word/document.xml not found');
    const xml = await xmlFile.async('string');
    // Strip XML tags, decode common entities
    const text = xml
      .replace(/<w:br[^>]*/g, '\n')
      .replace(/<w:p[ >][^>]*>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return [{ pageContent: text, metadata: { source: filename } }];
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    console.log(`\n  Processing job:`, job.data);
    const data = JSON.parse(job.data);

    await ensureCollection();

    const rawDocs = await loadDocuments(data.path, data.filename);
    console.log(`   → Loaded ${rawDocs.length} section(s) from "${data.filename}"`);

    const splitter = new CharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });
    const chunks = await splitter.splitDocuments(rawDocs);
    console.log(`   → Split into ${chunks.length} chunks`);

    const points = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = await embed(chunk.pageContent);

      points.push({
        id: Date.now() * 1000 + i,
        vector,
        payload: {
          text: chunk.pageContent,
          source: data.filename,
          page: chunk.metadata?.loc?.pageNumber ?? null,
        },
      });
    }

    const BATCH = 50;
    for (let i = 0; i < points.length; i += BATCH) {
      await qdrant.upsert(COLLECTION, { points: points.slice(i, i + BATCH) });
    }

    console.log(`All ${points.length} chunks stored for "${data.filename}"\n`);
  },
  {
    concurrency: 5,
    connection: {
      host: 'localhost',
      port: 6379,
    },
  }
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

console.log(' Worker is running and waiting for jobs...\n');
