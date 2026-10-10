"""
app.py - Main Flask Application for Civisense MVP
Owner: Member 3 (Backend & Integration)

Endpoints:
- GET /                    : Serves index.html or reports frontend status
- GET /api/complaints       : Returns all stored complaints sorted newest first
- POST /api/complaints      : Submits a new citizen complaint, invokes Gemma AI, stores result
- PATCH /api/complaints/<id>: Updates complaint status (Pending, In Progress, Resolved)

Storage:
- Single JSON file (complaints.json) using safe atomic replace
"""

import os
import json
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import List, Dict, Any, Optional

from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv

# Import the validated AI service from Member 2
from ai_service import analyze_complaint

# Load environment configuration
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Base directory relative to app.py
BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
DEFAULT_STORAGE_PATH = BASE_DIR / "complaints.json"

# Initialize Flask application
app = Flask(
    __name__,
    template_folder=str(TEMPLATES_DIR),
    static_folder=str(STATIC_DIR)
)

# Configuration overrides
app.config["STORAGE_PATH"] = DEFAULT_STORAGE_PATH
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024  # Limit request body to 1MB

# Allowed statuses
ALLOWED_STATUSES = {"Pending", "In Progress", "Resolved"}

# Input constraints
MAX_DESCRIPTION_LEN = 2000
MAX_LOCATION_LEN = 200


# =====================================================================
# Safe JSON Storage Helpers
# =====================================================================

def get_storage_path() -> Path:
    """Returns the resolved Path object for complaints storage."""
    return Path(app.config.get("STORAGE_PATH", DEFAULT_STORAGE_PATH))


