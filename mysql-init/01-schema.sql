-- Schema for the Kamailio edge proxy.
--
-- The cfg authenticates REGISTER against `user_details` via auth_db with
-- calculate_ha1=yes, so it reads the plaintext `password` column and computes
-- HA1 on the fly. The same table also stores the per-user VoIP push token and
-- online/offline status (written by sql_query in kamailio.cfg).
--
-- usrloc runs db_mode=0 (in-memory), so no `location` table is required.

CREATE TABLE IF NOT EXISTS user_details (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    username     VARCHAR(64)  NOT NULL,
    domain       VARCHAR(128) NOT NULL DEFAULT '',
    password     VARCHAR(128) NOT NULL DEFAULT '',
    device_token VARCHAR(255) DEFAULT NULL,
    status       VARCHAR(16)  NOT NULL DEFAULT 'offline',
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- ON DUPLICATE KEY UPDATE in the REGISTER route keys off username.
    UNIQUE KEY uniq_username (username)
);

-- Example/seed users. Change the domain to match what your SIP client sends
-- (the From-domain is used as the auth realm). Passwords are plaintext here
-- because auth_db runs calculate_ha1=yes and derives HA1 on the fly.
INSERT INTO user_details (username, domain, password, status) VALUES
    ('711',     'sip.example.com', 'secret711', 'offline'),
    ('sandeep', 'sip.example.com', 'sandeep',   'offline'),
    ('jajati',  'sip.example.com', 'jajati',    'offline')
ON DUPLICATE KEY UPDATE domain = VALUES(domain), password = VALUES(password);
