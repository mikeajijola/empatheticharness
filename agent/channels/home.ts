import { defineChannel, GET } from 'eve/channels';

export default defineChannel({ routes: [
  GET('/', async request => Response.redirect(new URL('/chat', request.url), 307)),
] });