def load_complaints() -> List[Dict[str, Any]]:
    """
    Loads complaints from the configured JSON file.
    Initializes missing file as empty list.
    Raises ValueError on corrupted JSON without overwriting data.
    """
    storage_path = get_storage_path()

    if not storage_path.exists():
        logger.info("Storage file %s not found. Initializing empty list.", storage_path)
        try:
            save_complaints([])
        except Exception as err:
            logger.error("Failed to initialize empty storage file: %s", err)
        return []

    try:
        with open(storage_path, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                return []
            data = json.loads(content)
            if not isinstance(data, list):
                logger.error("Storage file root must be a list, found %s", type(data))
                raise ValueError("Corrupted storage file: root element is not a list")
            return data
    except json.JSONDecodeError as err:
        logger.error("Corrupted JSON in %s: %s", storage_path, err)
        raise ValueError(f"Corrupted storage JSON: {err}") from err
    except Exception as err:
        logger.error("Error reading %s: %s", storage_path, err)
        raise


def save_complaints(complaints: List[Dict[str, Any]]) -> None:
    """
    Saves complaints to storage using atomic file replacement.
    Writes to a temporary file in the same directory, then atomically replaces.
    """
    storage_path = get_storage_path()
    storage_dir = storage_path.parent
    storage_dir.mkdir(parents=True, exist_ok=True)

    # Use NamedTemporaryFile in the same directory for atomic cross-platform rename
    temp_file = NamedTemporaryFile("w", dir=str(storage_dir), delete=False, encoding="utf-8")
    try:
        json.dump(complaints, temp_file, ensure_ascii=False, indent=2)
        temp_file.flush()
        temp_file.close()

        # Atomic replace
        os.replace(temp_file.name, str(storage_path))
    except Exception as err:
        if os.path.exists(temp_file.name):
            try:
                os.remove(temp_file.name)
            except OSError:
                pass
        logger.error("Failed to save complaints to %s: %s", storage_path, err)
        raise IOError(f"Could not write storage file: {err}") from err


# =====================================================================
# Routes
# =====================================================================

@app.route("/", methods=["GET"])
def index():
    """
    Serves templates/index.html if available.
    Reports frontend readiness status cleanly.
    """
    index_path = TEMPLATES_DIR / "index.html"
    if index_path.exists():
        return render_template("index.html")
    return (
        "<h1>Civisense API</h1>"
        "<p>Frontend template not implemented yet. The API is active at <code>/api/complaints</code>.</p>",
        200
    )


@app.route("/api/complaints", methods=["GET"])
def get_complaints():
    """
    Returns all stored complaints sorted newest first.
    """
    try:
        complaints = load_complaints()
        # Sort newest first using created_at (descending)
        sorted_complaints = sorted(
            complaints,
            key=lambda c: c.get("created_at", ""),
            reverse=True
        )
        return jsonify({
            "success": True,
            "complaints": sorted_complaints
        }), 200
    except ValueError as err:
        return jsonify({
            "success": False,
            "error": "Storage data error. Please contact administrator."
        }), 500
    except Exception as err:
        logger.exception("Unexpected error in GET /api/complaints")
        return jsonify({
            "success": False,
            "error": "Internal server error"
        }), 500


@app.route("/api/complaints", methods=["POST"])
def create_complaint():
    """
    Accepts a new citizen complaint, validates inputs, invokes Gemma AI,
    persists complaint record, and returns HTTP 201.
    """
    if not request.is_json:
        return jsonify({
            "success": False,
            "error": "Invalid request: Content-Type must be application/json"
        }), 400

    try:
        payload = request.get_json(silent=False)
    except Exception:
        return jsonify({
            "success": False,
            "error": "Malformed JSON in request body"
        }), 400

    if not isinstance(payload, dict):
        return jsonify({
            "success": False,
            "error": "Request body must be a JSON object"
        }), 400

    raw_description = payload.get("description")
    raw_location = payload.get("location")

    # Validate description
    if not isinstance(raw_description, str) or not raw_description.strip():
        return jsonify({
            "success": False,
            "error": "Field 'description' is required and must be a non-empty string"
        }), 400

    # Validate location
    if not isinstance(raw_location, str) or not raw_location.strip():
        return jsonify({
            "success": False,
            "error": "Field 'location' is required and must be a non-empty string"
        }), 400

    description = raw_description.strip()[:MAX_DESCRIPTION_LEN]
    location = raw_location.strip()[:MAX_LOCATION_LEN]

    # Invoke Gemma AI service safely
    try:
        ai_result = analyze_complaint(description, location)
    except Exception as exc:
        logger.error("Exception invoking analyze_complaint: %s", exc)
        ai_result = {
            "category": "Other",
            "severity": "Medium",
            "department": "Municipal Grievance Cell (Manual Triage)",
            "summary": description[:150],
            "recommended_action": "Manual review required: AI service error.",
            "ai_status": "unavailable"
        }

    # Validate that ai_result is a dictionary with expected keys
    if not isinstance(ai_result, dict):
        logger.error("AI service returned non-dict response: %s", type(ai_result))
        ai_result = {
            "category": "Other",
            "severity": "Medium",
            "department": "Municipal Grievance Cell (Manual Triage)",
            "summary": description[:150],
            "recommended_action": "Manual review required: AI service format error.",
            "ai_status": "unavailable"
        }

    # Generate complaint ID and timestamp
    complaint_id = f"c-{uuid.uuid4().hex[:10]}"
    created_at = datetime.now(timezone.utc).isoformat()

    complaint = {
        "id": complaint_id,
        "description": description,
        "location": location,
        "category": ai_result.get("category", "Other"),
        "severity": ai_result.get("severity", "Medium"),
        "department": ai_result.get("department", "Municipal Grievance Cell (Manual Triage)"),
        "summary": ai_result.get("summary", description[:150]),
        "recommended_action": ai_result.get("recommended_action", "Manual review required."),
        "status": "Pending",  # Initial status is ALWAYS Pending, never auto-resolved
        "ai_status": ai_result.get("ai_status", "unavailable"),
        "created_at": created_at
    }

    # Save to storage
    try:
        complaints = load_complaints()
        complaints.append(complaint)
        save_complaints(complaints)
    except Exception as err:
        logger.exception("Failed to persist new complaint")
        return jsonify({
            "success": False,
            "error": "Failed to save complaint to storage"
        }), 500

    return jsonify({
        "success": True,
        "complaint": complaint
    }), 201


@app.route("/api/complaints/<complaint_id>", methods=["PATCH"])
def update_complaint_status(complaint_id: str):
    """
    Updates the status of an existing complaint.
    Allowed statuses: Pending, In Progress, Resolved.
    """
    if not request.is_json:
        return jsonify({
            "success": False,
            "error": "Invalid request: Content-Type must be application/json"
        }), 400

    try:
        payload = request.get_json(silent=False)
    except Exception:
        return jsonify({
            "success": False,
            "error": "Malformed JSON in request body"
        }), 400

    if not isinstance(payload, dict):
        return jsonify({
            "success": False,
            "error": "Request body must be a JSON object"
        }), 400

    new_status = payload.get("status")
    if not isinstance(new_status, str) or new_status.strip() not in ALLOWED_STATUSES:
        return jsonify({
            "success": False,
            "error": f"Invalid status '{new_status}'. Allowed values are: {sorted(list(ALLOWED_STATUSES))}"
        }), 400

    new_status = new_status.strip()

    try:
        complaints = load_complaints()
    except Exception as err:
        logger.exception("Failed to load complaints during status update")
        return jsonify({
            "success": False,
            "error": "Storage data error"
        }), 500

    target_complaint = None
    for item in complaints:
        if item.get("id") == complaint_id:
            item["status"] = new_status
            target_complaint = item
            break

    if target_complaint is None:
        return jsonify({
            "success": False,
            "error": f"Complaint with ID '{complaint_id}' not found"
        }), 404

    try:
        save_complaints(complaints)
    except Exception as err:
        logger.exception("Failed to save updated complaints list")
        return jsonify({
            "success": False,
            "error": "Failed to save updated status"
        }), 500

    return jsonify({
        "success": True,
        "complaint": target_complaint
    }), 200


# =====================================================================
# Server Entry Point
# =====================================================================

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    debug_mode = os.getenv("FLASK_DEBUG", "True").lower() in ("true", "1", "t")
    print(f"Starting Civisense Flask backend on http://127.0.0.1:{port} (Debug: {debug_mode})")
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
