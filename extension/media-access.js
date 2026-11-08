export function mediaUrl(value) {
  const url = new URL(value instanceof Request ? value.url : value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Unsupported media URL");
  }
  return url;
}

export function mediaCredentials(url, pageOrigin) {
  return url.origin === pageOrigin ? "include" : "omit";
}

export function allowMediaHost(url) {
  return chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
}
