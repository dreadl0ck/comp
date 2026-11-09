export type AnswerStatus = 'answered' | 'insufficient_evidence' | 'provider_error';

export function isNoEvidenceAnswer(answer: string): boolean {
  return answer.trim().toLowerCase() === 'n/a - no evidence found';
}
