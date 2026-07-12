import bcrypt from 'bcryptjs';

const DEFAULT_SALT_ROUNDS = 12;
const MIN_SALT_ROUNDS = 10;
const MAX_SALT_ROUNDS = 14;

const bcryptPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const resolveSaltRounds = (): number => {
  const configuredRounds = Number(process.env.PASSWORD_HASH_ROUNDS);

  if (!Number.isInteger(configuredRounds)) {
    return DEFAULT_SALT_ROUNDS;
  }

  return Math.min(Math.max(configuredRounds, MIN_SALT_ROUNDS), MAX_SALT_ROUNDS);
};

export const isPasswordHash = (value: unknown): value is string => {
  return typeof value === 'string' && bcryptPattern.test(value);
};

export const hashPassword = async (plainPassword: string): Promise<string> => {
  return bcrypt.hash(plainPassword, resolveSaltRounds());
};

export const verifyPassword = async (
  plainPassword: string,
  storedPassword: unknown
): Promise<boolean> => {
  const storedValue = String(storedPassword ?? '');

  if (!storedValue) {
    return false;
  }

  if (!isPasswordHash(storedValue)) {
    return storedValue === plainPassword;
  }

  return bcrypt.compare(plainPassword, storedValue);
};
