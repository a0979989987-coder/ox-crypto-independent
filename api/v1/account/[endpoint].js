import { createAccountHandler } from '../../../server/account/handler.js';
import bitgetHandler from '../../../server/integrations/bitget/http-handler.js';
const accountHandler = createAccountHandler();
export default function handler(req, res) {
  // Preserve the existing Bitget URL while staying within Vercel's function limit.
  return req.query?.endpoint === 'bitget-status' ? bitgetHandler(req, res) : accountHandler(req, res);
}
