export function getSessionBasics(session) {
  const userId =
    session?.session?.userId ||
    session?.user?.id ||
    session?.user?.email ||
    null;
  const isAdmin = Boolean(session?.user?.isAdmin);
  return { userId, isAdmin };
}

