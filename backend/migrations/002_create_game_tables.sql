CREATE TABLE IF NOT EXISTS game_sessions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    state_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY game_sessions_user_id_idx (user_id),
    CONSTRAINT game_sessions_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_turns (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    action_text TEXT NOT NULL,
    raw_user_action TEXT NULL,
    parsed_engine_action_json JSON NULL,
    mechanic_updates_json JSON NULL,
    narrative TEXT NULL,
    generated_choices_json JSON NULL,
    ai_response_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY game_turns_session_id_idx (session_id),
    KEY game_turns_user_id_idx (user_id),
    CONSTRAINT game_turns_session_id_fk
        FOREIGN KEY (session_id) REFERENCES game_sessions (id)
        ON DELETE CASCADE,
    CONSTRAINT game_turns_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
);
