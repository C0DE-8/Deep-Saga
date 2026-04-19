const express = require('express');
const db = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');
const { generateGameTurn, parseTypedAction } = require('../services/aiService');

const router = express.Router();

router.use(authenticateToken);

const ALLOWED_STARTING_SKILLS = ['Ice Blast', 'Soul Scan', 'Devouring Core'];
const ALLOWED_VESSEL_TYPES = ['The Vanguard', 'The Weaver', 'The Stalker'];
const ALLOWED_SYSTEM_VOICES = ['ADMIN', 'TRICKSTER', 'SENSEI'];
const ATTRIBUTE_NAMES = ['strength', 'dexterity', 'stamina', 'intelligence', 'charisma', 'wisdom'];
const INPUT_TYPES = ['choice', 'text'];
const ALLOWED_ENGINE_INTENTS = ['attack', 'observe', 'scan', 'move', 'hide', 'use_skill', 'talk', 'rest', 'train', 'craft'];

function asJson(value, fallback) {
    if (value == null) {
        return fallback;
    }

    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (err) {
            return fallback;
        }
    }

    return value;
}

function normalizeChoices(choices = []) {
    return choices.slice(0, 3).map((choice, index) => ({
        id: choice.id || `choice_${index + 1}`,
        label: choice.label || choice.text || String(choice),
        cost: choice.cost || 'Unknown',
        intent: choice.intent || inferIntent(choice.label || choice.text || String(choice))
    }));
}

function inferIntent(text = '') {
    const value = text.toLowerCase();

    if (value.includes('rest') || value.includes('recover') || value.includes('wait')) {
        return { intent: 'rest', skill_name: null, target: null, approach: null, risk_level: 'low' };
    }

    if (value.includes('scan')) {
        return { intent: 'scan', skill_name: value.includes('soul scan') ? 'Soul Scan' : null, target: null, approach: null, risk_level: 'low' };
    }

    if (value.includes('inspect') || value.includes('study') || value.includes('listen') || value.includes('observe')) {
        return { intent: 'observe', skill_name: null, target: null, approach: null, risk_level: 'low' };
    }

    if (value.includes('attack') || value.includes('strike') || value.includes('blast') || value.includes('fight')) {
        return { intent: value.includes('blast') ? 'use_skill' : 'attack', skill_name: value.includes('ice blast') ? 'Ice Blast' : null, target: null, approach: null, risk_level: 'high' };
    }

    if (value.includes('sneak') || value.includes('hide') || value.includes('stalk')) {
        return { intent: 'hide', skill_name: null, target: null, approach: null, risk_level: 'medium' };
    }

    if (value.includes('talk') || value.includes('speak') || value.includes('ask')) {
        return { intent: 'talk', skill_name: null, target: null, approach: null, risk_level: 'medium' };
    }

    if (value.includes('train') || value.includes('practice')) {
        return { intent: 'train', skill_name: null, target: null, approach: null, risk_level: 'low' };
    }

    if (value.includes('craft') || value.includes('build') || value.includes('make')) {
        return { intent: 'craft', skill_name: null, target: null, approach: null, risk_level: 'medium' };
    }

    return { intent: 'move', skill_name: null, target: null, approach: null, risk_level: 'medium' };
}

function normalizeEngineAction(action) {
    const intent = ALLOWED_ENGINE_INTENTS.includes(action.intent) ? action.intent : 'observe';

    return {
        intent,
        skill_name: action.skill_name || null,
        target: action.target || null,
        approach: action.approach || null,
        risk_level: ['low', 'medium', 'high'].includes(action.risk_level) ? action.risk_level : 'medium'
    };
}

function findOwnedSkill(skillName, skills) {
    if (!skillName) {
        return null;
    }

    return skills.find((skill) => skill.toLowerCase() === String(skillName).toLowerCase()) || null;
}

