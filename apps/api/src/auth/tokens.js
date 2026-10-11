import jwt from 'jsonwebtoken';

export function createTokens({ secret, expiresIn }) {
  return {
    sign(user) {
      return jwt.sign({ role: user.role, country: user.country }, secret, { subject: user.id, expiresIn });
    },
    /** Returns { id, role, country } or null if the token is missing, invalid or expired. */
    verify(token) {
      try {
        const payload = jwt.verify(token, secret);
        return { id: payload.sub, role: payload.role, country: payload.country };
      } catch {
        return null;
      }
    },
  };
}
