import { isNoEvidenceAnswer } from './answer-disposition';

describe('questionnaire answer disposition', () => {
  it('recognizes only the exact abstention sentinel', () => {
    expect(isNoEvidenceAnswer(' N/A - no evidence found\n')).toBe(true);
    for (const answer of [
      'We enforce MFA for every employee.',
      'We mark physical appliance access N/A; all employee laptops require MFA.',
      'Our recovery drill confirmed no evidence was lost and all files were restored.',
      'Encryption was not found in the context, but access review is documented.',
    ]) {
      expect(isNoEvidenceAnswer(answer)).toBe(false);
    }
  });
});
