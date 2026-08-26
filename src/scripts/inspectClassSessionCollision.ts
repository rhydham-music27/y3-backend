/**
 * Read-only inspection of a ClassSession collision for a specific class.
 * Usage: CLASS_ID=<id> npx ts-node -r dotenv/config src/scripts/inspectClassSessionCollision.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import ClassSession from '../models/ClassSession';
import FinalClass from '../models/FinalClass';

(async () => {
  const classId = process.env.CLASS_ID;
  if (!classId) throw new Error('Set CLASS_ID');
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log(`Connected to: ${mongoose.connection.name}\n`);

  const cls: any = await FinalClass.findById(classId)
    .select('className studentName status cycleStartPending currentCycleNumber classesPerMonth schedule');
  console.log('FinalClass:', JSON.stringify(cls, null, 2));

  const sessions = await ClassSession.find({ finalClass: classId })
    .sort({ sessionDate: 1 })
    .select('sessionNumber sessionDate cycleNumber cycleMonth cycleYear status createdAt');
  console.log(`\n${sessions.length} ClassSession doc(s):`);
  sessions.forEach((s: any) =>
    console.log(
      ` - #${s.sessionNumber} cycle=${s.cycleNumber} date=${s.sessionDate.toISOString().split('T')[0]} status=${s.status} createdAt=${s.createdAt.toISOString()}`
    )
  );

  process.exit(0);
})();
