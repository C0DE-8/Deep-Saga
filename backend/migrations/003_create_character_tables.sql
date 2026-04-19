CREATE TABLE IF NOT EXISTS characters (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    starting_skill ENUM('Ice Blast', 'Soul Scan', 'Devouring Core') NOT NULL,
    vessel_type ENUM('The Vanguard', 'The Weaver', 'The Stalker') NOT NULL,
    system_voice ENUM('ADMIN', 'TRICKSTER', 'SENSEI') NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY characters_user_id_unique (user_id),
    CONSTRAINT characters_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_stats (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    character_id INT UNSIGNED NOT NULL,
    strength TINYINT UNSIGNED NOT NULL,
    dexterity TINYINT UNSIGNED NOT NULL,
    stamina TINYINT UNSIGNED NOT NULL,
    intelligence TINYINT UNSIGNED NOT NULL,
    charisma TINYINT UNSIGNED NOT NULL,
    wisdom TINYINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY character_stats_character_id_unique (character_id),
    CONSTRAINT character_stats_character_id_fk
        FOREIGN KEY (character_id) REFERENCES characters (id)
        ON DELETE CASCADE,
    CONSTRAINT character_stats_total_points_chk
        CHECK ((strength + dexterity + stamina + intelligence + charisma + wisdom) = 9)
);

CREATE TABLE IF NOT EXISTS character_progress (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    character_id INT UNSIGNED NOT NULL,
    current_floor INT UNSIGNED NOT NULL DEFAULT 1,
    current_level INT UNSIGNED NOT NULL DEFAULT 1,
    xp INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY character_progress_character_id_unique (character_id),
    CONSTRAINT character_progress_character_id_fk
        FOREIGN KEY (character_id) REFERENCES characters (id)
        ON DELETE CASCADE
);
