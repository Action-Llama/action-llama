import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUnmount = vi.fn();
const mockRenderInstance = { unmount: mockUnmount };
const mockRender = vi.fn().mockReturnValue(mockRenderInstance);
const mockCreateElement = vi.fn().mockReturnValue({ type: "App", props: {} });
const mockAppDefault = vi.fn();

vi.mock("ink", () => ({
  render: (...args: any[]) => mockRender(...args),
}));

vi.mock("react", () => ({
  default: {
    createElement: (...args: any[]) => mockCreateElement(...args),
  },
  createElement: (...args: any[]) => mockCreateElement(...args),
}));

vi.mock("../../src/tui/App.js", () => ({
  default: mockAppDefault,
}));

import { renderTUI } from "../../src/tui/render.js";
import type { StatusTracker } from "../../src/tui/status-tracker.js";

const makeStatusTracker = () => ({} as StatusTracker);

describe("renderTUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRender.mockReturnValue(mockRenderInstance);
    mockCreateElement.mockReturnValue({ type: "App", props: {} });
  });

  it("calls React.createElement with App component and statusTracker", async () => {
    const tracker = makeStatusTracker();

    await renderTUI(tracker);

    expect(mockCreateElement).toHaveBeenCalledOnce();
    expect(mockCreateElement).toHaveBeenCalledWith(
      mockAppDefault,
      expect.objectContaining({ statusTracker: tracker })
    );
  });

  it("passes projectPath to createElement when provided", async () => {
    const tracker = makeStatusTracker();

    await renderTUI(tracker, "/some/project");

    expect(mockCreateElement).toHaveBeenCalledWith(
      mockAppDefault,
      expect.objectContaining({ statusTracker: tracker, projectPath: "/some/project" })
    );
  });

  it("calls ink render with the created element", async () => {
    const tracker = makeStatusTracker();
    const fakeElement = { type: "App", props: { statusTracker: tracker } };
    mockCreateElement.mockReturnValue(fakeElement);

    await renderTUI(tracker);

    expect(mockRender).toHaveBeenCalledOnce();
    expect(mockRender).toHaveBeenCalledWith(fakeElement);
  });

  it("returns an object with an unmount function", async () => {
    const tracker = makeStatusTracker();

    const result = await renderTUI(tracker);

    expect(result).toBeDefined();
    expect(typeof result.unmount).toBe("function");
  });

  it("calling returned unmount calls instance.unmount", async () => {
    const tracker = makeStatusTracker();

    const result = await renderTUI(tracker);
    result.unmount();

    expect(mockUnmount).toHaveBeenCalledOnce();
  });

  it("works when projectPath is undefined", async () => {
    const tracker = makeStatusTracker();

    await expect(renderTUI(tracker, undefined)).resolves.toBeDefined();
  });
});
