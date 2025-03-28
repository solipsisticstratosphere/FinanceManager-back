import { UserCollection } from '../db/models/User.js';
import UserService from '../services/UserService.js';

export const updateUserAverages = async (req, res) => {
  try {
    const users = await UserCollection.find();
    let updated = 0;

    for (const user of users) {
      try {
        await UserService.updateUserAverages(user._id);
        updated++;
      } catch (error) {
        console.error(`Error updating averages for user ${user._id}:`, error);
      }
    }

    return res.status(200).json({
      status: 'success',
      message: `Updated average income/expense for ${updated} of ${users.length} users`,
    });
  } catch (error) {
    console.error('Error updating user averages:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to update user averages',
      error: error.message,
    });
  }
};
