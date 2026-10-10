/**
 * Civisense — Frontend Application Logic
 * Owner: Member 1 (Frontend)
 *
 * Responsibilities:
 * - Load complaints from GET /api/complaints
 * - Submit complaints to POST /api/complaints
 * - Update status via PATCH /api/complaints/<id>
 * - Render stats, badges, and responsive cards
 * - Real-time client-side search and multi-facet filtering
 * - Modal interactions and XSS-safe DOM construction
 */

// Application State
let allComplaints = [];
let activeComplaint = null;

// DOM Elements Cache
const elements = {
    // Stats
    statTotal: document.getElementById("stat-total"),
    statHighPriority: document.getElementById("stat-high-priority"),
    statPending: document.getElementById("stat-pending"),
    statResolved: document.getElementById("stat-resolved"),

    // Feed & States
    complaintsList: document.getElementById("complaints-list"),
    loadingState: document.getElementById("loading-state"),
    errorState: document.getElementById("error-state"),
    errorMessageTitle: document.getElementById("error-message-title"),
    errorMessageDetail: document.getElementById("error-message-detail"),
    emptyState: document.getElementById("empty-state"),
    emptyStateMessage: document.getElementById("empty-state-message"),
    resultsCount: document.getElementById("results-count"),
    retryBtn: document.getElementById("retry-btn"),
    refreshBtn: document.getElementById("refresh-btn"),

    // Search & Filters
    searchInput: document.getElementById("search-input"),
    filterStatus: document.getElementById("filter-status"),
    filterSeverity: document.getElementById("filter-severity"),
    filterCategory: document.getElementById("filter-category"),
    clearFiltersBtn: document.getElementById("clear-filters-btn"),

    // Navigation
    navDashboard: document.getElementById("nav-dashboard"),
    navAllComplaints: document.getElementById("nav-all-complaints"),

    // Report Modal
    reportModal: document.getElementById("report-modal"),
    sidebarReportBtn: document.getElementById("sidebar-report-btn"),
    headerReportBtn: document.getElementById("header-report-btn"),
    reportModalClose: document.getElementById("report-modal-close"),
    reportModalCancel: document.getElementById("report-modal-cancel"),
    reportForm: document.getElementById("report-form"),
    descInput: document.getElementById("complaint-description"),
    locInput: document.getElementById("complaint-location"),
    descCharCount: document.getElementById("desc-char-count"),
    locCharCount: document.getElementById("loc-char-count"),
    descError: document.getElementById("desc-error"),
    locError: document.getElementById("loc-error"),
    reportSubmitBtn: document.getElementById("report-submit-btn"),
    submitSpinner: document.getElementById("submit-spinner"),
    submitBtnText: document.getElementById("submit-btn-text"),

    // Details Modal
    detailsModal: document.getElementById("details-modal"),
    detailsModalClose: document.getElementById("details-modal-close"),
    detailsCloseBtn: document.getElementById("details-close-btn"),
    detailsTopBadges: document.getElementById("details-top-badges"),
    detailsIdText: document.getElementById("details-id-text"),
    detailsBody: document.getElementById("details-body"),
    updateStatusSelect: document.getElementById("update-status-select"),
    saveStatusBtn: document.getElementById("save-status-btn"),
    statusUpdateError: document.getElementById("status-update-error"),

    // Toasts
    toastContainer: document.getElementById("toast-container")
};

// =====================================================================
// Toast Notification Helper
// =====================================================================
function showToast(message, type = "info") {
    if (!elements.toastContainer) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icon = document.createElement("span");
    icon.textContent = type === "success" ? "✅" : (type === "error" ? "⚠️" : "ℹ️");

    const text = document.createElement("span");
    text.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(text);
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        toast.style.transition = "all 0.2s ease";
        setTimeout(() => toast.remove(), 200);
    }, 4000);
}

// =====================================================================
// API Communications
// =====================================================================

/**
 * Loads all complaints from GET /api/complaints
 */
async function loadComplaints() {
    setLoadingState(true);
    setErrorState(false);

    try {
        const response = await fetch("/api/complaints");
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to fetch complaints`);
        }

        const data = await response.json();
        if (data && data.success && Array.isArray(data.complaints)) {
            allComplaints = data.complaints;
            renderDashboard();
        } else {
            throw new Error(data.error || "Unexpected data format from backend");
        }
    } catch (err) {
        console.error("Failed to load complaints:", err);
        setErrorState(true, "Unable to load complaints", err.message);
    } finally {
        setLoadingState(false);
    }
}

/**
 * Submits a new complaint to POST /api/complaints
 */
async function submitComplaint(description, location) {
    setSubmittingState(true);
    clearFormErrors();

    try {
        const response = await fetch("/api/complaints", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                description: description,
                location: location
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || `Server returned error (${response.status})`);
        }

        const newComplaint = data.complaint;
        // Prepend to current list
        allComplaints.unshift(newComplaint);

        closeReportModal();
        elements.reportForm.reset();
        updateCharCounts();

        renderDashboard();
        showToast("Complaint submitted and analyzed successfully!", "success");

        // Automatically open details for immediate review
        openDetailsModal(newComplaint);

    } catch (err) {
        console.error("Submission failed:", err);
        elements.descError.textContent = err.message || "Failed to submit complaint.";
        showToast("Submission failed: " + err.message, "error");
    } finally {
        setSubmittingState(false);
    }
}

/**
 * Updates status of existing complaint via PATCH /api/complaints/<id>
 */
async function updateComplaintStatus(complaintId, newStatus) {
    if (!complaintId || !newStatus) return;

    elements.statusUpdateError.textContent = "";
    elements.saveStatusBtn.disabled = true;
    elements.saveStatusBtn.textContent = "Updating...";

    try {
        const response = await fetch(`/api/complaints/${encodeURIComponent(complaintId)}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Failed to update status");
        }

        const updatedComplaint = data.complaint;

        // Update local list
        const idx = allComplaints.findIndex(c => c.id === complaintId);
        if (idx !== -1) {
            allComplaints[idx] = updatedComplaint;
        }

        activeComplaint = updatedComplaint;
        renderDashboard();
        populateDetailsModal(updatedComplaint);

        showToast(`Status updated to "${newStatus}"`, "success");
    } catch (err) {
        console.error("Status update error:", err);
        elements.statusUpdateError.textContent = err.message;
        showToast("Status update failed: " + err.message, "error");
    } finally {
        elements.saveStatusBtn.disabled = false;
        elements.saveStatusBtn.textContent = "Update Status";
    }
}

// =====================================================================
// Dashboard Rendering & Safe DOM Creation
// =====================================================================

function renderDashboard() {
    renderStatistics();
    renderFilteredComplaints();
}

/**
 * Computes and renders summary stats from real data
 */
function renderStatistics() {
    const total = allComplaints.length;
    let highPriorityCount = 0;
    let pendingCount = 0;
    let resolvedCount = 0;

    for (const c of allComplaints) {
        const sev = (c.severity || "").toLowerCase();
        if (sev === "high" || sev === "critical") {
            highPriorityCount++;
        }

        const status = (c.status || "").toLowerCase();
        if (status === "pending") {
            pendingCount++;
        } else if (status === "resolved") {
            resolvedCount++;
        }
    }

    elements.statTotal.textContent = total;
    elements.statHighPriority.textContent = highPriorityCount;
    elements.statPending.textContent = pendingCount;
    elements.statResolved.textContent = resolvedCount;
}

/**
 * Filters allComplaints based on search and dropdown selections
 */
function getFilteredComplaints() {
    const searchTerm = (elements.searchInput.value || "").trim().toLowerCase();
    const filterStatus = (elements.filterStatus.value || "").trim().toLowerCase();
    const filterSeverity = (elements.filterSeverity.value || "").trim().toLowerCase();
    const filterCategory = (elements.filterCategory.value || "").trim().toLowerCase();

    return allComplaints.filter(c => {
        // Status filter
        if (filterStatus && (c.status || "").toLowerCase() !== filterStatus) {
            return false;
        }
        // Severity filter
        if (filterSeverity && (c.severity || "").toLowerCase() !== filterSeverity) {
            return false;
        }
        // Category filter
        if (filterCategory && (c.category || "").toLowerCase() !== filterCategory) {
            return false;
        }

        // Search match
        if (searchTerm) {
            const idMatch = (c.id || "").toLowerCase().includes(searchTerm);
            const descMatch = (c.description || "").toLowerCase().includes(searchTerm);
            const summaryMatch = (c.summary || "").toLowerCase().includes(searchTerm);
            const locMatch = (c.location || "").toLowerCase().includes(searchTerm);
            const deptMatch = (c.department || "").toLowerCase().includes(searchTerm);
            const catMatch = (c.category || "").toLowerCase().includes(searchTerm);

            if (!idMatch && !descMatch && !summaryMatch && !locMatch && !deptMatch && !catMatch) {
                return false;
            }
        }

        return true;
    });
}

function renderFilteredComplaints() {
    const filtered = getFilteredComplaints();

    // Clear existing cards
    elements.complaintsList.innerHTML = "";

    // Update count display
    elements.resultsCount.textContent = `Showing ${filtered.length} of ${allComplaints.length} complaint${allComplaints.length === 1 ? "" : "s"}`;

    if (allComplaints.length === 0) {
        elements.emptyState.style.display = "flex";
        elements.emptyStateMessage.textContent = 'No complaints have been reported yet. Click "Report an Issue" to lodge a citizen grievance.';
        return;
    }

    if (filtered.length === 0) {
        elements.emptyState.style.display = "flex";
        elements.emptyStateMessage.textContent = "No complaints match your active filter and search criteria.";
        return;
    }

    elements.emptyState.style.display = "none";

    // Build DOM safely without innerHTML injection
    for (const c of filtered) {
        const card = createComplaintCardElement(c);
        elements.complaintsList.appendChild(card);
    }
}

/**
 * Creates a complaint card element using strict, XSS-safe DOM methods
 */
function createComplaintCardElement(c) {
    const card = document.createElement("div");
    card.className = "complaint-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Complaint ${c.id}: ${c.summary || c.description}`);

    card.addEventListener("click", () => openDetailsModal(c));
    card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDetailsModal(c);
        }
    });

    // Top Row: Badges and ID
    const topRow = document.createElement("div");
    topRow.className = "card-top-row";

    const badges = document.createElement("div");
    badges.className = "card-badges";

    // Severity Badge
    badges.appendChild(createSeverityBadge(c.severity));

    // Status Badge
    badges.appendChild(createStatusBadge(c.status));

    // Category Badge
    if (c.category) {
        const catBadge = document.createElement("span");
        catBadge.className = "badge badge-category";
        catBadge.textContent = c.category;
        badges.appendChild(catBadge);
    }

    // AI Status Indicator
    if (c.ai_status === "unavailable") {
        const aiBadge = document.createElement("span");
        aiBadge.className = "badge badge-ai-unavailable";
        aiBadge.textContent = "⚠️ Manual Review";
        badges.appendChild(aiBadge);
    }

    const metaRight = document.createElement("div");
    metaRight.className = "card-meta-right";

    const idSpan = document.createElement("span");
    idSpan.className = "card-id";
    idSpan.textContent = c.id || "N/A";

    const dateSpan = document.createElement("span");
    dateSpan.textContent = formatTimestamp(c.created_at);

    metaRight.appendChild(idSpan);
    metaRight.appendChild(dateSpan);

    topRow.appendChild(badges);
    topRow.appendChild(metaRight);
    card.appendChild(topRow);

    // Summary / Title
    const summary = document.createElement("h3");
    summary.className = "card-summary";
    summary.textContent = c.summary || c.description;
    card.appendChild(summary);

    // Truncated Description
    if (c.summary && c.summary !== c.description) {
        const desc = document.createElement("p");
        desc.className = "card-description";
        desc.textContent = c.description;
        card.appendChild(desc);
    }

    // Footer Row: Location & Department
    const footerRow = document.createElement("div");
    footerRow.className = "card-footer-row";

    const locItem = document.createElement("div");
    locItem.className = "card-footer-item";
    const locIcon = document.createElement("span");
    locIcon.className = "card-footer-icon";
    locIcon.textContent = "📍";
    const locText = document.createElement("span");
    locText.textContent = c.location || "Unspecified Location";
    locItem.appendChild(locIcon);
    locItem.appendChild(locText);

    const deptItem = document.createElement("div");
    deptItem.className = "card-footer-item";
    const deptIcon = document.createElement("span");
    deptIcon.className = "card-footer-icon";
    deptIcon.textContent = "🏢";
    const deptText = document.createElement("span");
    deptText.textContent = c.department || "General Municipal Cell";
    deptItem.appendChild(deptIcon);
    deptItem.appendChild(deptText);

    footerRow.appendChild(locItem);
    footerRow.appendChild(deptItem);
    card.appendChild(footerRow);

    return card;
}

// =====================================================================
// Badge Creators
// =====================================================================

function createSeverityBadge(severity) {
    const badge = document.createElement("span");
    const sev = (severity || "Medium").toLowerCase();

    let className = "badge-sev-medium";
    let icon = "⚠️";

    if (sev === "critical") {
        className = "badge-sev-critical";
        icon = "🔥";
    } else if (sev === "high") {
        className = "badge-sev-high";
        icon = "🚨";
    } else if (sev === "low") {
        className = "badge-sev-low";
        icon = "🟢";
    }

    badge.className = `badge ${className}`;
    badge.textContent = `${icon} ${severity || "Medium"}`;
    return badge;
}

function createStatusBadge(status) {
    const badge = document.createElement("span");
    const s = (status || "Pending").toLowerCase();

    let className = "badge-status-pending";
    let icon = "⏳";

    if (s === "in progress") {
        className = "badge-status-in-progress";
        icon = "⚙️";
    } else if (s === "resolved") {
        className = "badge-status-resolved";
        icon = "✅";
    }

    badge.className = `badge ${className}`;
    badge.textContent = `${icon} ${status || "Pending"}`;
    return badge;
}

// =====================================================================
// Details Modal Implementation
// =====================================================================

function openDetailsModal(complaint) {
    activeComplaint = complaint;
    populateDetailsModal(complaint);
    elements.detailsModal.classList.add("active");
    elements.detailsModal.setAttribute("aria-hidden", "false");
    elements.detailsModalClose.focus();
}

function closeDetailsModal() {
    elements.detailsModal.classList.remove("active");
    elements.detailsModal.setAttribute("aria-hidden", "true");
    activeComplaint = null;
    elements.statusUpdateError.textContent = "";
}

function populateDetailsModal(c) {
    elements.detailsIdText.textContent = `Complaint ID: ${c.id || "N/A"}`;
    elements.updateStatusSelect.value = c.status || "Pending";

    // Top badges
    elements.detailsTopBadges.innerHTML = "";
    elements.detailsTopBadges.appendChild(createSeverityBadge(c.severity));
    elements.detailsTopBadges.appendChild(createStatusBadge(c.status));

    if (c.category) {
        const catBadge = document.createElement("span");
        catBadge.className = "badge badge-category";
        catBadge.textContent = c.category;
        elements.detailsTopBadges.appendChild(catBadge);
    }

    // Modal Body Construction (XSS Safe)
    elements.detailsBody.innerHTML = "";

    // Metadata Grid
    const grid = document.createElement("div");
    grid.className = "details-grid";

    grid.appendChild(createMetaItem("Location", c.location || "N/A"));
    grid.appendChild(createMetaItem("Suggested Department", c.department || "Municipal Cell"));
    grid.appendChild(createMetaItem("Submission Time", formatTimestamp(c.created_at, true)));
    grid.appendChild(createMetaItem("AI Classification Status", c.ai_status === "success" ? "Analyzed with Gemma" : "Unavailable (Manual Review)"));

    elements.detailsBody.appendChild(grid);

    // AI Warning if unavailable
    if (c.ai_status !== "success") {
        const warningBox = document.createElement("div");
        warningBox.className = "ai-warning-box";
        const wTitle = document.createElement("strong");
        wTitle.textContent = "Notice: ";
        const wText = document.createTextNode(
            "AI analysis is currently unavailable. The complaint has been recorded, but its classification may require manual review by municipal staff."
        );
        warningBox.appendChild(wTitle);
        warningBox.appendChild(wText);
        elements.detailsBody.appendChild(warningBox);
    }

    // AI Summary
    if (c.summary) {
        const summaryBlock = document.createElement("div");
        summaryBlock.className = "details-block";
        const label = document.createElement("span");
        label.className = "details-block-label";
        label.textContent = "AI Overview Summary";
        const content = document.createElement("div");
        content.className = "details-block-content";
        content.textContent = c.summary;
        summaryBlock.appendChild(label);
        summaryBlock.appendChild(content);
        elements.detailsBody.appendChild(summaryBlock);
    }

    // Recommended Action
    if (c.recommended_action) {
        const actionBox = document.createElement("div");
        actionBox.className = "ai-recommendation-box";
        const label = document.createElement("span");
        label.className = "details-block-label";
        label.textContent = "Recommended Action for Responders";
        const text = document.createElement("p");
        text.textContent = c.recommended_action;
        actionBox.appendChild(label);
        actionBox.appendChild(text);
        elements.detailsBody.appendChild(actionBox);
    }

    // Full Citizen Complaint Description
    const descBlock = document.createElement("div");
    descBlock.className = "details-block";
    const descLabel = document.createElement("span");
    descLabel.className = "details-block-label";
    descLabel.textContent = "Full Citizen Description";
    const descContent = document.createElement("div");
    descContent.className = "details-block-content";
    descContent.textContent = c.description || "";
    descBlock.appendChild(descLabel);
    descBlock.appendChild(descContent);
    elements.detailsBody.appendChild(descBlock);
}

function createMetaItem(label, value) {
    const item = document.createElement("div");
    item.className = "details-meta-item";
    const lbl = document.createElement("span");
    lbl.className = "details-meta-label";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "details-meta-val";
    val.textContent = value;
    item.appendChild(lbl);
    item.appendChild(val);
    return item;
}

// =====================================================================
// Report Form Modal
// =====================================================================

function openReportModal() {
    elements.reportForm.reset();
    clearFormErrors();
    updateCharCounts();
    elements.reportModal.classList.add("active");
    elements.reportModal.setAttribute("aria-hidden", "false");
    elements.descInput.focus();
}

function closeReportModal() {
    elements.reportModal.classList.remove("active");
    elements.reportModal.setAttribute("aria-hidden", "true");
    clearFormErrors();
}

function clearFormErrors() {
    elements.descError.textContent = "";
    elements.locError.textContent = "";
}

function updateCharCounts() {
    const descLen = (elements.descInput.value || "").length;
    const locLen = (elements.locInput.value || "").length;
    elements.descCharCount.textContent = `${descLen} / 2000`;
    elements.locCharCount.textContent = `${locLen} / 200`;
}

function handleFormSubmit(e) {
    e.preventDefault();
    clearFormErrors();

    const description = (elements.descInput.value || "").trim();
    const location = (elements.locInput.value || "").trim();

    let isValid = true;

    if (!description) {
        elements.descError.textContent = "Please provide a description of the civic problem.";
        isValid = false;
    } else if (description.length < 5) {
        elements.descError.textContent = "Description must be at least 5 characters.";
        isValid = false;
    }

    if (!location) {
        elements.locError.textContent = "Please specify a location, street, or landmark.";
        isValid = false;
    }

    if (!isValid) return;

    submitComplaint(description, location);
}

// =====================================================================
// View State Helpers
// =====================================================================

function setLoadingState(isLoading) {
    if (elements.loadingState) {
        elements.loadingState.style.display = isLoading ? "flex" : "none";
    }
}

function setErrorState(isError, title = "", detail = "") {
    if (elements.errorState) {
        elements.errorState.style.display = isError ? "flex" : "none";
        if (isError) {
            elements.errorMessageTitle.textContent = title;
            elements.errorMessageDetail.textContent = detail;
        }
    }
}

function setSubmittingState(isSubmitting) {
    elements.reportSubmitBtn.disabled = isSubmitting;
    elements.reportModalCancel.disabled = isSubmitting;
    elements.reportModalClose.disabled = isSubmitting;
    elements.submitSpinner.style.display = isSubmitting ? "inline-block" : "none";
    elements.submitBtnText.textContent = isSubmitting ? "Analyzing & Submitting..." : "Submit Complaint";
}

function formatTimestamp(isoString, full = false) {
    if (!isoString) return "N/A";
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;

        if (full) {
            return d.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short"
            });
        }
        return d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    } catch {
        return isoString;
    }
}

// =====================================================================
// Event Listeners Initialization
// =====================================================================

function initializeEventListeners() {
    // Report Modal Open/Close
    elements.sidebarReportBtn.addEventListener("click", openReportModal);
    elements.headerReportBtn.addEventListener("click", openReportModal);
    elements.reportModalClose.addEventListener("click", closeReportModal);
    elements.reportModalCancel.addEventListener("click", closeReportModal);

    // Form inputs char counting
    elements.descInput.addEventListener("input", updateCharCounts);
    elements.locInput.addEventListener("input", updateCharCounts);

    // Form submission
    elements.reportForm.addEventListener("submit", handleFormSubmit);

    // Details Modal Open/Close & Status Update
    elements.detailsModalClose.addEventListener("click", closeDetailsModal);
    elements.detailsCloseBtn.addEventListener("click", closeDetailsModal);
    elements.saveStatusBtn.addEventListener("click", () => {
        if (activeComplaint) {
            updateComplaintStatus(activeComplaint.id, elements.updateStatusSelect.value);
        }
    });

    // Close modals on escape key or outside backdrop click
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (elements.reportModal.classList.contains("active")) closeReportModal();
            if (elements.detailsModal.classList.contains("active")) closeDetailsModal();
        }
    });

    elements.reportModal.addEventListener("click", (e) => {
        if (e.target === elements.reportModal) closeReportModal();
    });

    elements.detailsModal.addEventListener("click", (e) => {
        if (e.target === elements.detailsModal) closeDetailsModal();
    });

    // Refresh & Retry
    elements.refreshBtn.addEventListener("click", loadComplaints);
    elements.retryBtn.addEventListener("click", loadComplaints);

    // Search and Filters
    elements.searchInput.addEventListener("input", renderFilteredComplaints);
    elements.filterStatus.addEventListener("change", renderFilteredComplaints);
    elements.filterSeverity.addEventListener("change", renderFilteredComplaints);
    elements.filterCategory.addEventListener("change", renderFilteredComplaints);

    elements.clearFiltersBtn.addEventListener("click", () => {
        elements.searchInput.value = "";
        elements.filterStatus.value = "";
        elements.filterSeverity.value = "";
        elements.filterCategory.value = "";
        renderFilteredComplaints();
    });

    // Sidebar navigation simulation
    elements.navDashboard.addEventListener("click", () => {
        elements.navDashboard.classList.add("active");
        elements.navAllComplaints.classList.remove("active");
        elements.clearFiltersBtn.click();
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    elements.navAllComplaints.addEventListener("click", () => {
        elements.navAllComplaints.classList.add("active");
        elements.navDashboard.classList.remove("active");
        const section = document.querySelector(".complaints-section");
        if (section) section.scrollIntoView({ behavior: "smooth" });
    });
}

// Start application
document.addEventListener("DOMContentLoaded", () => {
    initializeEventListeners();
    loadComplaints();
});
