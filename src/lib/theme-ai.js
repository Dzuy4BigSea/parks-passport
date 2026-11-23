// AI research for a city theme: Claude searches the web for the city's best-known landmarks,
// history, nature and culture, and drafts a line icon for each. The result is untrusted: the
// caller validates every field and sanitizes every SVG, and drafts wait for an admin to approve.
// The SDK is imported only when a job runs, so it costs no memory otherwise.

const MODEL = 'claude-opus-5-5';
const MAX_CONTINUATIONS = 5;
// The whole run must end before the job counts as dead (theme-job.js STALE_MS = 15 minutes).
export const RUN_DEADLINE_MS = 12 * 60 * 1000;

/** An error whose message is written for the admin and safe to show on the page. */
export class UserFacingError extends Error {}

const SAVE_TOOL = {
  name: 'save_city_theme',
  description: 'Save the finished city theme. Call this exactly once, at the end, with every motif.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tagline', 'accent', 'accent_2', 'motifs'],
    properties: {
      tagline: { type: 'string', description: "The city's best-known nickname, 40 characters or fewer (e.g. 'Sunshine City')." },
      accent: { type: 'string', description: 'A decorative accent color tied to the city, as #RRGGBB.' },
      accent_2: { type: 'string', description: 'A second decorative accent color, as #RRGGBB.' },
      motifs: {
        type: 'array',
        description: '8 to 12 motifs.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'blurb', 'svg'],
          properties: {
            name: { type: 'string', description: 'Short name, 40 characters or fewer.' },
            blurb: { type: 'string', description: 'One or two factual sentences, 240 characters or fewer.' },
            svg: { type: 'string', description: 'The line icon, following the icon rules.' },
          },
        },
      },
    },
  },
};

const SYSTEM = `You research cities for Parks Passport, an app where people collect stamps for visiting city parks.
For the city you're given, find the landmarks, history, nature and culture that locals and visitors know best,
and turn each into a "motif": a name, a short factual blurb and a simple line icon used as decoration across the app.

Choose motifs:
- Favor things people recognize on sight and that connect to the outdoors, parks, waterfronts, wildlife and local history.
- Use well-established facts you can confirm with search. Write each blurb as one or two plain sentences, 240 characters or fewer, with no citations or links.
- Leave out logos, sports-team marks, businesses, brands and anything trademarked, and don't depict real people.
- Skip any motif whose name is in the "already have" list.

Draw each icon by these rules, because the app rejects anything else:
- One <svg viewBox="0 0 48 48"> element containing only path, circle, ellipse, line, polyline, polygon, rect and g elements.
- Allowed attributes: d, points, cx, cy, r, rx, ry, x, y, x1, y1, x2, y2, width, height, transform, fill="none" only. No style, class, id, text, gradients or colors. The app strokes every shape in one color with round caps at width 2.5.
- Keep shapes inside 4 to 44 on both axes, use 2 to 8 shapes, and keep the SVG under 1,200 characters.
- Aim for a bold, friendly silhouette that reads at 24 pixels, in the style of a modern outline icon set.

Pick two accent colors that evoke the city (for example its water, sunsets or a signature flower). They are decorative only.
When you're done, call save_city_theme once with everything.`;

const userPrompt = ({ city, existing }) => `City: ${JSON.stringify(city)}
Already have: ${JSON.stringify(existing)}
Research this city, then call save_city_theme with 8 to 12 new motifs.`;

/**
 * createThemeGenerator({ apiKey }) -> { available, generate({ city, existing }) } where
 * generate resolves to the save_city_theme input (unvalidated) or throws with a readable message.
 */
export function createThemeGenerator({ apiKey = '', clientFactory = null } = {}) {
  const available = Boolean(apiKey);
  async function client() {
    if (clientFactory) return clientFactory();
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey, timeout: 5 * 60 * 1000, maxRetries: 1 });
  }

  async function generate(args, { deadlineMs = RUN_DEADLINE_MS } = {}) {
    if (!available) throw new UserFacingError('No ANTHROPIC_API_KEY is set on the server.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('The theme run took too long.', 'TimeoutError')), deadlineMs);
    try {
      return await run(args, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function run({ city, existing = [] }, signal) {
    const anthropic = await client();
    const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }, SAVE_TOOL];
    const messages = [{ role: 'user', content: userPrompt({ city, existing }) }];
    let reminded = false;
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        // Opus 5.5 can decline under its safety classifiers; route those to a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages,
      }, { signal });
      if (response.stop_reason === 'refusal') throw new UserFacingError('The model declined this request. Try a different city name.');
      const call = response.content.find((b) => b.type === 'tool_use' && b.name === SAVE_TOOL.name);
      if (call) return call.input;
      if (response.stop_reason === 'pause_turn') {
        // The server paused a long search turn: send it back unchanged and it resumes.
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      if (response.stop_reason === 'max_tokens') throw new UserFacingError('The response ran out of room before it finished. Try again.');
      if (reminded) break;
      reminded = true;
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Please call save_city_theme now with your motifs.' });
    }
    throw new UserFacingError("The model didn't return a theme. Try again.");
  }

  return { available, generate };
}
