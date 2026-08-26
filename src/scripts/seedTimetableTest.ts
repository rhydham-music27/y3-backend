/**
 * seedTimetableTest.ts
 *
 * Throwaway seed for manually testing the "choose first date -> generate
 * timetable" flow (CycleStartDialog -> POST /api/final-classes/:id/start-cycle
 * -> generateSessionsFromStartDate). Creates ONE tutor + ONE active,
 * cycle-start-pending class on an isolated test database (never main-db).
 *
 * Usage:
 *   npx ts-node -r dotenv/config src/scripts/seedTimetableTest.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User';
import Tutor from '../models/Tutor';
import Coordinator from '../models/Coordinator';
import ClassLead from '../models/ClassLead';
import FinalClass from '../models/FinalClass';
import Option from '../models/Option';
import { USER_ROLES, BOARD_TYPE, TEACHING_MODE, VERIFICATION_STATUS } from '../config/constants';

const TEST_DB_URI =
  process.env.TEST_MONGODB_URI ||
  (process.env.MONGODB_URI || '').replace(/\/[^/?]+(\?|$)/, '/timetable-test-db$1');

async function connect() {
  if (!TEST_DB_URI) throw new Error('Could not derive TEST_MONGODB_URI from MONGODB_URI');
  await mongoose.connect(TEST_DB_URI);
  console.log(`✓ Connected to TEST db: ${mongoose.connection.name} (${mongoose.connection.host})`);
}

async function run() {
  const stamp = Date.now();
  const tutorEmail = `test.tutor.${stamp}@yourshikshak.test`;
  const coordEmail = `test.coordinator.${stamp}@yourshikshak.test`;
  const managerEmail = `test.manager.${stamp}@yourshikshak.test`;
  const password = 'Password@123';

  const managerUser = await User.create({
    name: 'TEST Manager',
    email: managerEmail,
    password,
    role: USER_ROLES.MANAGER,
    phone: '+919999900001',
    isActive: true,
  } as any);

  const coordUser = await User.create({
    name: 'TEST Coordinator',
    email: coordEmail,
    password,
    role: USER_ROLES.COORDINATOR,
    phone: '+919999900002',
    isActive: true,
  } as any);
  await Coordinator.create({
    user: coordUser._id,
    assignedClasses: [],
    maxClassCapacity: 20,
    activeClassesCount: 0,
    totalClassesHandled: 0,
    isActive: true,
    joiningDate: new Date(),
  } as any);

  const tutorUser = await User.create({
    name: 'TEST Tutor',
    email: tutorEmail,
    password,
    role: USER_ROLES.TUTOR,
    phone: '+919999900003',
    isActive: true,
  } as any);
  await Tutor.create({
    user: tutorUser._id,
    experienceHours: 0,
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    isAvailable: true,
  } as any);

  const subjectOption = await Option.findOneAndUpdate(
    { type: 'SUBJECT', value: 'MATH' },
    { $setOnInsert: { type: 'SUBJECT', label: 'Math', value: 'MATH', isActive: true } },
    { upsert: true, new: true }
  );

  const lead = await ClassLead.create({
    leadId: `TEST-${stamp}`,
    studentType: 'SINGLE',
    studentName: 'TEST Student',
    studentGender: 'M',
    grade: '9',
    subject: [subjectOption._id],
    board: (Object.values(BOARD_TYPE) as string[])[0],
    mode: (Object.values(TEACHING_MODE) as string[])[0],
    location: 'Test City',
    timing: 'Mon-Wed-Fri 5PM',
    weekdays: ['Monday', 'Wednesday', 'Friday'],
    status: 'CONVERTED',
    createdBy: managerUser._id,
    notes: 'Seeded for timetable-generation testing',
  } as any);

  const finalClass = await FinalClass.create({
    className: `TEST Timetable Class ${stamp}`,
    classLead: lead._id,
    tutor: tutorUser._id,
    coordinator: coordUser._id,
    startDate: new Date(),
    status: 'ACTIVE',
    schedule: { daysOfWeek: ['Monday', 'Wednesday', 'Friday'], timeSlot: '17:00-18:00' },
    classesPerMonth: 12,
    totalSessions: 12,
    completedSessions: 0,
    studentName: 'TEST Student',
    subject: [subjectOption._id],
    grade: '9',
    board: (Object.values(BOARD_TYPE) as string[])[0],
    mode: (Object.values(TEACHING_MODE) as string[])[0],
    location: 'Test City',
    convertedBy: managerUser._id,
    convertedAt: new Date(),
    notes: 'Seeded for timetable-generation testing',
    cycleStartPending: true,
    currentCycleNumber: 1,
  } as any);

  console.log('\n─────────────────────────────────────────────');
  console.log('Seeded test data on:', TEST_DB_URI.replace(/:[^:@]+@/, ':***@'));
  console.log('─────────────────────────────────────────────');
  console.log(`Tutor login   -> email: ${tutorEmail}  password: ${password}`);
  console.log(`Class         -> ${finalClass.className} (id: ${finalClass._id})`);
  console.log(`Schedule      -> Mon/Wed/Fri @ 17:00-18:00, 12 sessions/cycle`);
  console.log(`cycleStartPending: true (will trigger CycleStartDialog on tutor login)`);
  console.log('─────────────────────────────────────────────');
  console.log('\nTo point the backend dev server at this SAME test db, run it with:');
  console.log(`  MONGODB_URI="${TEST_DB_URI}" npm run dev`);
  console.log('\nThen log in as the tutor above in the frontend, pick a first-class date in');
  console.log('the dialog, and verify GET /api/class-sessions (or the tutor timetable page)');
  console.log('shows 12 sessions on Mon/Wed/Fri starting from (or after) the chosen date.');
}

connect()
  .then(run)
  .then(() => { console.log('\nDone.'); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });
