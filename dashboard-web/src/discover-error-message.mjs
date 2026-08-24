const NETWORK_FAILURE_MESSAGE = "The contact search ran too long for a single request, so the connection closed. Any contacts already found were not saved. Run Discover again with fewer companies because a smaller group can finish before the connection closes.";

export function discoverErrorMessage(err) {
  const message = typeof err?.message === "string" ? err.message : "";
  if (err instanceof TypeError || /failed to fetch|networkerror/i.test(message)) {
    return NETWORK_FAILURE_MESSAGE;
  }
  return message || "Contact discovery failed.";
}
