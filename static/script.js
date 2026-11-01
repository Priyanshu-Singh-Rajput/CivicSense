/**
 * Civisense — Frontend Application Logic
 * Phases 1-5: Full-Stack Complaint Intake, AI Classification,
 * Photo Verification, and Automatic OpenStreetMap Location Capture.
 */

// Application State
let allComplaints = [];
let activeComplaint = null;
let currentUser = null;

// Phase 5 State Variables
let selectedPhotoFile = null;
let capturedLocation = null;
let userCurrentCoords = null;
let isLocationCapturing = false;
let newlySubmittedComplaint = null;
let previewMap = null;
let previewMarker = null;
let detailsMap = null;

/**
 * Calculates human-friendly spherical distance between two coordinates using Haversine formula
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    if (dist < 1) {
        return `${Math.round(dist * 1000)} m away`;
    }
    return `${dist.toFixed(1)} km away`;
}

// Submission States (Section 8: User Interface and Submission States)
const SUBMISSION_STATES = {
    NO_PHOTO: 1,
    PHOTO_SELECTED: 2,
    REQUESTING_LOCATION: 3,
    LOCATION_CAPTURED: 4,
    MAP_VISIBLE: 5,
    SUBMITTING: 6,
    SUCCESS: 7,
    FAILED: 8
};

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

    // Phase 5: Photo & Location Elements
    submissionStatePill: document.getElementById("submission-state-pill"),
    photoInputCamera: document.getElementById("photo-input-camera"),
    photoInputFile: document.getElementById("photo-input-file"),
    photoDropzone: document.getElementById("photo-dropzone"),
    btnCameraTrigger: document.getElementById("btn-camera-trigger"),
    btnFileTrigger: document.getElementById("btn-file-trigger"),
    photoPreviewCard: document.getElementById("photo-preview-card"),
    photoPreviewImg: document.getElementById("photo-preview-img"),
    photoNameText: document.getElementById("photo-name-text"),
    photoSizeText: document.getElementById("photo-size-text"),
    btnReplacePhoto: document.getElementById("btn-replace-photo"),
    btnRemovePhoto: document.getElementById("btn-remove-photo"),
    photoError: document.getElementById("photo-error"),

    btnDetectLocation: document.getElementById("btn-detect-location"),
    btnDetectLocationText: document.getElementById("btn-detect-location-text"),
    locationErrorAlert: document.getElementById("location-error-alert"),
    locationErrorMessage: document.getElementById("location-error-message"),
    locationDetailsBar: document.getElementById("location-details-bar"),
    chipLatitude: document.getElementById("chip-latitude"),
    chipLongitude: document.getElementById("chip-longitude"),
    chipAccuracy: document.getElementById("chip-accuracy"),
    resolvedAddressRow: document.getElementById("resolved-address-row"),
    resolvedAddressText: document.getElementById("resolved-address-text"),
    mapPreviewWrapper: document.getElementById("map-preview-wrapper"),
    locationMap: document.getElementById("location-map"),
    mapTileWarning: document.getElementById("map-tile-warning"),
    formGlobalError: document.getElementById("form-global-error"),
    formGlobalErrorText: document.getElementById("form-global-error-text"),

    submissionSuccessView: document.getElementById("submission-success-view"),
    successReportId: document.getElementById("success-report-id"),
    successMetaChips: document.getElementById("success-meta-chips"),
    successViewDetailsBtn: document.getElementById("success-view-details-btn"),
    successNewReportBtn: document.getElementById("success-new-report-btn"),

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
    statusCitizenNotice: document.getElementById("status-citizen-notice"),

    // Auth & User Profile Containers
    sidebarUserContainer: document.getElementById("sidebar-user-container"),
    headerAuthContainer: document.getElementById("header-auth-container"),

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
// Phase 5: Submission Interface State Management (8 States)
// =====================================================================
function setSubmissionState(state, customLabel = "") {
    if (!elements.submissionStatePill) return;

    // Reset state classes
    elements.submissionStatePill.className = "state-pill";
    elements.submissionStatePill.classList.add(`state-${state}`);

    const stateLabels = {
        1: "1. No Photo Selected",
        2: "2. Photo Selected & Previewed",
        3: "3. Requesting GPS Location...",
        4: "4. Location Captured",
        5: "5. Map & Location Preview Visible",
        6: "6. Submitting Report...",
        7: "7. Submission Successful",
        8: "8. Submission Failed"
    };

    elements.submissionStatePill.textContent = customLabel || stateLabels[state] || `State ${state}`;
}

// =====================================================================
// Phase 5: Photo Upload & Camera Management
// =====================================================================
function handlePhotoFileSelected(file) {
    if (!file) return;

    elements.photoError.textContent = "";

    // 1. Validate format (JPEG, PNG, WebP)
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    const validExts = [".jpg", ".jpeg", ".png", ".webp"];

    if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
        elements.photoError.textContent = "Unsupported format. Please select or capture a JPEG, PNG, or WebP photo.";
        showToast("Invalid file format. Please use JPEG, PNG, or WebP.", "error");
        return;
    }

    // 2. Validate size (Max 10MB)
    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        elements.photoError.textContent = "Image size exceeds 10MB limit. Please capture or select a smaller photo.";
        showToast("Image exceeds 10MB limit.", "error");
        return;
    }

    if (file.size === 0) {
        elements.photoError.textContent = "The selected image file is empty (0 bytes).";
        return;
    }

    selectedPhotoFile = file;

    // 3. Render image preview
    const reader = new FileReader();
    reader.onload = function(e) {
        elements.photoPreviewImg.src = e.target.result;
        elements.photoNameText.textContent = file.name || "captured_photo.jpg";
        elements.photoSizeText.textContent = formatBytes(file.size);

        elements.photoDropzone.style.display = "none";
        elements.photoPreviewCard.style.display = "flex";

        if (!capturedLocation) {
            setSubmissionState(SUBMISSION_STATES.PHOTO_SELECTED);
            // Automatically prompt GPS location capture for a fluid workflow
            captureCurrentLocation();
        } else {
            setSubmissionState(SUBMISSION_STATES.MAP_VISIBLE);
        }
    };
    reader.onerror = function() {
        elements.photoError.textContent = "Failed to read the selected image file.";
    };
    reader.readAsDataURL(file);
}

function removeSelectedPhoto() {
    selectedPhotoFile = null;
    elements.photoInputFile.value = "";
    elements.photoInputCamera.value = "";
    elements.photoPreviewImg.src = "";
    elements.photoPreviewCard.style.display = "none";
    elements.photoDropzone.style.display = "block";
    elements.photoError.textContent = "";

    setSubmissionState(SUBMISSION_STATES.NO_PHOTO);
}

function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// =====================================================================
// Phase 5: Automatic Geolocation Capture & OpenStreetMap
// =====================================================================
async function captureCurrentLocation(forceRefresh = false) {
    if (isLocationCapturing) return null;

    // Avoid repeatedly requesting location if a valid reading exists for this attempt
    if (!forceRefresh && capturedLocation && (Date.now() - capturedLocation.rawTimestamp < 60000)) {
        renderMapPreview(capturedLocation.latitude, capturedLocation.longitude, capturedLocation.accuracy);
        setSubmissionState(SUBMISSION_STATES.MAP_VISIBLE);
        return capturedLocation;
    }

    // Check secure context (Geolocation requires HTTPS or localhost)
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!window.isSecureContext && !isLocal) {
        showLocationError("Browser geolocation requires a secure HTTPS connection or localhost.");
        setSubmissionState(SUBMISSION_STATES.FAILED, "8. Location Insecure Context");
        return null;
    }

    // Check browser support
    if (!("geolocation" in navigator)) {
        showLocationError("Geolocation is not supported by your browser.");
        setSubmissionState(SUBMISSION_STATES.FAILED, "8. Geolocation Unsupported");
        return null;
    }

    isLocationCapturing = true;
    setSubmissionState(SUBMISSION_STATES.REQUESTING_LOCATION);
    elements.btnDetectLocation.disabled = true;
    elements.btnDetectLocationText.textContent = "Detecting...";
    elements.locationErrorAlert.style.display = "none";

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                isLocationCapturing = false;
                elements.btnDetectLocation.disabled = false;
                elements.btnDetectLocationText.textContent = "Refresh Location";

                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const acc = position.coords.accuracy;

                capturedLocation = {
                    latitude: lat,
                    longitude: lon,
                    accuracy: acc,
                    rawTimestamp: Date.now(),
                    timestamp: new Date().toISOString(),
                    address: null
                };

                // Update UI chips
                elements.chipLatitude.textContent = `Lat: ${lat.toFixed(5)}°`;
                elements.chipLongitude.textContent = `Lon: ${lon.toFixed(5)}°`;
                elements.chipAccuracy.textContent = `Accuracy: ±${Math.round(acc)}m`;
                elements.locationDetailsBar.style.display = "block";

                userCurrentCoords = capturedLocation;
                renderFilteredComplaints();

                setSubmissionState(SUBMISSION_STATES.LOCATION_CAPTURED);

                // Render OpenStreetMap Leaflet preview
                renderMapPreview(lat, lon, acc);
                setSubmissionState(SUBMISSION_STATES.MAP_VISIBLE);

                // Asynchronously fetch reverse geocoded address via Nominatim
                fetchReverseGeocode(lat, lon);

                resolve(capturedLocation);
            },
            (error) => {
                isLocationCapturing = false;
                elements.btnDetectLocation.disabled = false;
                elements.btnDetectLocationText.textContent = "Retry Location";

                let errorMsg = "Unable to retrieve your location.";
                if (error.code === error.PERMISSION_DENIED) {
                    errorMsg = "Location permission denied. Civic reports require location access to dispatch municipal crews. Please allow location access in your browser settings.";
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    errorMsg = "Location information is unavailable from your device. Please ensure your device location/GPS is toggled on.";
                } else if (error.code === error.TIMEOUT) {
                    errorMsg = "Location request timed out. Please click 'Detect GPS Location' to try again.";
                }

                showLocationError(errorMsg);
                setSubmissionState(SUBMISSION_STATES.FAILED, "8. Location Access Blocked");
                resolve(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 30000
            }
        );
    });
}

function showLocationError(msg) {
    elements.locationErrorMessage.textContent = msg;
    elements.locationErrorAlert.style.display = "flex";
}

function renderMapPreview(lat, lon, acc) {
    if (typeof L === "undefined") {
        console.warn("Leaflet library not loaded");
        return;
    }

    elements.mapPreviewWrapper.style.display = "block";

    if (!previewMap) {
        previewMap = L.map("location-map", {
            center: [lat, lon],
            zoom: 16,
            zoomControl: true,
            attributionControl: false
        });

        const tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
        }).addTo(previewMap);

        tileLayer.on("tileerror", function() {
            elements.mapTileWarning.style.display = "block";
        });
    } else {
        previewMap.setView([lat, lon], 16);
    }

    if (!previewMarker) {
        previewMarker = L.marker([lat, lon]).addTo(previewMap);
    } else {
        previewMarker.setLatLng([lat, lon]);
    }

    const popupContent = `<strong>Your reported location</strong><br>Lat: ${lat.toFixed(5)}<br>Lon: ${lon.toFixed(5)}<br>Accuracy: ±${Math.round(acc)}m`;
    previewMarker.bindPopup(popupContent).openPopup();

    setTimeout(() => {
        if (previewMap) previewMap.invalidateSize();
    }, 200);
}

// =====================================================================
// Phase 5: Reverse Geocoding via Nominatim
// =====================================================================
async function fetchReverseGeocode(lat, lon) {
    elements.resolvedAddressText.textContent = "Fetching readable address via OpenStreetMap Nominatim...";
    try {
        const response = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.address) {
                capturedLocation.address = data.address;
                elements.resolvedAddressText.textContent = data.address;

                // Auto-fill area/landmark input if the user hasn't typed anything yet
                if (!elements.locInput.value.trim()) {
                    elements.locInput.value = data.address.slice(0, 200);
                    updateCharCounts();
                }
                return;
            }
        }
    } catch (err) {
        console.warn("Reverse geocode fetch failed:", err);
    }

    elements.resolvedAddressText.textContent = "Detailed address lookup unavailable. Authoritative GPS coordinates recorded.";
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
 * Submits single report (Photo + Location + Description) as multipart/form-data
 */
async function submitReport() {
    clearFormErrors();
    elements.formGlobalError.style.display = "none";

    let isValid = true;

    // 1. Photo validation
    if (!selectedPhotoFile) {
        elements.photoError.textContent = "Please take a photo or select an image file to proceed.";
        setSubmissionState(SUBMISSION_STATES.NO_PHOTO);
        isValid = false;
    }

    // 2. Description validation
    const description = (elements.descInput.value || "").trim();
    if (!description) {
        elements.descError.textContent = "Please provide a description of the civic problem.";
        isValid = false;
    } else if (description.length < 5) {
        elements.descError.textContent = "Description must be at least 5 characters.";
        isValid = false;
    }

    if (!isValid) return;

    // 3. Location validation (must have captured coordinates)
    if (!capturedLocation) {
        showToast("Obtaining your GPS location for report verification...", "info");
        const loc = await captureCurrentLocation();
        if (!loc) {
            elements.formGlobalErrorText.textContent = "Location access is required to submit a civic report with photo. Please grant location permission to proceed.";
            elements.formGlobalError.style.display = "flex";
            setSubmissionState(SUBMISSION_STATES.FAILED);
            return;
        }
    }

    // 4. Submitting State (State 6)
    setSubmittingState(true);
    setSubmissionState(SUBMISSION_STATES.SUBMITTING);

    const formData = new FormData();
    formData.append("photo", selectedPhotoFile);
    formData.append("latitude", capturedLocation.latitude.toString());
    formData.append("longitude", capturedLocation.longitude.toString());
    formData.append("accuracy", capturedLocation.accuracy.toString());
    formData.append("description", description);

    const locationText = (elements.locInput.value || "").trim();
    if (locationText) {
        formData.append("location", locationText);
    } else if (capturedLocation.address) {
        formData.append("location", capturedLocation.address);
    }

    if (capturedLocation.address) {
        formData.append("address", capturedLocation.address);
    }

    try {
        const response = await fetch("/api/complaints", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || `Server error (${response.status})`);
        }

        const newComplaint = data.complaint;
        newlySubmittedComplaint = newComplaint;

        // Prepend to current complaints list
        allComplaints.unshift(newComplaint);
        renderDashboard();

        // Transition to State 7: SUCCESS
        setSubmissionState(SUBMISSION_STATES.SUCCESS);
        showSuccessView(newComplaint);
        showToast("Report submitted successfully with photo and GPS location!", "success");

    } catch (err) {
        console.error("Submission failed:", err);
        setSubmissionState(SUBMISSION_STATES.FAILED);
        elements.formGlobalErrorText.textContent = err.message || "Failed to submit report. Please retry.";
        elements.formGlobalError.style.display = "flex";
        showToast("Submission failed: " + err.message, "error");
    } finally {
        setSubmittingState(false);
    }
}

function showSuccessView(c) {
    elements.reportForm.style.display = "none";
    elements.submissionSuccessView.style.display = "block";
    elements.successReportId.textContent = c.id;

    elements.successMetaChips.innerHTML = "";

    if (c.latitude != null && c.longitude != null) {
        const chip = document.createElement("span");
        chip.className = "chip chip-coords";
        chip.textContent = `📍 ${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`;
        elements.successMetaChips.appendChild(chip);
    }

    if (c.category) {
        const cat = document.createElement("span");
        cat.className = "badge badge-category";
        cat.textContent = c.category;
        elements.successMetaChips.appendChild(cat);
    }

    if (c.severity) {
        elements.successMetaChips.appendChild(createSeverityBadge(c.severity));
    }
}

function resetReportModal() {
    elements.reportForm.reset();
    elements.reportForm.style.display = "block";
    elements.submissionSuccessView.style.display = "none";
    elements.formGlobalError.style.display = "none";
    elements.locationErrorAlert.style.display = "none";
    elements.locationDetailsBar.style.display = "none";
    elements.mapPreviewWrapper.style.display = "none";

    clearFormErrors();
    removeSelectedPhoto();
    capturedLocation = null;
    newlySubmittedComplaint = null;

    if (previewMap) {
        previewMap.remove();
        previewMap = null;
        previewMarker = null;
    }

    setSubmissionState(SUBMISSION_STATES.NO_PHOTO);
    updateCharCounts();
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
            if (response.status === 403) {
                throw new Error("Access restricted: Only municipal officers can update grievance status.");
            }
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

    // Main Card Body: Grid with optional photo thumbnail
    const contentGrid = document.createElement("div");
    contentGrid.className = "card-content-grid";

    if (c.photo_url) {
        const thumb = document.createElement("img");
        thumb.src = c.photo_url;
        thumb.alt = "Issue photo thumbnail";
        thumb.className = "card-photo-thumb";
        thumb.loading = "lazy";
        thumb.onerror = () => { thumb.style.display = "none"; };
        contentGrid.appendChild(thumb);
    }

    const textCol = document.createElement("div");
    textCol.className = "card-text-col";

    // Summary / Title
    const summary = document.createElement("h3");
    summary.className = "card-summary";
    summary.textContent = c.summary || c.description;
    textCol.appendChild(summary);

    // Truncated Description
    if (c.summary && c.summary !== c.description) {
        const desc = document.createElement("p");
        desc.className = "card-description";
        desc.textContent = c.description;
        textCol.appendChild(desc);
    }

    contentGrid.appendChild(textCol);
    card.appendChild(contentGrid);

    // Footer Row: Location, Department, and GPS Tag
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
    footerRow.appendChild(locItem);

    if (c.latitude != null && c.longitude != null) {
        const coordTag = document.createElement("span");
        coordTag.className = "card-coords-tag";
        coordTag.textContent = `GPS: ${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`;
        footerRow.appendChild(coordTag);

        const refLoc = capturedLocation || userCurrentCoords;
        if (refLoc && refLoc.latitude != null && refLoc.longitude != null) {
            const distLabel = calculateDistanceKm(refLoc.latitude, refLoc.longitude, c.latitude, c.longitude);
            if (distLabel) {
                const distTag = document.createElement("span");
                distTag.className = "card-distance-tag";
                distTag.textContent = `📍 ${distLabel}`;
                distTag.title = "Distance from your current location";
                footerRow.appendChild(distTag);
            }
        }
    }

    const deptItem = document.createElement("div");
    deptItem.className = "card-footer-item";
    const deptIcon = document.createElement("span");
    deptIcon.className = "card-footer-icon";
    deptIcon.textContent = "🏢";
    const deptText = document.createElement("span");
    deptText.textContent = c.department || "General Municipal Cell";
    deptItem.appendChild(deptIcon);
    deptItem.appendChild(deptText);
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
// Details Modal Implementation (Phase 5 Enhanced)
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

    if (detailsMap) {
        detailsMap.remove();
        detailsMap = null;
    }
}

