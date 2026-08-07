// Augments express-session's (otherwise empty) SessionData interface with the two
// fields this app actually stores in a session — declaration merging is the standard
// way to type a library's extension point like this.
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
  }
}
