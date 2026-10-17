import { createLatestNewsHandler } from '../../../server/news/latest.js';
// Public, read-only, no credentials: the newest headlines between snapshots.
export default createLatestNewsHandler();
