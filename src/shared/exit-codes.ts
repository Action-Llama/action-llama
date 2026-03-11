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

/**
 * Extract exit signal from text output
 * @param text Agent output text
 * @returns Exit code if found, undefined otherwise
 */
export function extractExitSignal(text: string): number | undefined {
  // Create a fresh regex each time to avoid global state issues  
  // This pattern allows for any characters after the colon to test malformed cases
  const EXIT_PATTERN = /\[EXIT(?::\s*([^\]]*))?\]/;
  const match = text.match(EXIT_PATTERN);
  if (!match) {
    return undefined;
  }
  
  // If no code specified, use default
  if (!match[1] || match[1].trim() === '') {
    return ExitCode.UNRECOVERABLE_ERROR;
  }
  
  // Try to parse the code
  const code = parseInt(match[1].trim(), 10);
  // Return the parsed code (could be NaN for invalid input like "abc")
  return code;
}