import { validationResult } from 'express-validator';
import asyncHandler from '../utils/asyncHandler';
import { successResponse, paginatedResponse } from '../utils/responseFormatter';
import ErrorResponse from '../utils/errorResponse';
import { AuthRequest } from '../types';
import FinalClass from '../models/FinalClass';
import Coordinator from '../models/Coordinator';
import User from '../models/User';
import { FINAL_CLASS_STATUS, COORDINATOR_ACTION_TYPE, USER_ROLES } from '../config/constants';
import { createNotificationWithPreferences } from '../services/notificationService';
import { sendEmail } from '../utils/emailService';
import {
  convertLeadToFinalClass,
  getAllFinalClasses,
  getFinalClassById,
  updateFinalClass,
  updateFinalClassStatus,
  updateSessionProgress,
  getClassesByCoordinator,
  getClassesByTutor,
  getClassesByParent,
  changeTutor,
  handleTutorLeaving,
  renewFinalClassForCoordinator,
} from '../services/finalClassService';
import { repostClassAsLead } from '../services/leadService';
import { logCoordinatorActivity } from '../services/coordinatorService';
// FINAL_CLASS_STATUS already imported above

export const convertToFinalClass = asyncHandler(async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ErrorResponse(errors.array()[0].msg, 400);
  }
  const classLeadId = req.params.leadId as string;
  const { coordinatorUserId, startDate, schedule, totalSessions, notes } = req.body;
  const convertedBy = req.user!.id;

  const result = await convertLeadToFinalClass({
    classLeadId,
    coordinatorUserId,
    startDate,
    schedule,
    totalSessions,
    notes,
    convertedBy,
  });

  return res.status(201).json(successResponse(result, 'Class lead converted to final class successfully'));
});

export const getFinalClasses = asyncHandler(async (req: AuthRequest, res) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '10', 10);
  const status = (req.query.status as string) || undefined;
  const coordinatorId = (req.query.coordinatorId as string) || undefined;
  const tutorId = (req.query.tutorId as string) || undefined;
  const sortBy = (req.query.sortBy as string) || undefined;
  const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || undefined;
  const search = (req.query.search as string) || undefined;
  const noCoordinator = req.query.noCoordinator === 'true';

  let convertedBy: string | undefined = undefined;
  if (req.user && req.user.role === USER_ROLES.MANAGER && !tutorId && !coordinatorId && !search) {
    convertedBy = req.user.id;
  }

  const { classes, total } = await getAllFinalClasses({
    page,
    limit,
    status,
    coordinatorId,
    tutorId,
    sortBy,
    sortOrder,
    search,
    convertedBy,
    noCoordinator,
  });

  return res.json(paginatedResponse(classes, page, limit, total));
});

export const getFinalClass = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const cls = await getFinalClassById(classId);
  return res.json(successResponse(cls));
});

export const updateFinalClassDetails = asyncHandler(async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ErrorResponse(errors.array()[0].msg, 400);
  }
  const classId = req.params.id as string;
  const updateData = req.body;
  const cls = await updateFinalClass(classId, updateData);

  // Log coordinator-initiated updates to final classes
  if (req.user?.role === USER_ROLES.COORDINATOR) {
    try {
      await logCoordinatorActivity(
        req.user.id,
        COORDINATOR_ACTION_TYPE.UPDATE_FINAL_CLASS,
        'Updated final class details',
        { entityType: 'FinalClass', entityId: classId, entityName: (cls as any)?.className },
        { updateData }
      );
    } catch { }
  }

  return res.json(successResponse(cls, 'Final class updated successfully'));
});

export const updateClassStatus = asyncHandler(async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ErrorResponse(errors.array()[0].msg, 400);
  }
  const classId = req.params.id as string;
  const { status, actualEndDate } = req.body;

  if (req.user?.role === USER_ROLES.COORDINATOR) {
    const clsDoc = await FinalClass.findById(classId).select('coordinator');
    if (!clsDoc) throw new ErrorResponse('Final class not found', 404);
    if (!clsDoc.coordinator || String(clsDoc.coordinator) !== String(req.user.id)) {
      throw new ErrorResponse('Not authorized to update this class', 403);
    }
  }

  const cls = await updateFinalClassStatus(classId, status, actualEndDate);
  return res.json(successResponse(cls, 'Class status updated successfully'));
});

export const updateProgress = asyncHandler(async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ErrorResponse(errors.array()[0].msg, 400);
  }
  const classId = req.params.id as string;
  const { completedSessions } = req.body;
  const cls = await updateSessionProgress(classId, completedSessions);
  return res.json(successResponse(cls, 'Session progress updated successfully'));
});

