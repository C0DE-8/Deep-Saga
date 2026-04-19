const { model } = require('../config/gemini');
const { buildSystemPrompt } = require('../config/prompts');

const ALLOWED_ENGINE_INTENTS = ['attack', 'observe', 'scan', 'move', 'hide', 'use_skill', 'talk', 'rest', 'train', 'craft'];
const ALLOWED_RISK_LEVELS = ['low', 'medium', 'high'];

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

function normalizeParserPayload(payload) {
    const intent = ALLOWED_ENGINE_INTENTS.includes(payload.intent) ? payload.intent : 'observe';
    const riskLevel = ALLOWED_RISK_LEVELS.includes(payload.risk_level) ? payload.risk_level : 'medium';

    return {
        intent,
        skill_name: payload.skill_name ? String(payload.skill_name) : null,
        target: payload.target ? String(payload.target) : null,
        approach: payload.approach ? String(payload.approach) : null,
        risk_level: riskLevel
    };
}

function buildActionParserPrompt({ actionText, sceneContext, skills }) {
    return `
You are the Deep-Saga engine action parser.
Convert the player's typed action into structured JSON only.

Allowed intents:
attack, observe, scan, move, hide, use_skill, talk, rest, train, craft

Owned skills:
${skills.length ? skills.join(', ') : 'None'}

Current scene context:
${JSON.stringify(sceneContext || {}, null, 2)}

Player text:
${JSON.stringify(actionText)}

Return JSON only. Do not include markdown, prose outside JSON, code fences, or comments.
The JSON must match this exact shape:
{
  "intent": "attack|observe|scan|move|hide|use_skill|talk|rest|train|craft",
  "skill_name": "string or null",
  "target": "string or null",
  "approach": "string or null",
  "risk_level": "low|medium|high"
}

If the player is trying to activate, cast, trigger, or rely on a named skill, use intent "use_skill" and include skill_name.
If the player is examining generally, use "observe".
If the player is using Soul Scan or explicitly scanning, use "scan".
If uncertain, choose the closest allowed intent and risk_level "medium".
`;
}

async function parseTypedAction({ actionText, sceneContext, skills }) {
    const prompt = buildActionParserPrompt({ actionText, sceneContext, skills });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const payload = extractJson(text);

    return normalizeParserPayload(payload);
}

function buildJsonOnlyPrompt({ player, location, action, fullContext, engineAction, mechanicUpdates }) {
    const systemPrompt = buildSystemPrompt(player, location, action, fullContext, {
        prioritizeLifeActions: true
    });

    return `
${systemPrompt}

--- ENGINE ACTION RESOLVED BY BACKEND ---
${JSON.stringify(engineAction || {}, null, 2)}

--- MECHANIC UPDATES ALREADY APPLIED BY BACKEND ---
${JSON.stringify(mechanicUpdates || {}, null, 2)}

Return JSON only. Do not include markdown, prose outside JSON, code fences, or comments.
Do not modify HP, MP, SP, hunger, XP, floor progress, skills, or death state. Those are backend-owned.
The JSON must match this shape:
{
  "narration": "compact dark fantasy narration",
  "choices": [
    { "label": "choice text", "cost": "cost text" },
    { "label": "choice text", "cost": "cost text" },
    { "label": "choice text", "cost": "cost text" }
  ],
  "tags": []
}
`;
}

async function generateGameTurn({ player, location, action, fullContext, engineAction, mechanicUpdates }) {
    const prompt = buildJsonOnlyPrompt({ player, location, action, fullContext, engineAction, mechanicUpdates });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const payload = extractJson(text);

    return {
        narration: payload.narration || '',
        choices: Array.isArray(payload.choices) ? payload.choices.slice(0, 3) : [],
        tags: Array.isArray(payload.tags) ? payload.tags : []
    };
}

module.exports = {
    generateGameTurn,
    parseTypedAction
};
