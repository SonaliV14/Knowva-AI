import { Worker } from 'bullmq';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { CharacterTextSplitter } from '@langchain/textsplitters';
import { QdrantClient } from '@qdrant/js-client-rest';
import { pipeline } from '@xenova/transformers';

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

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    console.log(`\n📄  Processing job:`, job.data);
    const data = JSON.parse(job.data);

    await ensureCollection();

    const loader = new PDFLoader(data.path);
    const rawDocs = await loader.load();
    console.log(`   → Loaded ${rawDocs.length} page(s) from "${data.filename}"`);

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