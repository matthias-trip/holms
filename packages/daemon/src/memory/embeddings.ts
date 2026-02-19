import { pipeline, env } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

export interface EmbeddingPipeline {
  embed(text: string): Promise<Float32Array>;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

export async function createEmbeddingPipeline(cacheDir: string): Promise<EmbeddingPipeline> {
  // Configure cache directory
  env.cacheDir = cacheDir;
  // Disable remote model fetching warnings in production
  env.allowLocalModels = true;

  console.log(`[Embeddings] Loading model ${MODEL_NAME} (cache: ${cacheDir})...`);
  const extractor = await pipeline("feature-extraction", MODEL_NAME, {
    dtype: "fp32",
  });
  console.log(`[Embeddings] Model ready (${EMBEDDING_DIM}-dim vectors)`);

  return {
    async embed(text: string): Promise<Float32Array> {
      const start = performance.now();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const ms = (performance.now() - start).toFixed(1);
      console.log(`[Embeddings] Embedded ${text.length} chars in ${ms}ms`);
      // output.data is a Float32Array for single input
      return new Float32Array(output.data as ArrayLike<number>);
    },
  };
}

export { EMBEDDING_DIM };
