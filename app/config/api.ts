// Where the app sends its API calls.
//
// In dev (Expo running on a simulator on your Mac), we hit the local
// Worker you start with `wrangler dev` in the server folder.
// In a real build, we hit the deployed Cloudflare Worker.
//
// If you test on a real phone with Expo Go, "localhost" won't reach
// your Mac. Either replace LOCAL_API with your Mac's LAN IP, or set
// EXPO_PUBLIC_API_BASE_URL to override.

const PROD_API = 'https://loop-db.longhorn-developers.workers.dev';
const LOCAL_API = 'http://localhost:8787';

const override = process.env.EXPO_PUBLIC_API_BASE_URL;

export const API_BASE_URL =
  override ?? (__DEV__ ? LOCAL_API : PROD_API);
