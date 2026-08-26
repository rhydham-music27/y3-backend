import 'dotenv/config';
import mongoose from 'mongoose';
import ClassSession from '../models/ClassSession';

const TEST_DB_URI =
  process.env.TEST_MONGODB_URI ||
  (process.env.MONGODB_URI || '').replace(/\/[^/?]+(\?|$)/, '/timetable-test-db$1');

(async () => {
  await mongoose.connect(TEST_DB_URI);
  const classId = process.env.CLASS_ID || '6a8ec1b1870bd1c64f3a417c';
  const cycleNumber = Number(process.env.CYCLE || 1);
  const sessions = await ClassSession.find({ finalClass: classId, cycleNumber })
    .sort({ sessionDate: 1 })
    .select('sessionNumber sessionDate status');
  sessions.forEach((s: any) => console.log(s.sessionNumber, s.sessionDate.toISOString().split('T')[0], s.status));
  const last = sessions[sessions.length - 1];
  console.log('\nLast session date of cycle', cycleNumber, ':', last ? last.sessionDate.toISOString().split('T')[0] : 'none');
  process.exit(0);
})();
