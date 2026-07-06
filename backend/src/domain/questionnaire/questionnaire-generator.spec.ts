import { QuestionType } from './questionnaire.types';
import { DECIDE_FOR_ME, DEFAULT_QUESTIONS, QuestionnaireGenerator } from './questionnaire-generator';

const WEB = { tools: [{ type: 'function', function: { name: 'web_search' } }], executeTool: jest.fn(async () => '[]') };

const validQuestions = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `q ${i}!`, prompt: `Question number ${i} about the topic?`, options: ['Option A', 'Option B', 'Option C'],
}));

function makeGen(toolStructured: jest.Mock, configured = true) {
  const ai = { isConfigured: () => configured, toolStructured };
  return new QuestionnaireGenerator(ai as never, WEB as never);
}

describe('QuestionnaireGenerator (the questionnaire research agent)', () => {
  it('returns 7-10 select questions with options + the appended confirm gate', async () => {
    const toolStructured = jest.fn(async ({ validate }: { validate: (raw: unknown) => unknown }) => validate({ questions: validQuestions(8) }));
    const qs = await makeGen(toolStructured).generate({ rawRequest: 'best bangkok bars' });

    expect(qs).toHaveLength(9); // 8 generated + confirm
    const confirm = qs[qs.length - 1];
    expect(confirm).toMatchObject({ id: 'confirm', type: QuestionType.Confirm });
    for (const q of qs.slice(0, -1)) {
      expect(q.type).toBe(QuestionType.Select);
      expect(q.options!.length).toBeGreaterThanOrEqual(3);
      expect(q.options![q.options!.length - 1]).toBe(DECIDE_FOR_ME); // the always-appended fallback
      expect(q.id).toMatch(/^[a-z0-9_]+$/); // slugged ids (answers are keyed by them)
    }
  });

  it('maps the agent\'s multi flag: multi → multiselect, single → select; "Decide for me" never duplicates', async () => {
    const mixed = [
      { id: 'budget', prompt: 'Whats the budget band for this?', options: ['<1000', '1000-3000', '3000+'], multi: false },
      { id: 'features', prompt: 'Which features matter to you most?', options: ['Rooftop', 'Live music', 'Decide for me'], multi: true },
      ...validQuestions(5),
    ];
    const toolStructured = jest.fn(async ({ validate }: { validate: (raw: unknown) => unknown }) => validate({ questions: mixed }));
    const qs = await makeGen(toolStructured).generate({ rawRequest: 'best bangkok bars' });

    const budget = qs.find((q) => q.id === 'budget')!;
    const features = qs.find((q) => q.id === 'features')!;
    expect(budget.type).toBe(QuestionType.Select);
    expect(features.type).toBe(QuestionType.MultiSelect);
    // the agent snuck in its own "Decide for me" — it must appear exactly once, last
    expect(features.options).toEqual(['Rooftop', 'Live music', DECIDE_FOR_ME]);
  });

  it('researches until the schema is satisfied — a thin first attempt is retried', async () => {
    const toolStructured = jest.fn()
      .mockImplementationOnce(async ({ validate }: { validate: (raw: unknown) => unknown }) => validate({ questions: validQuestions(4) })) // only 4 questions → schema rejects
      .mockImplementationOnce(async ({ validate }: { validate: (raw: unknown) => unknown }) => validate({ questions: validQuestions(7) }));
    const qs = await makeGen(toolStructured).generate({ rawRequest: 'a wedding florist in Edinburgh' });

    expect(toolStructured).toHaveBeenCalledTimes(2); // attempt 1 failed validation → fresh research run
    expect(qs).toHaveLength(8); // 7 + confirm
  });

  it('ships the static default only after exhausting all attempts', async () => {
    const toolStructured = jest.fn(async ({ validate }: { validate: (raw: unknown) => unknown }) => validate({ questions: [] }));
    const qs = await makeGen(toolStructured).generate({ rawRequest: 'anything' });
    expect(toolStructured).toHaveBeenCalledTimes(3);
    expect(qs).toBe(DEFAULT_QUESTIONS);
  });

  it('frames the agent as an expert in the enriched subject', async () => {
    const toolStructured = jest.fn(async ({ system, validate }: { system: string; validate: (raw: unknown) => unknown }) => {
      expect(system).toContain('expert in Specialty coffee roasters');
      return validate({ questions: validQuestions(7) });
    });
    await makeGen(toolStructured).generate({ rawRequest: 'coffee', subject: { title: 'Specialty coffee roasters' } });
    expect(toolStructured).toHaveBeenCalled();
  });

  it('AI unconfigured → static default, no agent run', async () => {
    const toolStructured = jest.fn();
    const qs = await makeGen(toolStructured, false).generate({ rawRequest: 'x' });
    expect(qs).toBe(DEFAULT_QUESTIONS);
    expect(toolStructured).not.toHaveBeenCalled();
  });
});
