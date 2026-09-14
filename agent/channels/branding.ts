import { defineChannel, GET } from 'eve/channels';
import { geistSans, geistMono } from '../../ui/geist-fonts';
const font = (data: string) => new Response(new Uint8Array(Buffer.from(data, 'base64')), { headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
export default defineChannel({ routes: [
  GET('/fonts/geist-sans-1.7.2.woff2', async () => font(geistSans)),
  GET('/fonts/geist-mono-1.7.2.woff2', async () => font(geistMono)),
] });