function findReferencedKnownSkill(text) {
    const value = String(text || '').toLowerCase();
    return ALLOWED_STARTING_SKILLS.find((skill) => value.includes(skill.toLowerCase())) || null;
}

function resolveChoiceInput(body, choices) {
    const choiceIndex = Number.isInteger(body.choice_index) ? body.choice_index : null;
    const choiceId = body.choice_id || null;

    if (choiceIndex != null) {
        const zeroBased = choiceIndex > 0 ? choiceIndex - 1 : choiceIndex;
        return choices[zeroBased] || null;
    }

    if (choiceId) {
        return choices.find((choice) => choice.id === choiceId) || null;
    }

    return null;
}

function createEnterFloorChoices(vesselType) {
    return normalizeChoices([
        {
            label: 'Read the nearest threat before moving deeper.',
            cost: 'Low SP',
            intent: { intent: 'observe', skill_name: null, target: 'floor', approach: 'read the nearest threat', risk_level: 'low' }
        },
        {
            label: `${vesselType} instinct: secure a survivable route through the dark.`,
            cost: 'Med SP',
            intent: { intent: 'move', skill_name: null, target: 'route', approach: 'secure a survivable route', risk_level: 'medium' }
        },
        {
            label: 'Push forward fast and risk drawing attention.',
            cost: 'High Hunger',
            intent: { intent: 'move', skill_name: null, target: 'depth', approach: 'push forward fast', risk_level: 'high' }
        }
    ]);
}

function applyMechanics(progress, engineAction) {
    const before = {
        hp: progress.hp,
        mp: progress.mp,
        sp: progress.sp,
        hunger: progress.hunger,
        xp: progress.xp,
        floor_progress: progress.floor_progress,
        is_dead: Boolean(progress.is_dead)
    };

    const next = { ...before };

    if (before.is_dead) {
        return { next, updates: { before, after: next, changes: {}, death_state: true } };
    }

    if (engineAction.intent === 'rest') {
        next.hp = Math.min(progress.max_hp, next.hp + 2);
        next.sp = Math.min(progress.max_sp, next.sp + 2);
        next.hunger = Math.min(100, next.hunger + 4);
    } else if (engineAction.intent === 'observe' || engineAction.intent === 'scan') {
        next.sp = Math.max(0, next.sp - 1);
        next.hunger = Math.min(100, next.hunger + 1);
        next.floor_progress = Math.min(100, next.floor_progress + 8);
        next.xp += 1;
    } else if (engineAction.intent === 'attack' || engineAction.intent === 'use_skill') {
        next.hp = Math.max(0, next.hp - 2);
        next.sp = Math.max(0, next.sp - 3);
        next.hunger = Math.min(100, next.hunger + 3);
        next.floor_progress = Math.min(100, next.floor_progress + 12);
        next.xp += 3;
    } else if (engineAction.intent === 'hide') {
        next.sp = Math.max(0, next.sp - 2);
        next.hunger = Math.min(100, next.hunger + 2);
        next.floor_progress = Math.min(100, next.floor_progress + 10);
        next.xp += 2;
    } else if (engineAction.intent === 'train' || engineAction.intent === 'craft') {
        next.sp = Math.max(0, next.sp - 2);
        next.hunger = Math.min(100, next.hunger + 2);
        next.xp += 2;
    } else if (engineAction.intent === 'talk') {
        next.hunger = Math.min(100, next.hunger + 1);
        next.xp += 1;
    } else {
        next.sp = Math.max(0, next.sp - 1);
        next.hunger = Math.min(100, next.hunger + 2);
        next.floor_progress = Math.min(100, next.floor_progress + 10);
        next.xp += 1;
    }

    if (next.hunger >= 100) {
        next.hp = Math.max(0, next.hp - 1);
    }

    next.is_dead = next.hp <= 0;

    const changes = {};
    for (const key of Object.keys(next)) {
        if (next[key] !== before[key]) {
            changes[key] = { from: before[key], to: next[key] };
        }
    }

    return {
        next,
        updates: {
            before,
            after: next,
            changes,
            death_state: next.is_dead
        }
    };
}

