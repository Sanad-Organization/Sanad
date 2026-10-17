// Database error codes → messages a fund member can act on. Raw messages are
// never shown or logged (they can echo input).
export interface DbError {
  code?: string | undefined;
}

export function userMessage(err: DbError | null | undefined): string {
  switch (err?.code) {
    case '42501':
      return "You don't have permission to do that.";
    case '23514':
    case '22023':
    case '22001':
      return 'Some details are not valid. Check the highlighted fields.';
    case '23505':
      return 'That already exists.';
    case 'PGRST301':
    case 'PGRST303':
      return 'Your session has ended. Sign in again.';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}
