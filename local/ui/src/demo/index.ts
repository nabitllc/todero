/*
  Demo mode entry. Called from main.tsx before the app renders when the build
  was made with VITE_TODERO_DEMO=1. Starts the fetch interceptor and swaps the
  live-updates socket. Nothing else in the app knows it is a demo.
*/
import { installDemoSocket } from "./socket";

export const isDemo = import.meta.env.VITE_TODERO_DEMO === "1";

export async function startDemo(): Promise<void> {
  if (!isDemo) return;
  installDemoSocket();
  const { setupWorker } = await import("msw/browser");
  const { handlers } = await import("./handlers");
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: "bypass",
    quiet: true,
  });
}