function buildPlayer(character, stats, progress, skills) {
    return {
        system_voice: character.system_voice,
        species: 'Awakened Soul',
        vessel_type: character.vessel_type,
        current_level: progress.current_level,
        hp: progress.hp,
        max_hp: progress.max_hp,
        mp: progress.mp,
        max_mp: progress.max_mp,
        sp: progress.sp,
        max_sp: progress.max_sp,
        hunger: progress.hunger,
        offense: stats.strength,
        defense: stats.stamina,
        magic_power: stats.intelligence,
        resistance: stats.wisdom,
        speed: stats.dexterity,
        all_soul_skills: skills,
        library_skills_map: {},
        active_skills: skills.map((name) => ({ name, sp_cost: 2, description: 'A registered soul skill.' })),
        passive_skills: []
    };
}

function buildLocation(progress) {
    return {
        name: `Floor ${progress.current_floor}`,
        description_seed: `The first dungeon floor stretches ahead. Progress through this floor is ${progress.floor_progress}/100.`,
        hidden_lore: ''
    };
}

async function loadGameBundle(connection, userId) {
    const [characters] = await connection.execute(
        `SELECT id, user_id, starting_skill, vessel_type, system_voice
         FROM characters
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (characters.length === 0) {
        return null;
    }

    const character = characters[0];
    const [statsRows] = await connection.execute(
        `SELECT strength, dexterity, stamina, intelligence, charisma, wisdom
         FROM character_stats
         WHERE character_id = ?
         LIMIT 1`,
        [character.id]
    );
    const [progressRows] = await connection.execute(
        `SELECT current_floor, current_level, xp, floor_progress, hp, max_hp, mp, max_mp, sp, max_sp, hunger, is_dead
         FROM character_progress
         WHERE character_id = ?
         LIMIT 1`,
        [character.id]
    );
    const [skillRows] = await connection.execute(
        'SELECT skill_name FROM character_skills WHERE character_id = ? ORDER BY id ASC',
        [character.id]
    );
    const [sessionRows] = await connection.execute(
        `SELECT id, state_json, created_at, updated_at
         FROM game_sessions
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [userId]
    );

    return {
        character,
        stats: statsRows[0],
        progress: progressRows[0],
        skills: skillRows.map((row) => row.skill_name),
        session: sessionRows[0] || null
    };
}

function validateInitializeBody(body = {}) {
    const attributes = body.attributes || {};
    const errors = [];

    for (const name of ATTRIBUTE_NAMES) {
        if (!Number.isInteger(attributes[name]) || attributes[name] < 0) {
            errors.push(`${name} must be a non-negative integer.`);
        }
    }

    const total = ATTRIBUTE_NAMES.reduce((sum, name) => sum + (attributes[name] || 0), 0);
    if (total !== 9) {
        errors.push('Total attribute points must equal 9.');
    }

    if (!ALLOWED_STARTING_SKILLS.includes(body.starting_skill)) {
        errors.push('starting_skill is invalid.');
    }

    if (!ALLOWED_VESSEL_TYPES.includes(body.vessel_type)) {
        errors.push('vessel_type is invalid.');
    }

    if (!ALLOWED_SYSTEM_VOICES.includes(body.system_voice)) {
        errors.push('system_voice is invalid.');
    }

    return errors;
}

router.post('/initialize', async (req, res) => {
    const errors = validateInitializeBody(req.body);

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Invalid initialization request.', details: errors });
    }

    const { attributes, starting_skill, vessel_type, system_voice } = req.body;
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [existingCharacters] = await connection.execute(
            'SELECT id FROM characters WHERE user_id = ? LIMIT 1',
            [req.user.userId]
        );

        if (existingCharacters.length > 0) {
            await connection.rollback();
            return res.status(409).json({ error: 'Character already initialized.' });
        }

        await connection.execute(
            'UPDATE users SET system_voice = ? WHERE id = ?',
            [system_voice, req.user.userId]
        );

        const [characterResult] = await connection.execute(
            `INSERT INTO characters (user_id, starting_skill, vessel_type, system_voice)
             VALUES (?, ?, ?, ?)`,
            [req.user.userId, starting_skill, vessel_type, system_voice]
        );

        const characterId = characterResult.insertId;

        await connection.execute(
            `INSERT INTO character_stats
             (character_id, strength, dexterity, stamina, intelligence, charisma, wisdom)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                characterId,
                attributes.strength,
                attributes.dexterity,
                attributes.stamina,
                attributes.intelligence,
                attributes.charisma,
                attributes.wisdom
            ]
        );

        await connection.execute(
            'INSERT INTO character_progress (character_id, current_floor, current_level, xp) VALUES (?, 1, 1, 0)',
            [characterId]
        );

        await connection.execute(
            'INSERT INTO character_skills (character_id, skill_name) VALUES (?, ?)',
            [characterId, starting_skill]
        );

        await connection.commit();

        const character = {
            id: characterId,
            user_id: req.user.userId,
            starting_skill,
            vessel_type,
            system_voice
        };

        const stats = {
            character_id: characterId,
            strength: attributes.strength,
            dexterity: attributes.dexterity,
            stamina: attributes.stamina,
            intelligence: attributes.intelligence,
            charisma: attributes.charisma,
            wisdom: attributes.wisdom
        };

        const progress = {
            character_id: characterId,
            floor: 1,
            level: 1,
            xp: 0,
            floor_progress: 0,
            hp: 20,
            max_hp: 20,
            mp: 10,
            max_mp: 10,
            sp: 10,
            max_sp: 10,
            hunger: 20,
            is_dead: false
        };

        res.status(201).json({
            system_welcome: `SYSTEM ONLINE. Vessel ${vessel_type} bound. ${starting_skill} registered. Floor 1 awaits.`,
            character,
            stats,
            progress,
            next_step: 'enter_floor'
        });
    } catch (err) {
        if (connection) {
            await connection.rollback();
        }

        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Character already initialized.' });
        }

        res.status(500).json({ error: 'Server error during game initialization.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

router.get('/state', async (req, res) => {
    let connection;

    try {
        connection = await db.getConnection();
        const bundle = await loadGameBundle(connection, req.user.userId);

        if (!bundle) {
            return res.status(404).json({ error: 'Character has not been initialized.' });
        }

        const state = asJson(bundle.session && bundle.session.state_json, {});

        res.json({
            character: bundle.character,
            stats: bundle.stats,
            progress: bundle.progress,
            skills: bundle.skills,
            scene: {
                narrative: state.narrative || null,
                choices: state.choices || [],
                raw_user_action: state.raw_user_action || null,
                parsed_engine_action: state.parsed_engine_action || null,
                mechanic_updates: state.mechanic_updates || null
            },
            death_state: Boolean(bundle.progress.is_dead),
            next_step: bundle.session ? 'choose_action' : 'enter_floor'
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error while loading game state.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

router.post('/enter-floor', async (req, res) => {
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const bundle = await loadGameBundle(connection, req.user.userId);
        if (!bundle) {
            await connection.rollback();
            return res.status(404).json({ error: 'Character has not been initialized.' });
        }

        if (bundle.progress.is_dead) {
            await connection.rollback();
            return res.status(409).json({ error: 'Character is deceased.' });
        }

        await connection.execute(
            'UPDATE character_progress SET floor_progress = 0 WHERE character_id = ?',
            [bundle.character.id]
        );

        const progress = { ...bundle.progress, floor_progress: 0 };
        const player = buildPlayer(bundle.character, bundle.stats, progress, bundle.skills);
        const location = buildLocation(progress);
        const rawUserAction = 'enter_floor';
        const parsedEngineAction = {
            intent: 'move',
            skill_name: null,
            target: `floor_${progress.current_floor}`,
            approach: 'enter the floor',
            risk_level: 'medium'
        };
        const mechanicUpdates = {
            before: {
                current_floor: bundle.progress.current_floor,
                floor_progress: bundle.progress.floor_progress
            },
            after: {
                current_floor: progress.current_floor,
                floor_progress: 0
            },
            changes: {
                floor_progress: { from: bundle.progress.floor_progress, to: 0 }
            },
            death_state: false
        };
        const choices = createEnterFloorChoices(bundle.character.vessel_type);
        const turn = await generateGameTurn({
            player,
            location,
            action: 'Enter the floor.',
            fullContext: JSON.stringify({ phase: 'enter_floor', choices }),
            engineAction: parsedEngineAction,
            mechanicUpdates
        });

        const state = {
            narrative: turn.narration,
            choices: normalizeChoices(turn.choices.length ? turn.choices : choices),
            raw_user_action: rawUserAction,
            parsed_engine_action: parsedEngineAction,
            mechanic_updates: mechanicUpdates
        };

        const [sessionResult] = await connection.execute(
            'INSERT INTO game_sessions (user_id, state_json) VALUES (?, ?)',
            [req.user.userId, JSON.stringify(state)]
        );
        const sessionId = sessionResult.insertId;

        await connection.execute(
            `INSERT INTO game_turns
             (session_id, user_id, action_text, raw_user_action, parsed_engine_action_json, mechanic_updates_json, narrative, generated_choices_json, ai_response_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sessionId,
                req.user.userId,
                rawUserAction,
                rawUserAction,
                JSON.stringify(parsedEngineAction),
                JSON.stringify(mechanicUpdates),
                turn.narration,
                JSON.stringify(state.choices),
                JSON.stringify(turn)
            ]
        );

        await connection.commit();

        res.status(201).json({
            session_id: sessionId,
            narrative: state.narrative,
            choices: state.choices,
            raw_user_action: rawUserAction,
            parsed_engine_action: parsedEngineAction,
            mechanic_updates: mechanicUpdates,
            progress,
            next_step: 'choose_action'
        });
    } catch (err) {
        if (connection) {
            await connection.rollback();
        }

        res.status(500).json({ error: 'Server error while entering floor.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

router.post('/action', async (req, res) => {
    const { input_type } = req.body;

    if (!INPUT_TYPES.includes(input_type)) {
        return res.status(400).json({ error: 'input_type must be either "choice" or "text".' });
    }

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const bundle = await loadGameBundle(connection, req.user.userId);

        if (!bundle) {
            await connection.rollback();
            return res.status(404).json({ error: 'Character has not been initialized.' });
        }

        if (!bundle.session) {
            await connection.rollback();
            return res.status(409).json({ error: 'Enter a floor before taking an action.' });
        }

        if (bundle.progress.is_dead) {
            await connection.rollback();
            return res.status(409).json({ error: 'Character is deceased.' });
        }

        const currentState = asJson(bundle.session.state_json, {});
        const currentChoices = normalizeChoices(currentState.choices || []);
        let rawUserAction;
        let parsedEngineAction;

        if (input_type === 'choice') {
            const resolvedChoice = resolveChoiceInput(req.body, currentChoices);

            if (!resolvedChoice) {
                await connection.rollback();
                return res.status(400).json({ error: 'Choice could not be resolved from current saved choices.' });
            }

            rawUserAction = resolvedChoice.label;
            parsedEngineAction = normalizeEngineAction(
                resolvedChoice.intent || inferIntent(resolvedChoice.label)
            );
        } else {
            rawUserAction = String(req.body.action_text || '').trim();

            if (!rawUserAction) {
                await connection.rollback();
                return res.status(400).json({ error: 'action_text is required when input_type is "text".' });
            }

            parsedEngineAction = normalizeEngineAction(
                await parseTypedAction({
                    actionText: rawUserAction,
                    sceneContext: {
                        narrative: currentState.narrative || null,
                        choices: currentChoices,
                        progress: bundle.progress,
                        location: buildLocation(bundle.progress)
                    },
                    skills: bundle.skills
                })
            );
        }

        const referencedKnownSkill = findReferencedKnownSkill(rawUserAction);
        const requestedSkill = parsedEngineAction.skill_name || referencedKnownSkill;

        if (requestedSkill && !findOwnedSkill(requestedSkill, bundle.skills)) {
            await connection.rollback();
            return res.status(403).json({
                error: 'Skill not owned.',
                raw_user_action: rawUserAction,
                parsed_engine_action: parsedEngineAction
            });
        }

        if (requestedSkill && !parsedEngineAction.skill_name) {
            parsedEngineAction.skill_name = findOwnedSkill(requestedSkill, bundle.skills);
        }

        const { next, updates: mechanicUpdates } = applyMechanics(bundle.progress, parsedEngineAction);
        await connection.execute(
            `UPDATE character_progress
             SET hp = ?, mp = ?, sp = ?, hunger = ?, xp = ?, floor_progress = ?, is_dead = ?
             WHERE character_id = ?`,
            [
                next.hp,
                next.mp,
                next.sp,
                next.hunger,
                next.xp,
                next.floor_progress,
                next.is_dead ? 1 : 0,
                bundle.character.id
            ]
        );

        const progress = {
            ...bundle.progress,
            hp: next.hp,
            mp: next.mp,
            sp: next.sp,
            hunger: next.hunger,
            xp: next.xp,
            floor_progress: next.floor_progress,
            is_dead: next.is_dead ? 1 : 0
        };
        const player = buildPlayer(bundle.character, bundle.stats, progress, bundle.skills);
        const location = buildLocation(progress);

        const turn = await generateGameTurn({
            player,
            location,
            action: rawUserAction,
            fullContext: JSON.stringify({
                previous_narrative: currentState.narrative || null,
                previous_choices: currentChoices,
                input_type
            }),
            engineAction: parsedEngineAction,
            mechanicUpdates
        });

        const choices = normalizeChoices(turn.choices.length ? turn.choices : createEnterFloorChoices(bundle.character.vessel_type));
        const nextState = {
            narrative: turn.narration,
            choices,
            raw_user_action: rawUserAction,
            parsed_engine_action: parsedEngineAction,
            mechanic_updates: mechanicUpdates
        };

        await connection.execute(
            'UPDATE game_sessions SET state_json = ? WHERE id = ? AND user_id = ?',
            [JSON.stringify(nextState), bundle.session.id, req.user.userId]
        );

        await connection.execute(
            `INSERT INTO game_turns
             (session_id, user_id, action_text, raw_user_action, parsed_engine_action_json, mechanic_updates_json, narrative, generated_choices_json, ai_response_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                bundle.session.id,
                req.user.userId,
                rawUserAction,
                rawUserAction,
                JSON.stringify(parsedEngineAction),
                JSON.stringify(mechanicUpdates),
                turn.narration,
                JSON.stringify(choices),
                JSON.stringify(turn)
            ]
        );

        await connection.commit();

        res.json({
            session_id: bundle.session.id,
            narrative: turn.narration,
            choices,
            raw_user_action: rawUserAction,
            parsed_engine_action: parsedEngineAction,
            mechanic_updates: mechanicUpdates,
            progress,
            death_state: Boolean(next.is_dead),
            next_step: next.is_dead ? 'dead' : 'choose_action'
        });
    } catch (err) {
        if (connection) {
            await connection.rollback();
        }

        res.status(500).json({ error: 'Server error while processing game action.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

module.exports = router;
