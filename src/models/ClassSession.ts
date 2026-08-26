import mongoose, { Schema, Model } from 'mongoose';
import { softDeletePlugin, SoftDeleteDocument } from '../utils/softDelete.plugin';

export type CLASS_SESSION_STATUS = 'PLANNED' | 'COMPLETED' | 'CANCELLED';

export interface IClassSessionDocument extends SoftDeleteDocument {
  _id: mongoose.Types.ObjectId;
  finalClass?: mongoose.Types.ObjectId;
  groupClass?: mongoose.Types.ObjectId;
  tutor: mongoose.Types.ObjectId;
  coordinator?: mongoose.Types.ObjectId;
  sessionDate: Date;
  timeSlot: string;
  cycleMonth: number;
  cycleYear: number;
  cycleNumber?: number;
  sessionNumber: number;
  status: CLASS_SESSION_STATUS;
  createdAt: Date;
  updatedAt: Date;
}

const ClassSessionSchema: Schema<IClassSessionDocument> = new Schema<IClassSessionDocument>(
  {
    finalClass: { type: Schema.Types.ObjectId, ref: 'FinalClass', index: true },
    groupClass: { type: Schema.Types.ObjectId, ref: 'Groupleads', index: true },
    tutor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    coordinator: { type: Schema.Types.ObjectId, ref: 'User' },
    sessionDate: { type: Date, required: true, index: true },
    timeSlot: { type: String, required: true },

    cycleMonth: { type: Number, required: true, min: 1, max: 12, index: true },
    cycleYear: { type: Number, required: true, min: 2000, index: true },
    cycleNumber: { type: Number, min: 1, index: true },

    sessionNumber: { type: Number, required: true, min: 1 },

    status: { type: String, enum: ['PLANNED', 'COMPLETED', 'CANCELLED'], default: 'PLANNED' },
  },
  { timestamps: true }
);

// Ensure either finalClass or groupClass is present
ClassSessionSchema.pre('validate', function (next) {
  if (!this.finalClass && !this.groupClass) {
    return next(new Error('At least one of finalClass or groupClass is required'));
  }
  next();
});

// Indexes
// NOTE: cycleNumber must be part of this key — sessionNumber resets to 1 each
// cycle, so without it, two different cycles landing in the same calendar
// month (common; cycles don't align to month boundaries) collide on
// (finalClass, cycleYear, cycleMonth, sessionNumber) even though they're
// unrelated sessions.
ClassSessionSchema.index({ finalClass: 1, cycleNumber: 1, cycleYear: 1, cycleMonth: 1, sessionNumber: 1 }, { unique: true, sparse: true });
ClassSessionSchema.index({ finalClass: 1, cycleNumber: 1, sessionNumber: 1 }, { unique: true, sparse: true });
ClassSessionSchema.index({ finalClass: 1, sessionDate: 1 }, { unique: true, sparse: true });

ClassSessionSchema.plugin(softDeletePlugin);

const ClassSession: Model<IClassSessionDocument> =
  mongoose.models.ClassSession || mongoose.model<IClassSessionDocument>('ClassSession', ClassSessionSchema);

export default ClassSession;
