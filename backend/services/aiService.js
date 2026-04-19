const { model } = require('../config/gemini');
const { buildSystemPrompt } = require('../config/prompts');

function extractJson(text) {
    const raw = String(text || '').trim();

    try {
        return JSON.parse(raw);
    } catch (err) {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error('Gemini response did not contain JSON.');
        }

        return JSON.parse(match[0]);
    }
}

function buildJsonOnlyPrompt({ player, location, action, fullContext }) {
    const systemPrompt = buildSystemPrompt(player, location, action, fullContext, {
        prioritizeLifeActions: true
    });

    return `
${systemPrompt}

Return JSON only. Do not include markdown, prose outside JSON, code fences, or comments.
The JSON must match this shape:
{
  "narration": "compact dark fantasy narration",
  "choices": [
    { "label": "choice text", "cost": "cost text" },
    { "label": "choice text", "cost": "cost text" },
    { "label": "choice text", "cost": "cost text" }
  ],
  "statePatch": {},
  "tags": []
}
`;
}

async function generateGameTurn({ player, location, action, fullContext }) {
    const prompt = buildJsonOnlyPrompt({ player, location, action, fullContext });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const payload = extractJson(text);

    return {
        narration: payload.narration || '',
        choices: Array.isArray(payload.choices) ? payload.choices.slice(0, 3) : [],
        statePatch: payload.statePatch && typeof payload.statePatch === 'object' ? payload.statePatch : {},
        tags: Array.isArray(payload.tags) ? payload.tags : []
    };
}

module.exports = {
    generateGameTurn
};
