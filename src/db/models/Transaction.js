import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    description: String,
    date: {
      type: Date,
      default: Date.now,
    },
    monoId: {
      type: String,
      index: true,
      sparse: true,
    },
    source: {
      type: String,
      enum: ['manual', 'monobank'],
      default: 'manual',
    },
  },
  { versionKey: false, timestamps: true },
);

export const TransactionCollection = mongoose.model('Transaction', transactionSchema);
