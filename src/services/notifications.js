export function notificationSupport() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotificationPermission() {
  if (!notificationSupport()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

export function sendNotification(title, options = {}) {
  if (!notificationSupport() || Notification.permission !== "granted") return false;
  new Notification(title, options);
  return true;
}
