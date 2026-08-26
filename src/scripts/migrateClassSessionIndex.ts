/**
 * migrateClassSessionIndex.ts
 *
 * Drops the buggy ClassSession unique index
 * { finalClass, cycleYear, cycleMonth, sessionNumber } (missing cycleNumber,
 * causes cross-cycle collisions) and lets mongoose recreate the corrected
 * index { finalClass, cycleNumber, cycleYear, cycleMonth, sessionNumber }
 * defined in models/ClassSession.ts.
 *
 * Usage:
 *   npx ts-node -r dotenv/config src/scripts/migrateClassSessionIndex.ts
 *   TEST_MONGODB_URI=... npx ts-node -r dotenv/config src/scripts/migrateClassSessionIndex.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import ClassSession from '../models/ClassSession';

const DB_URI = process.env.TARGET_MONGODB_URI || process.env.MONGODB_URI || '';

async function run() {
  if (!DB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(DB_URI);
  console.log(`✓ Connected to: ${mongoose.connection.name}`);

  const indexes = await ClassSession.collection.indexes();
  const staleIndexName = 'finalClass_1_cycleYear_1_cycleMonth_1_sessionNumber_1';
  const stale = indexes.find((i) => i.name === staleIndexName);

  if (stale) {
    await ClassSession.collection.dropIndex(staleIndexName);
    console.log(`✓ Dropped stale index: ${staleIndexName}`);
  } else {
    console.log(`- Stale index ${staleIndexName} not present, skipping drop`);
  }

  await ClassSession.syncIndexes();
  console.log('✓ Synced indexes to match current schema');

  const finalIndexes = await ClassSession.collection.indexes();
  console.log('\nCurrent indexes:');
  finalIndexes.forEach((i) => console.log(' -', i.name, JSON.stringify(i.key)));
}

run()
  .then(() => { console.log('\nDone.'); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });
