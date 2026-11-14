import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it, beforeEach } from "vitest";
import { GettingStartedChecklistCard } from "../features/onboarding/getting_started_checklist_card";
import { InteractiveProductTour } from "../features/onboarding/interactive_product_tour";
import { OnboardingGuideModal } from "../features/onboarding/onboarding_guide_modal";
import { useReaderSelectionStore } from "../stores/reader_selection_store";

describe("Onboarding Workflows", () => {
  beforeEach(() => {
    localStorage.clear();
    useReaderSelectionStore.setState({ isGuideModalOpen: false, isTourActive: false, tourStepIndex: 0 });
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });

  it("renders checklist progress and tasks for first-time users", () => {
    render(
      <BrowserRouter>
        <GettingStartedChecklistCard
          documentCount={0}
          conversationCount={0}
          databaseCount={0}
          firstReadyDocumentId={null}
        />
      </BrowserRouter>,
    );

    expect(screen.getByText("Getting Started with Margin")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 completed")).toBeInTheDocument();
    expect(screen.getByText("Index your first document")).toBeInTheDocument();
    expect(screen.getByText("Ask a grounded margin question")).toBeInTheDocument();
    expect(screen.getByText("Connect a PostgreSQL replica")).toBeInTheDocument();
  });

  it("reflects partial progress when user has documents", () => {
    render(
      <BrowserRouter>
        <GettingStartedChecklistCard
          documentCount={1}
          conversationCount={0}
          databaseCount={0}
          firstReadyDocumentId="doc-123"
        />
      </BrowserRouter>,
    );

    expect(screen.getByText("1 of 3 completed")).toBeInTheDocument();
    expect(screen.getByText("Open Reader")).toBeInTheDocument();
  });

  it("automatically hides checklist when all 3 tasks are complete", () => {
    const { container } = render(
      <BrowserRouter>
        <GettingStartedChecklistCard
          documentCount={2}
          conversationCount={1}
          databaseCount={1}
          firstReadyDocumentId="doc-123"
        />
      </BrowserRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("allows user to dismiss checklist", () => {
    render(
      <BrowserRouter>
        <GettingStartedChecklistCard
          documentCount={0}
          conversationCount={0}
          databaseCount={0}
          firstReadyDocumentId={null}
        />
      </BrowserRouter>,
    );

    const dismissBtn = screen.getByLabelText("Dismiss checklist");
    fireEvent.click(dismissBtn);

    expect(screen.queryByText("Getting Started with Margin")).not.toBeInTheDocument();
    expect(localStorage.getItem("margin_checklist_dismissed")).toBe("true");
  });

  it("opens guide modal, steps through slides, and closes", () => {
    useReaderSelectionStore.setState({ isGuideModalOpen: true });

    render(<OnboardingGuideModal />);

    expect(screen.getByText("Welcome to Margin")).toBeInTheDocument();
    expect(screen.getByText("Dual-Mode Intelligence")).toBeInTheDocument();

    // Click Next to slide 2
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Interactive Margin Reading & Citations")).toBeInTheDocument();

    // Click Next to slide 3
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Natural Language PostgreSQL Querying")).toBeInTheDocument();
    expect(screen.getByText("Get Started")).toBeInTheDocument();

    // Click Get Started to close
    fireEvent.click(screen.getByText("Get Started"));
    expect(useReaderSelectionStore.getState().isGuideModalOpen).toBe(false);
  });

  it("takes user step-by-step through the application using InteractiveProductTour", () => {
    // Mount dummy elements matching tour targets
    document.body.innerHTML = `
      <div data-tour="sidebar-nav">Sidebar Nav</div>
      <div data-tour="mode-switcher">Mode Switcher</div>
      <div data-tour="action-button">Action Button</div>
      <div data-tour="active-reader-nav">Active Reader Nav</div>
      <div data-tour="sql-tab-btn">SQL Tab Button</div>
      <div id="root"></div>
    `;

    useReaderSelectionStore.setState({ isTourActive: true, tourStepIndex: 0 });

    render(
      <BrowserRouter>
        <InteractiveProductTour />
      </BrowserRouter>,
    );

    // Step 1: Intelligence Navigation Rail
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByText("Intelligence Navigation Rail")).toBeInTheDocument();

    // Step 2: Dual-Engine Switcher
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByText("Dual-Engine Switcher")).toBeInTheDocument();

    // Step 3: Ingest Unstructured Documents
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
    expect(screen.getByText("Ingest Unstructured Documents")).toBeInTheDocument();

    // Step 4: Active Reader & Margin Annotations
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 4 of 5")).toBeInTheDocument();
    expect(screen.getByText("Active Reader & Margin Annotations")).toBeInTheDocument();

    // Step 5: Structured PostgreSQL Assistant
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    expect(screen.getByText("Structured PostgreSQL Assistant")).toBeInTheDocument();
    expect(screen.getByText("Finish Tour")).toBeInTheDocument();

    // Finish tour
    fireEvent.click(screen.getByText("Finish Tour"));
    expect(useReaderSelectionStore.getState().isTourActive).toBe(false);
    expect(localStorage.getItem("margin_tour_completed")).toBe("true");
  });

  it("closes tour early when user clicks close or presses Escape", () => {
    useReaderSelectionStore.setState({ isTourActive: true, tourStepIndex: 1 });

    render(
      <BrowserRouter>
        <InteractiveProductTour />
      </BrowserRouter>,
    );

    const closeBtn = screen.getByLabelText("Exit tour");
    fireEvent.click(closeBtn);

    expect(useReaderSelectionStore.getState().isTourActive).toBe(false);
    expect(localStorage.getItem("margin_tour_completed")).toBe("true");
  });

  it("allows user to trigger Add Connection directly from the SQL slide of the onboarding guide modal", () => {
    useReaderSelectionStore.setState({ isGuideModalOpen: true, isConnectDbModalOpen: false });

    render(
      <BrowserRouter>
        <OnboardingGuideModal />
      </BrowserRouter>,
    );

    // Navigate to slide 3 (SQL Studio)
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Natural Language PostgreSQL Querying")).toBeInTheDocument();

    // Click Add Connection button in the slide
    const addConnButtons = screen.getAllByRole("button", { name: /add connection/i });
    expect(addConnButtons.length).toBeGreaterThan(0);
    fireEvent.click(addConnButtons[0]!);

    // Should open Connect Database Modal and close Guide
    expect(useReaderSelectionStore.getState().isConnectDbModalOpen).toBe(true);
    expect(useReaderSelectionStore.getState().isGuideModalOpen).toBe(false);
  });

  it("allows user to trigger Upload Document directly from the Document slide of the onboarding guide modal", () => {
    useReaderSelectionStore.setState({ isGuideModalOpen: true, isUploadModalOpen: false });

    render(
      <BrowserRouter>
        <OnboardingGuideModal />
      </BrowserRouter>,
    );

    // Navigate to slide 2 (Document Intelligence)
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Interactive Margin Reading & Citations")).toBeInTheDocument();

    // Click Upload Document button
    const uploadButtons = screen.getAllByRole("button", { name: /upload document/i });
    expect(uploadButtons.length).toBeGreaterThan(0);
    fireEvent.click(uploadButtons[0]!);

    // Should open Document Upload Modal and close Guide
    expect(useReaderSelectionStore.getState().isUploadModalOpen).toBe(true);
    expect(useReaderSelectionStore.getState().isGuideModalOpen).toBe(false);
  });

  it("allows user to launch Interactive Product Tour directly from the Welcome slide of the onboarding guide modal", () => {
    useReaderSelectionStore.setState({ isGuideModalOpen: true, isTourActive: false });

    render(
      <BrowserRouter>
        <OnboardingGuideModal />
      </BrowserRouter>,
    );

    const startTourBtn = screen.getByRole("button", { name: /start interactive tour/i });
    fireEvent.click(startTourBtn);

    expect(useReaderSelectionStore.getState().isTourActive).toBe(true);
    expect(useReaderSelectionStore.getState().isGuideModalOpen).toBe(false);
  });

  it("highlights Step 5 without rendering duplicate action buttons inside the tour popover", () => {
    document.body.innerHTML = `
      <div data-tour="sql-add-connection-btn">Add Connection Button</div>
      <div id="root"></div>
    `;

    useReaderSelectionStore.setState({
      isTourActive: true,
      tourStepIndex: 4,
      isConnectDbModalOpen: false,
    });

    render(
      <BrowserRouter>
        <InteractiveProductTour />
      </BrowserRouter>,
    );

    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add connection/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /finish tour/i }));
    expect(useReaderSelectionStore.getState().isTourActive).toBe(false);
  });
});

