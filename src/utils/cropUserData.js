export const cropUserData = (user) => {
  const { name, email, avatr_url } = user;
  return { name, email, avatr_url };
};
