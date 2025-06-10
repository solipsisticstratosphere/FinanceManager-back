export const mapMonoCategory = (mcc, type) => {
  if (type === 'income') {
    return 'Інше';
  } else {
    switch (true) {
      case [5411, 5422, 5441, 5451, 5462, 5499].includes(mcc):
        return 'Продукти';

      case [4111, 4121, 4131, 4784, 5541, 5542, 7523].includes(mcc):
        return 'Транспорт';

      case [5813, 5814, 7832, 7922, 7991, 7994, 7995, 7996, 7998, 7999].includes(mcc):
        return 'Розваги';

      case [4900, 4911, 4814].includes(mcc):
        return 'Комунальні платежі';

      default:
        return 'Інше';
    }
  }
};
