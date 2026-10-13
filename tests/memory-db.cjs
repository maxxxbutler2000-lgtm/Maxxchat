// Test-only PostgreSQL adapter. Production always uses the real pg driver.
const { newDb } = require('pg-mem');
require.cache[require.resolve('pg')] = { exports: newDb({ noAstCoverageCheck: true }).adapters.createPg() };
process.env.DATABASE_URL = 'postgres://local-test';
