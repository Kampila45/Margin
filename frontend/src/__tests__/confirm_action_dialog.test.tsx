import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmActionDialog } from "../components/ui/confirm_action_dialog";

describe("ConfirmActionDialog", () => {
  it("portals to document.body so parent space-y-* stacks never push the backdrop down", () => {
    const { container } = render(
      <div className="space-y-8">
        <div>Library header</div>
        <ConfirmActionDialog
          isOpen={true}
          title="Delete Document?"
          description="Removes the document."
          confirmLabel="Delete Document"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete Document?" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("inset-0");
    expect(dialog.className).toContain("!m-0");
  });
});

