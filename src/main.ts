import { Application } from "./app";

// Global error handler
window.onerror = (event: Event | string) => {
  const errorHtml = String(event)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const loading = document.getElementById("loading");
  if (loading) {
    loading.innerHTML = errorHtml;
    loading.style.zIndex = "1";
  }
  return false;
};

window.onload = function () {
  const app = new Application();
  app.start();
};
