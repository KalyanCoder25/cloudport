/**
 * Shared PostgreSQL connection pool for the backend API.
 * A pool is created lazily on first use so that importing this module (e.g.
 * in unit tests that never touch the database) does not attempt a connection.
 */
'use strict';

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured.');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

module.exports = { getPool, query };
