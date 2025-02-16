// models/MonobankToken.js
import mongoose from 'mongoose';
import crypto from 'crypto';

const monobankTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Храним токен в зашифрованном виде
    encryptedToken: {
      type: String,
      required: true,
    },
    // Уникальный вектор инициализации для каждого токена
    iv: {
      type: String,
      required: true,
    },
    // Дата последнего обновления транзакций
    lastSync: {
      type: Date,
      default: null,
    },
    // Хранение информации о счетах пользователя
    accounts: [
      {
        id: String,
        name: String,
        balance: Number,
        currencyCode: Number,
      },
    ],
  },
  { timestamps: true },
);

// Метод для шифрования токена перед сохранением
monobankTokenSchema.statics.encryptToken = function (token) {
  // Используем переменную окружения для ключа шифрования
  const key = crypto.scryptSync(process.env.ENCRYPTION_SECRET, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    encryptedToken: encrypted,
    iv: iv.toString('hex'),
  };
};

// Метод для расшифровки токена
monobankTokenSchema.statics.decryptToken = function (encryptedToken, iv) {
  const key = crypto.scryptSync(process.env.ENCRYPTION_SECRET, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));

  let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

const MonobankToken = mongoose.model('MonobankToken', monobankTokenSchema);

export default MonobankToken;
