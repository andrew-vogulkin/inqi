import { ConfigService } from '../config/config.service';
import { SearxngWebSearchProvider } from './searxng.provider';
import { WEB_SEARCH_TOOLS } from './websearch.tools';

/**
 * LIVE integration test (opt-in): drives the **local Qwen model** (spark, llama.cpp,
 * OpenAI-compatible tool-calling) through the **real SearXNG provider** to research a
 * place — map location + a rating/recent-reviews parse from general web results.
 *
 * Skipped by default so the normal suite stays offline. Run it explicitly:
 *   LIVE_WEBSEARCH=1 pnpm --filter @inqi/backend test maps-research
 *
 * Overridable via env: QWEN_LOCAL_BASE_URL, WEBSEARCH_BASE_URL, RESEARCH_PLACE.
 */
const LIVE = process.env.LIVE_WEBSEARCH === '1';
const MODEL_URL = process.env.QWEN_LOCAL_BASE_URL ?? 'http://192.168.1.45:8000/v1';
const SEARX_URL = process.env.WEBSEARCH_BASE_URL ?? 'https://orange.tail035fe2.ts.net:8443';
const PLACE = process.env.RESEARCH_PLACE ?? 'Niche MONO Sukhumvit Bearing';

interface ToolCall { id: string; function: { name: string; arguments: string } }
interface Msg { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string }

function provider(): SearxngWebSearchProvider {
  const config = { webSearch: { baseUrl: SEARX_URL, timeoutMs: 25_000, maxResults: 6 } } as unknown as ConfigService;
  return new SearxngWebSearchProvider(config);
}

/**
 * One round-trip to the local model. With `withTools=false` the `tools` field is
 * omitted entirely so the model produces a plain text answer — cleaner than
 * `tool_choice:'none'`, which makes llama.cpp leak the tool-call template as text.
 */
async function chat(messages: Msg[], withTools = true): Promise<Msg> {
  const body: Record<string, unknown> = {
    model: 'qwen',
    messages,
    max_tokens: 900,
    temperature: 0.2,
    // The local model is a reasoning model — disable thinking for fast, bounded replies.
    chat_template_kwargs: { enable_thinking: false },
  };
  if (withTools) {
    body.tools = WEB_SEARCH_TOOLS;
    body.tool_choice = 'auto';
  }
  const res = await fetch(`${MODEL_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`model responded ${res.status}`);
  const j = (await res.json()) as { choices: Array<{ message: Msg }> };
  return j.choices[0].message;
}

(LIVE ? describe : describe.skip)('LIVE: local AI researches a place via web/maps tools', () => {
  it(
    `finds "${PLACE}" location + parses rating & recent reviews`,
    async () => {
      const search = provider();
      const messages: Msg[] = [
        {
          role: 'system',
          content: [
            'You are a places researcher. Use the provided tools to research the place the user names.',
            'Step 1: call web_search with category="map" ONCE to get coordinates — the map result includes "latitude", "longitude" (and sometimes "address") fields; read them from there, do not repeat the map search.',
            'Step 2: call web_search with category="general" using a query like "<place> review rating" to find its star rating and recent reviews.',
            'Reviews may be in Thai (e.g. "คะแนน 4.2(4)" means rating 4.2 from 4 reviews) — you may call the translate tool (source_lang "th") to read them.',
            'Do at most 4 searches total. Then STOP calling tools and reply with ONLY a JSON object:',
            '{"name": string, "location": {"lat": number|null, "lng": number|null, "address": string|null},',
            '"rating": number|null, "reviewsCount": number|null, "recentReviews": string[], "summary": string}.',
          ].join(' '),
        },
        { role: 'user', content: `Research "${PLACE}".` },
      ];

      const toolLog: { name: string; args: string; result: string }[] = [];
      let final: Msg | undefined;
      const MAX_TOOLCALLS = 4; // budget: ~1 map + a few general searches, then synthesize

      for (let round = 0; round < 8; round++) {
        // Once the search budget is spent, force a final answer with no tools advertised.
        if (toolLog.length >= MAX_TOOLCALLS) {
          messages.push({ role: 'user', content: 'Based on the searches above, output ONLY the final JSON now. Do not search again.' });
          final = await chat(messages, false);
          break;
        }
        const m = await chat(messages, true);
        if (m.tool_calls?.length) {
          messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
          for (const tc of m.tool_calls) {
            const result = await search.executeTool({ name: tc.function.name, args: tc.function.arguments });
            toolLog.push({ name: tc.function.name, args: tc.function.arguments, result });
            messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: result });
          }
          continue;
        }
        final = m;
        break;
      }

      // Fallback: if the loop somehow ended without a text answer, force one (no tools).
      if (!final) {
        messages.push({ role: 'user', content: 'Output ONLY the final JSON now.' });
        final = await chat(messages, false);
      }

      /* eslint-disable no-console */
      console.log(`\n=== TOOL CALLS (${toolLog.length}) ===`);
      for (const t of toolLog) console.log(`• ${t.name}(${t.args})\n    → ${t.result.slice(0, 280)}${t.result.length > 280 ? '…' : ''}`);
      console.log('\n=== FINAL ANSWER ===\n' + (final?.content ?? '(model produced no final answer)'));
      /* eslint-enable no-console */

      // The model actually drove a map search (got coordinates) + a general search,
      // then synthesized the structured answer (not a leaked tool-call template).
      expect(toolLog.some((t) => t.name === 'web_search' && t.args.includes('map'))).toBe(true);
      expect(toolLog.some((t) => t.result.includes('latitude'))).toBe(true);
      const answer = (final?.content ?? '').toLowerCase();
      expect(answer).toContain('niche');
      expect(answer).toContain('rating'); // the structured JSON schema key
    },
    180_000,
  );
});
