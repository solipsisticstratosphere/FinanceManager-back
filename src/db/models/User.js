import { Schema, model } from 'mongoose';
import { emailRegexp } from '../../constants/user.js';

const userSchema = new Schema(
  {
    avatar_url: {
      type: String,
    },
    name: {
      type: String,
      default: '',
    },
    email: {
      type: String,
      match: emailRegexp,
      unique: true,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      enum: ['UAH', 'USD', 'EUR'],
      default: 'UAH',
    },
    balance: {
      type: Number,
      default: 0,
    },
    lastBalanceUpdate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const UserCollection = model('user', userSchema);
export default UserCollection;
