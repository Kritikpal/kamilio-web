'use strict';

// MySQL connection pool pointing at the SAME database Kamailio uses.
// See kamailio.cfg: `mysql://xyz:xyz@mysql/kamailio` and the `user_details`
// table (username, domain, password [plaintext], device_token, status).
// Credentials are overridable via env; defaults match the docker-compose setup.

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'xyz',
  password: process.env.DB_PASSWORD || 'xyz',
  database: process.env.DB_NAME || 'kamailio',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '5', 10),
  queueLimit: 0,
});

module.exports = { pool };
