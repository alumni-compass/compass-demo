/** The standalone preview has no server session. */
export async function getToken() {
  return null;
}

export async function isAuthenticated() {
  return false;
}
