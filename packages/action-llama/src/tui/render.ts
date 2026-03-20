import type { StatusTracker } from "./status-tracker.js";

export async function renderTUI(statusTracker: StatusTracker): Promise<{ unmount: () => void }> {
  const { render } = await import("ink");
  const React = await import("react");
  const { default: App } = await import("./App.js");

  const element = React.createElement(App, { statusTracker });
  const instance = render(element);

  return { unmount: () => instance.unmount() };
}
