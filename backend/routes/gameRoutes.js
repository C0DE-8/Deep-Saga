const express = require('express');
const db = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');
const { generateGameTurn } = require('../services/aiService');

const router = express.Router();

router.use(authenticateToken);

const ALLOWED_STARTING_SKILLS = ['Ice Blast', 'Soul Scan', 'Devouring Core'];
const ALLOWED_VESSEL_TYPES = ['The Vanguard', 'The Weaver', 'The Stalker'];
const ALLOWED_SYSTEM_VOICES = ['ADMIN', 'TRICKSTER', 'SENSEI'];
const ATTRIBUTE_NAMES = ['strength', 'dexterity', 'stamina', 'intelligence', 'charisma', 'wisdom'];

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

function buildInitialState(body = {}) {
    return {
        player: {
            system_voice: body.systemVoice || 'ADMIN',
            species: body.species || 'Unknown Soul',
            vessel_type: body.vesselType || 'wanderer',
            current_level: 1,
            hp: 20,
            max_hp: 20,
            mp: 10,
            max_mp: 10,
            sp: 10,
            max_sp: 10,
            hunger: 20,
            offense: 3,
            defense: 3,
            magic_power: 2,
            resistance: 2,
            speed: 3,
            all_soul_skills: [],
            library_skills_map: {},
            active_skills: [],
            passive_skills: []
        },
        location: {
            name: body.locationName || 'Unmapped Depth',
            description_seed: body.locationDescription || 'A black corridor breathes with damp stone, old blood, and distant movement.',
            hidden_lore: ''
        },
        memory: [],
        lastNarration: null,
        choices: []
    };
}

function mergeStatePatch(state, patch) {
    return {
        ...state,
        ...patch,
        player: {
            ...state.player,
            ...(patch.player || {})
        },
        location: {
            ...state.location,
            ...(patch.location || {})
        }
    };
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
            xp: 0
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
    try {
        const [rows] = await db.execute(
            `SELECT id, state_json, created_at, updated_at
             FROM game_sessions
             WHERE user_id = ?
             ORDER BY updated_at DESC
             LIMIT 1`,
            [req.user.userId]
        );

        if (rows.length === 0) {
            return res.json({ session: null });
        }

        res.json({ session: rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Server error while loading game state.' });
    }
});

router.post('/start', async (req, res) => {
    const state = buildInitialState(req.body);

    try {
        const [result] = await db.execute(
            'INSERT INTO game_sessions (user_id, state_json) VALUES (?, ?)',
            [req.user.userId, JSON.stringify(state)]
        );

        res.status(201).json({
            session: {
                id: result.insertId,
                state_json: state
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error while starting game session.' });
    }
});

router.post('/action', async (req, res) => {
    const { sessionId, action } = req.body;

    if (!sessionId || !action) {
        return res.status(400).json({ error: 'sessionId and action are required.' });
    }

    try {
        const [sessions] = await db.execute(
            'SELECT id, state_json FROM game_sessions WHERE id = ? AND user_id = ? LIMIT 1',
            [sessionId, req.user.userId]
        );

        if (sessions.length === 0) {
            return res.status(404).json({ error: 'Game session not found.' });
        }

        const currentState = typeof sessions[0].state_json === 'string'
            ? JSON.parse(sessions[0].state_json)
            : sessions[0].state_json;

        const fullContext = JSON.stringify({
            memory: currentState.memory || [],
            lastNarration: currentState.lastNarration || null,
            choices: currentState.choices || []
        });

        const turn = await generateGameTurn({
            player: currentState.player,
            location: currentState.location,
            action,
            fullContext
        });

        const nextMemory = [
            ...(currentState.memory || []),
            { action, narration: turn.narration, tags: turn.tags }
        ].slice(-10);

        const nextState = mergeStatePatch(currentState, {
            ...turn.statePatch,
            memory: nextMemory,
            lastNarration: turn.narration,
            choices: turn.choices
        });

        await db.execute(
            'UPDATE game_sessions SET state_json = ? WHERE id = ? AND user_id = ?',
            [JSON.stringify(nextState), sessionId, req.user.userId]
        );

        await db.execute(
            'INSERT INTO game_turns (session_id, user_id, action_text, ai_response_json) VALUES (?, ?, ?, ?)',
            [sessionId, req.user.userId, action, JSON.stringify(turn)]
        );

        res.json({
            sessionId,
            turn,
            state: nextState
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error while processing game action.' });
    }
});

module.exports = router;
