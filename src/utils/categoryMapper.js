// utils/categoryMapper.js

// Mapping of Monobank MCC (Merchant Category Codes) to our application categories
export const mapMonoCategory = (mcc, type) => {
  if (type === 'income') {
    // Default categories for income
    return 'Інше';
  } else {
    // Map expense MCC codes to our categories
    switch (true) {
      // Продукты
      case [5411, 5422, 5441, 5451, 5462, 5499].includes(mcc):
        return 'Продукти';

      // Транспорт
      case [4111, 4121, 4131, 4784, 5541, 5542, 7523].includes(mcc):
        return 'Транспорт';

      // Развлечения
      case [5813, 5814, 7832, 7922, 7991, 7994, 7995, 7996, 7998, 7999].includes(mcc):
        return 'Розваги';

      // Коммунальные платежи
      case [4900, 4911, 4814].includes(mcc):
        return 'Комунальні платежі';

      // Default category for expenses
      default:
        return 'Інше';
    }
  }
};
