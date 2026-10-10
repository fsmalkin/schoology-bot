export function getSchoologyBrowserLaunchOptions(browserChannel = "") {
  const channel = String(browserChannel ?? "").trim();
  return channel ? { headless: true, channel } : { headless: true };
}
