/**
 * BM25 Sparse Vector Generation for Hybrid Search
 *
 * Implements BM25 (Best Matching 25) algorithm for keyword-based sparse embeddings.
 * Used in hybrid search to complement semantic (dense) embeddings.
 *
 * BM25 Formula:
 * score(D,Q) = Σ IDF(qi) * (f(qi,D) * (k1 + 1)) / (f(qi,D) + k1 * (1 - b + b * |D| / avgdl))
 *
 * Where:
 * - D = document
 * - Q = query
 * - qi = query term i
 * - f(qi,D) = term frequency of qi in D
 * - |D| = document length
 * - avgdl = average document length
 * - k1 = term frequency saturation parameter (default 1.2)
 * - b = length normalization parameter (default 0.75)
 * - IDF = inverse document frequency
 */

// Standard BM25 parameters (Okapi BM25)
const BM25_K1 = 1.2; // Term frequency saturation
const BM25_B = 0.75; // Length normalization

// English stopwords to filter out
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'the', 'this', 'but', 'they', 'have'
]);

/**
 * Vocabulary mapping: term -> term ID
 */
export interface Vocabulary {
  termToId: Map<string, number>;
  idToTerm: Map<number, string>;
  documentCount: number;
  documentFrequency: Map<number, number>; // How many documents contain each term
  averageDocumentLength: number;
}

/**
 * Sparse vector representation: { termId: score }
 * Only non-zero values are stored for efficiency
 */
export type SparseVector = Record<number, number>;

/**
 * Tokenize text into terms
 * - Lowercase
 * - Split on word boundaries
 * - Remove stopwords
 * - Keep only alphanumeric characters
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ') // Keep alphanumeric, underscores, hyphens
    .split(/\s+/)
    .filter(term => term.length > 1 && !STOPWORDS.has(term)); // Remove single chars and stopwords
}

/**
 * Build vocabulary from a collection of documents
 * Creates term-to-ID mapping and calculates IDF statistics
 *
 * @param documents - Array of text documents
 * @returns Vocabulary with term mappings and statistics
 */
export function buildVocabulary(documents: string[]): Vocabulary {
  const termToId = new Map<string, number>();
  const idToTerm = new Map<number, string>();
  const documentFrequency = new Map<number, number>();

  let totalDocumentLength = 0;
  let nextId = 0;

  // First pass: build term vocabulary and document frequency
  documents.forEach(doc => {
    const tokens = tokenize(doc);
    totalDocumentLength += tokens.length;

    // Track unique terms in this document
    const uniqueTerms = new Set(tokens);

    uniqueTerms.forEach(term => {
      // Assign ID if new term
      if (!termToId.has(term)) {
        termToId.set(term, nextId);
        idToTerm.set(nextId, term);
        documentFrequency.set(nextId, 0);
        nextId++;
      }

      // Increment document frequency
      const termId = termToId.get(term)!;
      documentFrequency.set(termId, (documentFrequency.get(termId) || 0) + 1);
    });
  });

  const averageDocumentLength = documents.length > 0 ? totalDocumentLength / documents.length : 0;

  return {
    termToId,
    idToTerm,
    documentCount: documents.length,
    documentFrequency,
    averageDocumentLength
  };
}

/**
 * Calculate IDF (Inverse Document Frequency) for a term
 *
 * IDF = log((N - df + 0.5) / (df + 0.5) + 1)
 *
 * Where:
 * - N = total number of documents
 * - df = number of documents containing the term
 */
function calculateIDF(documentCount: number, documentFrequency: number): number {
  if (documentCount === 0) return 0;

  // Smoothed IDF formula (prevents negative values)
  return Math.log((documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5) + 1);
}

/**
 * Generate BM25 sparse vector for a single text
 *
 * @param text - Input text to vectorize
 * @param vocabulary - Pre-built vocabulary with statistics
 * @returns Sparse vector as { termId: BM25 score }
 */
export function generateBM25Vector(
  text: string,
  vocabulary: Vocabulary
): SparseVector {
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return {};
  }

  const documentLength = tokens.length;

  // Calculate term frequencies
  const termFrequency = new Map<number, number>();
  tokens.forEach(term => {
    const termId = vocabulary.termToId.get(term);
    if (termId !== undefined) {
      termFrequency.set(termId, (termFrequency.get(termId) || 0) + 1);
    }
  });

  // Calculate BM25 scores
  const sparseVector: SparseVector = {};

  termFrequency.forEach((tf, termId) => {
    const df = vocabulary.documentFrequency.get(termId) || 1;
    const idf = calculateIDF(vocabulary.documentCount, df);

    // BM25 formula
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (documentLength / vocabulary.averageDocumentLength));
    const bm25Score = idf * (numerator / denominator);

    // Only store non-zero values
    if (bm25Score > 0) {
      sparseVector[termId] = bm25Score;
    }
  });

  return sparseVector;
}

/**
 * Serialize vocabulary to JSON for persistence
 */
export function serializeVocabulary(vocabulary: Vocabulary): string {
  return JSON.stringify({
    termToId: Array.from(vocabulary.termToId.entries()),
    idToTerm: Array.from(vocabulary.idToTerm.entries()),
    documentCount: vocabulary.documentCount,
    documentFrequency: Array.from(vocabulary.documentFrequency.entries()),
    averageDocumentLength: vocabulary.averageDocumentLength
  });
}

/**
 * Deserialize vocabulary from JSON
 */
export function deserializeVocabulary(json: string): Vocabulary {
  const data = JSON.parse(json);

  return {
    termToId: new Map(data.termToId),
    idToTerm: new Map(data.idToTerm),
    documentCount: data.documentCount,
    documentFrequency: new Map(data.documentFrequency),
    averageDocumentLength: data.averageDocumentLength
  };
}

/**
 * Convert sparse vector to Milvus format
 * Milvus expects: { indices: number[], values: number[] }
 */
export function toMilvusSparseVector(sparseVector: SparseVector): { indices: number[]; values: number[] } {
  const indices: number[] = [];
  const values: number[] = [];

  Object.entries(sparseVector).forEach(([termId, score]) => {
    indices.push(parseInt(termId));
    values.push(score);
  });

  return { indices, values };
}

/**
 * Convert Milvus sparse vector back to our format
 */
export function fromMilvusSparseVector(milvusVector: { indices: number[]; values: number[] }): SparseVector {
  const sparseVector: SparseVector = {};

  milvusVector.indices.forEach((termId, i) => {
    sparseVector[termId] = milvusVector.values[i];
  });

  return sparseVector;
}

/**
 * Get top N terms from sparse vector for debugging
 */
export function getTopTerms(
  sparseVector: SparseVector,
  vocabulary: Vocabulary,
  n: number = 5
): Array<{ term: string; score: number }> {
  const entries = Object.entries(sparseVector)
    .map(([termId, score]) => ({
      term: vocabulary.idToTerm.get(parseInt(termId)) || 'unknown',
      score
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

  return entries;
}
