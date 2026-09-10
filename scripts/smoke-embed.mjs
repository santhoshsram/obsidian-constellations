import { pipeline, env } from '@huggingface/transformers';

console.log('creating pipeline…');
const pipe = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
  dtype: 'q8',
  progress_callback: (p) => {
    if (p.status === 'progress') process.stdout.write(`\r${p.file} ${Math.round(p.progress)}%   `);
    else console.log(p.status, p.file ?? '');
  },
});
console.log('\npipeline ready');

const docs = await pipe(['search_document: async communication in teams', 'search_document: sourdough bread recipe'], { pooling: 'mean', normalize: true });
console.log('doc dims:', docs.dims);
const q = await pipe(['search_query: working asynchronously'], { pooling: 'mean', normalize: true });
console.log('query dims:', q.dims);

function cos(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
console.log('cos(async doc, query) =', cos(docs[0].data ?? docs.data.slice(0, 768), q.data).toFixed(4));
