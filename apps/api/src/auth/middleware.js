export function requireAuth(tokens) {
  return (req, res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const user = scheme === 'Bearer' ? tokens.verify(token) : null;
    if (!user) return res.status(401).json({ error: 'sign in required' });
    req.user = user;
    next();
  };
}

/** Use after requireAuth. */
export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: `only ${role}s can do this` });
    next();
  };
}