function populateDetailsModal(c) {
    elements.detailsIdText.textContent = `Complaint ID: ${c.id || "N/A"}`;
    elements.updateStatusSelect.value = c.status || "Pending";

    // Enforce role-based permission on status updater
    const isCitizen = currentUser && currentUser.role === "citizen";
    if (elements.updateStatusSelect) {
        elements.updateStatusSelect.disabled = isCitizen;
    }
    if (elements.saveStatusBtn) {
        elements.saveStatusBtn.disabled = isCitizen;
        elements.saveStatusBtn.title = isCitizen ? "Status updates are restricted to Municipal Officers" : "";
    }
    if (elements.statusCitizenNotice) {
        elements.statusCitizenNotice.style.display = isCitizen ? "flex" : "none";
    }

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

    // 1. Photo Showcase (if photo exists)
    if (c.photo_url) {
        const photoBox = document.createElement("div");
        photoBox.className = "details-photo-box";
        const photoImg = document.createElement("img");
        photoImg.src = c.photo_url;
        photoImg.alt = `Verified issue photo for report ${c.id}`;
        photoImg.className = "details-photo-img";
        photoBox.appendChild(photoImg);
        elements.detailsBody.appendChild(photoBox);
    }

    // 2. Metadata Grid
    const grid = document.createElement("div");
    grid.className = "details-grid";

    if (c.author_name) {
        grid.appendChild(createMetaItem("Reported By", `${c.author_name} (Citizen)`));
    }
    grid.appendChild(createMetaItem("Location / Landmark", c.location || "N/A"));
    grid.appendChild(createMetaItem("Suggested Department", c.department || "Municipal Cell"));
    grid.appendChild(createMetaItem("Submission Time", formatTimestamp(c.created_at, true)));
    grid.appendChild(createMetaItem("AI Classification Status", c.ai_status === "success" ? "Analyzed with Gemma" : "Unavailable (Manual Review)"));

    if (c.latitude != null && c.longitude != null) {
        grid.appendChild(createMetaItem("GPS Coordinates", `${c.latitude.toFixed(5)}°, ${c.longitude.toFixed(5)}°`));

        const refLoc = capturedLocation || userCurrentCoords;
        if (refLoc && refLoc.latitude != null && refLoc.longitude != null) {
            const distLabel = calculateDistanceKm(refLoc.latitude, refLoc.longitude, c.latitude, c.longitude);
            if (distLabel) {
                grid.appendChild(createMetaItem("Distance From You", distLabel));
            }
        }
    }
    if (c.accuracy) {
        grid.appendChild(createMetaItem("GPS Accuracy", `±${Math.round(c.accuracy)} meters`));
    }
    if (c.address) {
        grid.appendChild(createMetaItem("Resolved Address", c.address));
    }

    elements.detailsBody.appendChild(grid);

    // 3. Leaflet Map in Details Modal (if coordinates exist)
    if (c.latitude != null && c.longitude != null) {
        const mapWrapper = document.createElement("div");
        mapWrapper.className = "details-map-wrapper";

        const mapDiv = document.createElement("div");
        mapDiv.id = "details-map-container";
        mapDiv.className = "details-map-container";
        mapWrapper.appendChild(mapDiv);
        elements.detailsBody.appendChild(mapWrapper);

        setTimeout(() => {
            if (typeof L !== "undefined") {
                if (detailsMap) {
                    detailsMap.remove();
                    detailsMap = null;
                }
                detailsMap = L.map(mapDiv, {
                    center: [c.latitude, c.longitude],
                    zoom: 16,
                    attributionControl: false
                });

                L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                    maxZoom: 19,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
                }).addTo(detailsMap);

                const marker = L.marker([c.latitude, c.longitude]).addTo(detailsMap);
                marker.bindPopup(`<strong>Reported Location</strong><br>ID: ${c.id}<br>${c.location || ""}`).openPopup();

                setTimeout(() => {
                    if (detailsMap) detailsMap.invalidateSize();
                }, 150);
            }
        }, 120);
    }

    // 4. AI Warning if unavailable
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

    // 5. AI Summary
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

    // 6. Recommended Action
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

    // 7. Full Citizen Complaint Description
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
    resetReportModal();
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
    if (elements.descError) elements.descError.textContent = "";
    if (elements.locError) elements.locError.textContent = "";
    if (elements.photoError) elements.photoError.textContent = "";
    if (elements.formGlobalError) elements.formGlobalError.style.display = "none";
}

function updateCharCounts() {
    const descLen = (elements.descInput.value || "").length;
    const locLen = (elements.locInput.value || "").length;
    elements.descCharCount.textContent = `${descLen} / 2000`;
    elements.locCharCount.textContent = `${locLen} / 200`;
}

function handleFormSubmit(e) {
    e.preventDefault();
    submitReport();
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
    elements.submitBtnText.textContent = isSubmitting ? "Submitting Photo & Location..." : "Submit Photo & Verified Location";
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

    // Photo input triggers
    elements.btnCameraTrigger.addEventListener("click", () => elements.photoInputCamera.click());
    elements.btnFileTrigger.addEventListener("click", () => elements.photoInputFile.click());
    elements.btnReplacePhoto.addEventListener("click", () => elements.photoInputFile.click());
    elements.btnRemovePhoto.addEventListener("click", removeSelectedPhoto);

    elements.photoInputFile.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            handlePhotoFileSelected(e.target.files[0]);
        }
    });

    elements.photoInputCamera.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            handlePhotoFileSelected(e.target.files[0]);
        }
    });

    // Drag and drop on photo dropzone
    elements.photoDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        elements.photoDropzone.style.borderColor = "var(--primary)";
    });
    elements.photoDropzone.addEventListener("dragleave", () => {
        elements.photoDropzone.style.borderColor = "#cbd5e1";
    });
    elements.photoDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        elements.photoDropzone.style.borderColor = "#cbd5e1";
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handlePhotoFileSelected(e.dataTransfer.files[0]);
        }
    });

    // Detect Location Button trigger
    elements.btnDetectLocation.addEventListener("click", () => captureCurrentLocation(true));

    // Success Screen Actions
    elements.successViewDetailsBtn.addEventListener("click", () => {
        closeReportModal();
        if (newlySubmittedComplaint) {
            openDetailsModal(newlySubmittedComplaint);
        }
    });

    elements.successNewReportBtn.addEventListener("click", () => {
        resetReportModal();
    });

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

// =====================================================================
// Role-Based Authentication & Session Management
// =====================================================================

async function checkCurrentUser() {
    try {
        const response = await fetch("/api/auth/me");
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user || null;
        } else {
            currentUser = null;
        }
    } catch (e) {
        console.warn("Could not check current user session:", e);
        currentUser = null;
    }
    renderAuthUI();
}

function renderAuthUI() {
    // 1. Sidebar User Widget
    if (elements.sidebarUserContainer) {
        elements.sidebarUserContainer.innerHTML = "";

        if (currentUser) {
            const widget = document.createElement("div");
            widget.className = "sidebar-user-widget";

            const topRow = document.createElement("div");
            topRow.className = "user-widget-top";

            const avatar = document.createElement("div");
            avatar.className = "user-avatar-circle";
            avatar.textContent = (currentUser.name || "U").charAt(0).toUpperCase();

            const info = document.createElement("div");
            info.className = "user-widget-info";

            const name = document.createElement("div");
            name.className = "user-widget-name";
            name.textContent = currentUser.name || "User";
            name.title = currentUser.email || "";

            const roleBadge = document.createElement("div");
            const roleClass = (currentUser.role || "citizen").toLowerCase();
            roleBadge.className = `user-widget-role-badge ${roleClass}`;
            const roleIcon = roleClass === "officer" ? "🛡️" : (roleClass === "admin" ? "👑" : "👤");
            const roleLabel = roleClass === "officer" 
                ? (currentUser.department ? `${currentUser.department} Officer` : "Municipal Officer") 
                : (roleClass === "admin" ? "Director / Admin" : "Verified Citizen");
            roleBadge.textContent = `${roleIcon} ${roleLabel}`;

            info.appendChild(name);
            info.appendChild(roleBadge);
            topRow.appendChild(avatar);
            topRow.appendChild(info);

            const actions = document.createElement("div");
            actions.className = "user-widget-actions";

            const logoutBtn = document.createElement("button");
            logoutBtn.type = "button";
            logoutBtn.className = "btn btn-secondary btn-logout-sidebar";
            logoutBtn.innerHTML = "<span>🚪 Sign Out</span>";
            logoutBtn.addEventListener("click", handleLogout);

            actions.appendChild(logoutBtn);

            widget.appendChild(topRow);
            widget.appendChild(actions);
            elements.sidebarUserContainer.appendChild(widget);
        } else {
            const guestBox = document.createElement("div");
            guestBox.className = "sidebar-user-widget";
            guestBox.style.textAlign = "center";
            guestBox.innerHTML = `
                <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 8px;">
                    Signed in as <strong>Guest</strong>
                </div>
                <a href="/login" class="btn btn-primary btn-block" style="font-size: 0.82rem; padding: 7px 10px; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <span>🔐 Sign In / Officer Portal</span>
                </a>
            `;
            elements.sidebarUserContainer.appendChild(guestBox);
        }
    }

    // 2. Header Auth Chip
    if (elements.headerAuthContainer) {
        elements.headerAuthContainer.innerHTML = "";

        if (currentUser) {
            const chip = document.createElement("div");
            chip.className = "header-user-chip";

            const avatar = document.createElement("div");
            avatar.className = "header-user-avatar";
            avatar.textContent = (currentUser.name || "U").charAt(0).toUpperCase();

            const details = document.createElement("div");
            details.className = "header-user-details";

            const name = document.createElement("span");
            name.className = "header-user-name";
            name.textContent = currentUser.name.split(" ")[0];

            const rolePill = document.createElement("span");
            const roleClass = (currentUser.role || "citizen").toLowerCase();
            rolePill.className = `header-role-pill ${roleClass}`;
            rolePill.textContent = roleClass === "officer" ? "Officer" : (roleClass === "admin" ? "Admin" : "Citizen");

            details.appendChild(name);
            details.appendChild(rolePill);

            chip.appendChild(avatar);
            chip.appendChild(details);

            const logoutIconBtn = document.createElement("button");
            logoutIconBtn.type = "button";
            logoutIconBtn.className = "btn btn-secondary";
            logoutIconBtn.style.padding = "5px 9px";
            logoutIconBtn.style.fontSize = "0.78rem";
            logoutIconBtn.title = "Sign Out";
            logoutIconBtn.textContent = "Sign Out";
            logoutIconBtn.addEventListener("click", handleLogout);

            elements.headerAuthContainer.appendChild(chip);
            elements.headerAuthContainer.appendChild(logoutIconBtn);
        } else {
            const loginLink = document.createElement("a");
            loginLink.href = "/login";
            loginLink.className = "btn-signin-nav";
            loginLink.innerHTML = "<span>🔐 Sign In</span>";
            elements.headerAuthContainer.appendChild(loginLink);
        }
    }
}

async function handleLogout() {
    try {
        const response = await fetch("/api/auth/logout", {
            method: "POST"
        });
        if (response.ok) {
            currentUser = null;
            renderAuthUI();
            showToast("Signed out successfully. You are now in Guest mode.", "info");
            if (activeComplaint) {
                populateDetailsModal(activeComplaint);
            }
        } else {
            showToast("Sign out failed", "error");
        }
    } catch (e) {
        console.error("Logout error:", e);
        showToast("Error signing out", "error");
    }
}

// Start application
document.addEventListener("DOMContentLoaded", () => {
    initializeEventListeners();
    checkCurrentUser();
    loadComplaints();

    // Check user geolocation non-blockingly to show distance on complaints
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userCurrentCoords = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude
                };
                if (allComplaints.length > 0) {
                    renderFilteredComplaints();
                }
            },
            () => { /* User denied or unavailable, silent fallback */ },
            { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
        );
    }
});