export const renewFinalClassController = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const coordinatorUserId = req.user!.id;
  const attendanceSheetId = (req.body as any)?.attendanceSheetId;

  const monthlyFeeRaw = (req.body as any)?.monthlyFee;
  const sessionsPerMonthRaw = (req.body as any)?.sessionsPerMonth;

  const plan =
    typeof monthlyFeeRaw !== 'undefined' && typeof sessionsPerMonthRaw !== 'undefined'
      ? {
        monthlyFee: Number(monthlyFeeRaw),
        sessionsPerMonth: Number(sessionsPerMonthRaw),
      }
      : undefined;

  const result = await renewFinalClassForCoordinator({ classId, coordinatorUserId, attendanceSheetId, plan });

  return res.status(200).json(
    successResponse(
      result,
      'Class renewed successfully'
    )
  );
});

export const createOneTimeRescheduleController = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const tutorUserId = req.user!.id;
  const { fromDate, toDate, timeSlot } = req.body as { fromDate?: string; toDate?: string; timeSlot?: string };

  if (!fromDate || !timeSlot) {
    throw new ErrorResponse('fromDate and timeSlot are required', 400);
  }

  const cls = await FinalClass.findById(classId);
  if (!cls) throw new ErrorResponse('Final class not found', 404);
  if (String(cls.tutor) !== String(tutorUserId)) {
    throw new ErrorResponse('You are not the assigned tutor for this class', 403);
  }
  if (cls.status !== FINAL_CLASS_STATUS.ACTIVE) {
    throw new ErrorResponse('Only active classes can be rescheduled', 400);
  }

  let allowTutorReschedule = true;
  try {
    const coord = await Coordinator.findOne({ user: cls.coordinator as any });
    if (coord && (coord as any).settings?.attendanceControls) {
      const flag = (coord as any).settings.attendanceControls.allowTutorReschedule;
      if (typeof flag === 'boolean') allowTutorReschedule = flag;
    }
  } catch { }

  if (!allowTutorReschedule) {
    throw new ErrorResponse('Rescheduling is disabled by your coordinator', 403);
  }

  const normalize = (d: Date) => {
    const nd = new Date(d);
    nd.setHours(0, 0, 0, 0);
    return nd.getTime();
  };

  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDate || fromDate);
  to.setHours(0, 0, 0, 0);

  const list: any[] = ((cls as any).oneTimeReschedules || [])
    .map((r: any) => ({ ...r }))
    .filter((r: any) => r && r.fromDate && r.toDate && r.timeSlot);
  // Replace any existing reschedule for the same original date
  const filtered = list.filter((r) => normalize(new Date(r.fromDate)) !== normalize(from));
  filtered.push({ fromDate: from, toDate: to, timeSlot });
  (cls as any).oneTimeReschedules = filtered;

  await cls.save();
  return res.status(200).json(successResponse(cls, 'One-time reschedule saved'));
});

export const parentRequestRescheduleController = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const parentUserId = req.user!.id;

  const cls = await FinalClass.findById(classId);
  if (!cls) throw new ErrorResponse('Final class not found', 404);

  if (!cls.parent || String(cls.parent) !== String(parentUserId)) {
    throw new ErrorResponse('You are not authorized to reschedule this class', 403);
  }

  const tutorUserId = String(cls.tutor);
  const studentName = (cls as any).studentName || 'your child';

  // Create a GENERAL notification to the tutor about the parent reschedule request
  await createNotificationWithPreferences({
    recipient: tutorUserId,
    type: 'GENERAL',
    title: 'Parent requested to reschedule a class',
    message: `The parent has requested to reschedule the class for ${studentName}. Please contact the parent to coordinate a new time.`,
  });

  // Best-effort email notification to tutor
  try {
    const tutorUser = await User.findById(tutorUserId).select('email name');
    if (tutorUser && tutorUser.email) {
      const tutorName = (tutorUser as any).name || 'Tutor';
      await sendEmail(
        tutorUser.email,
        '📅 Class Reschedule Request - Your Shikshak',
        `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reschedule Request</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
            .container { background-color: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); margin-top: 20px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #f59e0b; padding-bottom: 20px; }
            .logo { font-size: 28px; font-weight: bold; color: #f59e0b; margin-bottom: 10px; }
            .alert-box { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 5px solid #f59e0b; }
            .alert-title { color: #92400e; font-weight: bold; font-size: 16px; margin-bottom: 10px; }
            .info-card { background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb; }
            .student-name { color: #d97706; font-weight: bold; font-size: 18px; }
            .action-steps { background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
            .action-steps h3 { color: #92400e; margin-top: 0; font-size: 15px; }
            .action-steps ol { margin: 10px 0; padding-left: 20px; color: #78350f; }
            .action-steps li { margin: 10px 0; }
            .cta-button { display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 14px 35px; border-radius: 25px; text-decoration: none; font-weight: bold; text-align: center; margin: 20px auto; display: block; width: fit-content; }
            .cta-button:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(245, 158, 11, 0.4); }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 13px; }
            .footer a { color: #f59e0b; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">📅 Your Shikshak</div>
            </div>

            <h2 style="color: #333; text-align: center; margin-bottom: 25px;">Class Reschedule Request</h2>

            <p>Hello ${tutorName},</p>

            <div class="alert-box">
              <div class="alert-title">⏰ Reschedule Request Received</div>
              <p style="margin: 0;">The parent has requested to reschedule the class for their child.</p>
            </div>

            <div class="info-card">
              <p><strong>Student:</strong></p>
              <p class="student-name">${studentName}</p>
            </div>

            <div class="action-steps">
              <h3>✨ Next Steps:</h3>
              <ol>
                <li>Review the reschedule request in your dashboard</li>
                <li>Check your availability for alternative time slots</li>
                <li>Contact the parent to propose new time options</li>
                <li>Confirm the new class schedule</li>
                <li>Update the attendance records accordingly</li>
              </ol>
            </div>

            <p style="text-align: center;">
              <a href="https://yourshikshak.in/dashboard/classes" class="cta-button">View Request in Dashboard →</a>
            </p>

            <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6;">
              <strong style="color: #1e40af;">💡 Tip:</strong> <span style="color: #1e3a8a;">Respond to reschedule requests promptly to maintain good parent relationships and class continuity.</span>
            </div>

            <p style="text-align: center; color: #666; margin-top: 25px;">Need assistance? <a href="mailto:support@yourshikshak.in" style="color: #f59e0b; text-decoration: none; font-weight: bold;">Contact Support</a></p>

            <div class="footer">
              <p style="margin: 0;">Best regards,<br><strong>Your Shikshak Class Management Team</strong></p>
              <p style="margin-top: 10px; font-size: 12px; color: #999;"><small>This is an automated message. Please do not reply to this email.</small></p>
            </div>
          </div>
        </body>
        </html>`
      );
    }
  } catch (e) {
    // Email failures should not block the parent request
    // eslint-disable-next-line no-console
    console.error('[parentRequestRescheduleController] Failed to send tutor email', e);
  }

  return res.status(200).json(successResponse(null, 'Reschedule request sent to tutor'));
});

export const getCoordinatorClasses = asyncHandler(async (req: AuthRequest, res) => {
  const coordinatorUserId = req.params.coordinatorId as string;
  const status = (req.query.status as string) || undefined;
  const classes = await getClassesByCoordinator(coordinatorUserId, status);
  return res.json(successResponse(classes));
});

export const getTutorClasses = asyncHandler(async (req: AuthRequest, res) => {
  const tutorUserId = req.params.tutorId as string;
  const status = (req.query.status as string) || undefined;
  const classes = await getClassesByTutor(tutorUserId, status);
  return res.json(successResponse(classes));
});

export const getMyClassesController = asyncHandler(async (req: AuthRequest, res) => {
  const status = (req.query.status as string) || FINAL_CLASS_STATUS.ACTIVE;
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '10', 10);

  const classes = await getClassesByTutor(req.user!.id, status);

  const total = classes.length;
  const start = (page - 1) * limit;
  const end = page * limit;
  const paginatedClasses = classes.slice(start, end);

  return res.status(200).json(paginatedResponse(paginatedClasses, page, limit, total));
});

export const getParentClassesController = asyncHandler(async (req: AuthRequest, res) => {
  const status = (req.query.status as string) || FINAL_CLASS_STATUS.ACTIVE;
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '10', 10);

  const classes = await getClassesByParent(req.user!.id, status);

  const total = classes.length;
  const start = (page - 1) * limit;
  const end = page * limit;
  const paginatedClasses = classes.slice(start, end);

  return res.status(200).json(paginatedResponse(paginatedClasses, page, limit, total));
});

export const changeTutorController = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const { newTutorUserId, reason } = req.body;
  const changedBy = req.user!.id;

  if (req.user?.role === USER_ROLES.COORDINATOR) {
    const clsDoc = await FinalClass.findById(classId).select('coordinator');
    if (!clsDoc) throw new ErrorResponse('Final class not found', 404);
    if (!clsDoc.coordinator || String(clsDoc.coordinator) !== String(req.user.id)) {
      throw new ErrorResponse('Not authorized to update this class', 403);
    }
  }

  const result = await changeTutor({
    classId,
    newTutorUserId,
    reason,
    changedBy,
  });

  return res.status(200).json(successResponse(result, 'Tutor changed successfully'));
});

export const tutorLeavingController = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const { reason } = req.body;
  const changedBy = req.user!.id;

  const result = await handleTutorLeaving({
    classId,
    reason,
    changedBy,
  });

  return res.status(200).json(successResponse(result, 'Tutor departure recorded successfully'));
});

export const repostLeadController = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const createdBy = req.user!.id;

  const result = await repostClassAsLead({
    classId,
    createdBy,
  });

  return res.status(201).json(successResponse(result, 'Class reposted as lead successfully'));
});

export const getPendingCycleStartsController = asyncHandler(async (req: AuthRequest, res) => {
  const classes = await FinalClass.find({
    tutor: req.user!.id,
    status: FINAL_CLASS_STATUS.ACTIVE,
    cycleStartPending: true,
  }).select('_id className studentName classesPerMonth currentCycleNumber schedule');

  return res.json(successResponse(classes));
});

export const setCycleStartController = asyncHandler(async (req: AuthRequest, res) => {
  const classId = req.params.id as string;
  const { startDate } = req.body as { startDate?: string };
  if (!startDate) throw new ErrorResponse('startDate is required', 400);

  const cls: any = await FinalClass.findOne({
    _id: classId,
    tutor: req.user!.id,
    status: FINAL_CLASS_STATUS.ACTIVE,
    cycleStartPending: true,
  });
  if (!cls) throw new ErrorResponse('Class not found or no pending cycle start', 404);

  const cycleNumber = cls.currentCycleNumber || 1;

  // Remove stale PLANNED sessions left behind by prior cycles: legacy sessions
  // auto-generated before the tutor-chosen-start-date flow existed (no
  // cycleNumber at all), and PLANNED sessions from earlier cycles that never
  // got flagged COMPLETED (e.g. attendance was logged on a different date
  // than the precomputed schedule). Both are guaranteed stale here because
  // reaching this handler means the class's *current* cycle already ended
  // (cycleStartPending was true), so nothing before `cycleNumber` is still a
  // real future session — and left in place they collide with the new
  // cycle's dates on the (finalClass, sessionDate) unique index.
  const ClassSession = (await import('../models/ClassSession')).default;
  await ClassSession.deleteMany({
    finalClass: cls._id,
    status: 'PLANNED',
    $or: [{ cycleNumber: { $exists: false } }, { cycleNumber: { $lt: cycleNumber } }],
  });

  const { generateSessionsFromStartDate } = await import('../services/classSessionService');
  const sessions = await generateSessionsFromStartDate({
    classId,
    startDate: new Date(startDate),
    cycleNumber,
  });

  // Create AttendanceSheet for this cycle
  const AttendanceSheet = (await import('../models/AttendanceSheet')).default;
  const startDateObj = new Date(startDate);
  await AttendanceSheet.findOneAndUpdate(
    { finalClass: cls._id, cycleNumber },
    {
      $setOnInsert: {
        finalClass: cls._id,
        sheetType: 'SINGLE',
        coordinator: cls.coordinator,
        month: startDateObj.getMonth() + 1,
        year: startDateObj.getFullYear(),
        cycleNumber,
        periodLabel: `Cycle ${cycleNumber}`,
        records: [],
        status: 'PENDING',
        createdBy: req.user!.id,
        totalSessionsPlanned: cls.classesPerMonth || 0,
      },
    },
    { upsert: true, new: true },
  );

  await FinalClass.findByIdAndUpdate(classId, { cycleStartPending: false, completedSessions: 0 });

  return res.json(successResponse({ sessions, cycleNumber }, `Cycle ${cycleNumber} timetable generated`));
});

export default {
  convertToFinalClass,
  getFinalClasses,
  getFinalClass,
  updateFinalClassDetails,
  updateClassStatus,
  updateProgress,
  getCoordinatorClasses,
  getTutorClasses,
  getMyClassesController,
  getParentClassesController,
  createOneTimeRescheduleController,
  parentRequestRescheduleController,
  changeTutorController,
  tutorLeavingController,
  repostLeadController,
};
