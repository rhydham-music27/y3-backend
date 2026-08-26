/**
 * completeCycleTest.ts
 *
 * Marks attendance (as COORDINATOR) for every planned ClassSession in a
 * cycle, then approves the resulting AttendanceSheet — exercising the full
 * "coordinator marks + approves attendance -> cycle completes -> next cycle
 * cycleStartPending flips true" path, on the isolated timetable-test-db.
 *
 * Usage:
 *   CLASS_ID=<finalClassId> npx ts-node -r dotenv/config src/scripts/completeCycleTest.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import FinalClass from '../models/FinalClass';
import ClassSession from '../models/ClassSession';
import AttendanceSheet from '../models/AttendanceSheet';
import { addDailyAttendance, approveAttendanceSheet } from '../services/attendanceSheetService';
import { USER_ROLES } from '../config/constants';

const TEST_DB_URI =
  process.env.TEST_MONGODB_URI ||
  (process.env.MONGODB_URI || '').replace(/\/[^/?]+(\?|$)/, '/timetable-test-db$1');

async function connect() {
  await mongoose.connect(TEST_DB_URI);
  console.log(`✓ Connected to TEST db: ${mongoose.connection.name}`);
}

async function run() {
  const classId = process.env.CLASS_ID;
  if (!classId) throw new Error('Set CLASS_ID env var to the finalClass _id to complete');

  const cls: any = await FinalClass.findById(classId);
  if (!cls) throw new Error(`FinalClass ${classId} not found`);
  if (!cls.coordinator) throw new Error('This class has no coordinator assigned');

  const cycleNumber = cls.currentCycleNumber || 1;
  const sessions = await ClassSession.find({ finalClass: cls._id, cycleNumber, status: 'PLANNED' })
    .sort({ sessionDate: 1 });

  console.log(`Class: ${cls.className} | Cycle ${cycleNumber} | ${sessions.length} planned session(s)`);
  if (!sessions.length) {
    console.log('No planned sessions found for this cycle — nothing to mark. Did you generate the timetable first?');
    return;
  }

  for (const session of sessions) {
    const dateStr = session.sessionDate.toISOString().split('T')[0];
    await addDailyAttendance({
      finalClassId: String(cls._id),
      sessionDate: session.sessionDate,
      topicCovered: 'Seeded test session',
      studentAttendanceStatus: 'PRESENT',
      notes: 'Marked by completeCycleTest script',
      userId: String(cls.coordinator),
      userRole: USER_ROLES.COORDINATOR,
    });
    console.log(`  ✓ attendance marked for ${dateStr}`);
  }

  const sheet = await AttendanceSheet.findOne({ finalClass: cls._id, cycleNumber }).sort({ createdAt: -1 });
  if (!sheet) throw new Error('AttendanceSheet not found after marking attendance');
  console.log(`Sheet ${sheet._id} status=${sheet.status} recordsTaken=${sheet.totalSessionsTaken}/${sheet.totalSessionsPlanned}`);

  await approveAttendanceSheet(String(sheet._id), String(cls.coordinator), false);
  console.log('✓ Sheet approved by coordinator');

  const updated: any = await FinalClass.findById(classId)
    .select('completedSessions cycleStartPending currentCycleNumber');
  console.log('\n─────────────────────────────────────────────');
  console.log('Post-approval FinalClass state:');
  console.log(`  completedSessions   : ${updated.completedSessions}`);
  console.log(`  cycleStartPending   : ${updated.cycleStartPending}`);
  console.log(`  currentCycleNumber  : ${updated.currentCycleNumber}`);
  console.log('─────────────────────────────────────────────');
}

connect()
  .then(run)
  .then(() => { console.log('\nDone.'); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });
