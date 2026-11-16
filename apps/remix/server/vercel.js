/**
 * Shiftstone: Vercel entry point (one Node function serves the whole app; Vercel serves build/client as static
 * files). Same app as main.js, minus the long-running server and static file handler.
 *
 * Note: copied into the build folder at build time, like main.js.
 */
import { handle as vercelHandle } from '@hono/node-server/vercel';
import handle from 'hono-react-router-adapter/node';

import { getLoadContext } from './hono/server/load-context.js';
import server from './hono/server/router.js';
import * as build from './index.js';

const handler = handle(build, server, { getLoadContext });

export default vercelHandle(handler);
