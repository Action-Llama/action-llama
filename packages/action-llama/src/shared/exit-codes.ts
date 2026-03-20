/**
 * Standard exit codes for agent termination
 */
export enum ExitCode {
  SUCCESS = 0,
  AUTH_FAILURE = 10,
  PERMISSION_DENIED = 11,
  RATE_LIMITED = 12,
  INVALID_CONFIG = 13,
  DEPENDENCY_ERROR = 14,
  UNRECOVERABLE_ERROR = 15,
  USER_ABORT = 16,
}

/**
 * Get a human-readable message for an exit code
 */
export function getExitCodeMessage(code: number): string {
  switch (code) {
    case ExitCode.SUCCESS:
      return 'Success';
    case ExitCode.AUTH_FAILURE:
      return 'Authentication/credentials failure';
    case ExitCode.PERMISSION_DENIED:
      return 'Permission/access denied';
    case ExitCode.RATE_LIMITED:
      return 'Rate limit exceeded';
    case ExitCode.INVALID_CONFIG:
      return 'Configuration error';
    case ExitCode.DEPENDENCY_ERROR:
      return 'Missing dependency or service error';
    case ExitCode.UNRECOVERABLE_ERROR:
      return 'Unrecoverable error';
    case ExitCode.USER_ABORT:
      return 'User-requested abort';
    default:
      return `Unknown exit code: ${code}`;
  }
}

