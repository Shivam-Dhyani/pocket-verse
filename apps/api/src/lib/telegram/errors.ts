import { AppError } from '../../middleware/errors.js';

/**
 * Maps MTProto RPC failures to honest, user-facing errors. Anything we don't
 * recognize stays a generic 502 so internals (and never session data) leak.
 */

interface RpcLikeError {
  errorMessage?: string;
  seconds?: number;
}

export function isFloodWait(error: unknown): error is RpcLikeError & { seconds: number } {
  const rpc = error as RpcLikeError;
  return rpc?.errorMessage === 'FLOOD' || typeof rpc?.seconds === 'number';
}

export function floodWaitError(seconds: number): AppError {
  return new AppError(
    429,
    'FLOOD_WAIT',
    `The storage provider asked us to slow down. Try again in about ${formatWait(seconds)}.`,
    { retryAfterSeconds: seconds },
  );
}

export function mapTelegramError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (isFloodWait(error)) {
    return floodWaitError(error.seconds);
  }

  const code = (error as RpcLikeError)?.errorMessage;
  switch (code) {
    case 'PHONE_NUMBER_INVALID':
      return new AppError(
        400,
        'PHONE_INVALID',
        'That phone number was not accepted. Use international format, e.g. +14155552671.',
      );
    case 'PHONE_NUMBER_BANNED':
      return new AppError(
        403,
        'PHONE_BANNED',
        'This phone number is not allowed to sign in to the storage provider.',
      );
    case 'PHONE_CODE_INVALID':
      return new AppError(400, 'CODE_INVALID', 'That code is not correct. Check it and try again.');
    case 'PHONE_CODE_EXPIRED':
      return new AppError(
        400,
        'CODE_EXPIRED',
        'That code has expired. Restart the connection to get a new one.',
      );
    case 'PASSWORD_HASH_INVALID':
      return new AppError(
        400,
        'PASSWORD_INVALID',
        'The two-step verification password is incorrect.',
      );
    case 'AUTH_RESTART':
    case 'PHONE_CODE_EMPTY':
      return new AppError(
        400,
        'CONNECTION_RESTART',
        'The sign-in attempt was interrupted. Restart the connection and try again.',
      );
    case 'SESSION_REVOKED':
    case 'AUTH_KEY_UNREGISTERED':
    case 'USER_DEACTIVATED':
      return new AppError(
        401,
        'SESSION_REVOKED',
        "Pocketverse's session was ended from inside Telegram. Reconnect your account to continue.",
      );
    default:
      return new AppError(
        502,
        'STORAGE_UNAVAILABLE',
        'We could not reach your storage right now. Nothing was lost — try again shortly.',
      );
  }
}

function formatWait(seconds: number): string {
  if (seconds < 90) {
    return `${seconds} seconds`;
  }
  return `${Math.ceil(seconds / 60)} minutes`;
}
