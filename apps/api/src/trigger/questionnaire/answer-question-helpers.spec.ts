jest.mock('@ai-sdk/openai', () => ({ openai: jest.fn(() => 'fixture') }), { virtual: true });
jest.mock('@trigger.dev/sdk', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }), { virtual: true });
jest.mock('ai', () => ({ generateText: jest.fn() }), { virtual: true });
jest.mock('@/vector-store/lib', () => ({ findSimilarContent: jest.fn(), findSimilarContentBatch: jest.fn() }));

import { generateText } from 'ai';
import { findSimilarContent, findSimilarContentBatch } from '@/vector-store/lib';
import { generateAnswerFromContent, generateAnswerWithRAG, generateAnswerWithRAGBatch } from './answer-question-helpers';

const evidence = [{ id: 'chunk-fixture', sourceType: 'policy' as const, sourceId: 'policy-fixture', policyName: 'Recovery', content: 'All files were restored.', score: 0.9 }];

describe('questionnaire answer outcomes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retains qualified answers and original source identity', async () => {
    jest.mocked(generateText).mockResolvedValue({ text: 'Our recovery drill confirmed no evidence was lost and all files were restored.' } as Awaited<ReturnType<typeof generateText>>);
    const result = await generateAnswerFromContent('Did the drill succeed?', evidence);
    expect(result.status).toBe('answered');
    expect(result.answer).toContain('all files were restored');
    expect(result.sources[0].sourceId).toBe('policy-fixture');
  });

  it('distinguishes absent evidence from provider failure', async () => {
    expect((await generateAnswerFromContent('Question', [])).status).toBe('insufficient_evidence');
    expect(generateText).not.toHaveBeenCalled();
    jest.mocked(generateText).mockRejectedValue(new Error('timeout'));
    expect((await generateAnswerFromContent('Question', evidence)).status).toBe('provider_error');
  });

  it('recognizes exact abstention without matching embedded N/A', async () => {
    jest.mocked(generateText).mockResolvedValue({ text: 'N/A - no evidence found' } as Awaited<ReturnType<typeof generateText>>);
    expect((await generateAnswerFromContent('Question', evidence)).status).toBe('insufficient_evidence');
    jest.mocked(generateText).mockResolvedValue({ text: 'Physical appliances are N/A; laptops require MFA.' } as Awaited<ReturnType<typeof generateText>>);
    expect((await generateAnswerFromContent('Question', evidence)).status).toBe('answered');
  });

  it('marks every batch result as a provider error when retrieval fails', async () => {
    jest.mocked(findSimilarContentBatch).mockRejectedValue(new Error('retrieval unavailable'));
    const result = await generateAnswerWithRAGBatch(['a', 'b'], 'fixture-org');
    expect(result.map((item) => item.status)).toEqual(['provider_error', 'provider_error']);
    expect(findSimilarContent).not.toHaveBeenCalled();
  });

  it('reports single-question retrieval failure separately from absent sources', async () => {
    jest.mocked(findSimilarContent).mockRejectedValue(new Error('retrieval unavailable'));
    expect((await generateAnswerWithRAG('question', 'fixture-org')).status).toBe('provider_error');
    jest.mocked(findSimilarContent).mockResolvedValue([]);
    expect((await generateAnswerWithRAG('question', 'fixture-org')).status).toBe('insufficient_evidence');
  });
});
