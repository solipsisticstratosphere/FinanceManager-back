export const cropUserData = (user) => {
  const { name, email, avatr_url, currency } = user;
  return { name, email, avatr_url, currency };
};
