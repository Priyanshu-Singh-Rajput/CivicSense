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

from flask import Flask, request, jsonify, render_template, send_from_directory, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
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
DEFAULT_USERS_PATH = BASE_DIR / "users.json"
DEFAULT_UPLOAD_FOLDER = BASE_DIR / "uploads"

# Ensure upload directory exists
DEFAULT_UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

# Initialize Flask application
app = Flask(
    __name__,
    template_folder=str(TEMPLATES_DIR),
    static_folder=str(STATIC_DIR)
)

# Configuration overrides & Session security
app.secret_key = os.getenv("SECRET_KEY", "civisense-portal-session-secret-2026")
app.config["STORAGE_PATH"] = DEFAULT_STORAGE_PATH
app.config["USERS_PATH"] = DEFAULT_USERS_PATH
app.config["UPLOAD_FOLDER"] = DEFAULT_UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # Limit request body to 16MB for photos

# Allowed statuses
ALLOWED_STATUSES = {"Pending", "In Progress", "Resolved"}

# Input constraints
MAX_DESCRIPTION_LEN = 2000
MAX_LOCATION_LEN = 200
MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024  # 10MB image limit
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


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
# User Authentication Storage Helpers
# =====================================================================

def get_users_path() -> Path:
    """Returns resolved Path object for users storage."""
    return Path(app.config.get("USERS_PATH", DEFAULT_USERS_PATH))


def load_users() -> List[Dict[str, Any]]:
    """Loads all registered users from JSON storage."""
    users_path = get_users_path()
    if not users_path.exists():
        return []
    try:
        with open(users_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as err:
        logger.error("Error reading users file %s: %s", users_path, err)
        return []


def save_users(users: List[Dict[str, Any]]) -> None:
    """Saves user list atomically to disk."""
    users_path = get_users_path()
    users_dir = users_path.parent
    users_dir.mkdir(parents=True, exist_ok=True)
    temp_file = NamedTemporaryFile("w", dir=str(users_dir), delete=False, encoding="utf-8")
    try:
        json.dump(users, temp_file, ensure_ascii=False, indent=2)
        temp_file.flush()
        temp_file.close()
        os.replace(temp_file.name, str(users_path))
    except Exception as err:
        if os.path.exists(temp_file.name):
            try:
                os.remove(temp_file.name)
            except OSError:
                pass
        logger.error("Failed to save users to %s: %s", users_path, err)
        raise IOError(f"Could not write users storage: {err}") from err


def find_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Looks up a user record by email (case-insensitive)."""
    clean_email = email.strip().lower()
    for user in load_users():
        if user.get("email", "").strip().lower() == clean_email:
            return user
    return None


# =====================================================================
# Image and Geolocation Validation Helpers (Phase 5)
# =====================================================================

def validate_and_save_image(file_storage) -> tuple[Optional[str], Optional[str]]:
    """
    Validates uploaded image file extension, size, and binary signature.
    Saves the file to UPLOAD_FOLDER with a unique secure filename.
    Returns (saved_filename, error_message).
    """
    if not file_storage or not file_storage.filename:
        return None, "Field 'photo' is required and must contain a valid file"

    filename = file_storage.filename
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return None, f"Unsupported image extension '{ext}'. Allowed formats: JPEG (.jpg, .jpeg), PNG (.png), WebP (.webp)"

    # Inspect file size
    file_storage.seek(0, os.SEEK_END)
    file_size = file_storage.tell()
    file_storage.seek(0)

    if file_size == 0:
        return None, "Uploaded image is empty (0 bytes)"
    if file_size > MAX_IMAGE_FILE_SIZE:
        max_mb = MAX_IMAGE_FILE_SIZE // (1024 * 1024)
        return None, f"Uploaded image exceeds maximum size limit of {max_mb}MB"

    # Inspect header magic bytes to verify genuine image content
    header = file_storage.read(32)
    file_storage.seek(0)

    is_valid_format = False
    if ext in {".jpg", ".jpeg"} and header.startswith(b"\xff\xd8\xff"):
        is_valid_format = True
    elif ext == ".png" and header.startswith(b"\x89PNG\r\n\x1a\n"):
        is_valid_format = True
    elif ext == ".webp" and header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP":
        is_valid_format = True

    if not is_valid_format:
        return None, "File content does not match a valid JPEG, PNG, or WebP image"

    # Deep verification with PIL to prevent malicious polyglots or corrupt files
    try:
        from PIL import Image
        with Image.open(file_storage) as img:
            img.verify()
        file_storage.seek(0)
    except Exception as img_err:
        logger.warning("Image verification with PIL failed: %s", img_err)
        return None, "Image file is corrupted or could not be decoded"

    # Generate secure unique filename preventing path traversal
    safe_filename = f"report_{uuid.uuid4().hex[:16]}{ext}"
    upload_dir = Path(app.config.get("UPLOAD_FOLDER", DEFAULT_UPLOAD_FOLDER))
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest_path = upload_dir / safe_filename

    try:
        file_storage.save(str(dest_path))
        # Ensure file permissions are read-write for owner, read-only for others (not executable)
        os.chmod(str(dest_path), 0o644)
    except Exception as err:
        logger.error("Failed to save image file to %s: %s", dest_path, err)
        return None, f"Server error saving uploaded image: {err}"

    return safe_filename, None


def validate_coordinates(lat_val: Any, lon_val: Any, acc_val: Any) -> tuple[Optional[float], Optional[float], Optional[float], Optional[str]]:
    """
    Validates latitude (-90 to 90), longitude (-180 to 180), and accuracy (> 0).
    Returns (lat, lon, accuracy, error_message).
    """
    if lat_val is None or str(lat_val).strip() == "":
        return None, None, None, "Field 'latitude' is required"
    if lon_val is None or str(lon_val).strip() == "":
        return None, None, None, "Field 'longitude' is required"
    if acc_val is None or str(acc_val).strip() == "":
        return None, None, None, "Field 'accuracy' is required"

    try:
        lat = float(lat_val)
    except (ValueError, TypeError):
        return None, None, None, "Field 'latitude' must be a valid number"

    try:
        lon = float(lon_val)
    except (ValueError, TypeError):
        return None, None, None, "Field 'longitude' must be a valid number"

    try:
        acc = float(acc_val)
    except (ValueError, TypeError):
        return None, None, None, "Field 'accuracy' must be a valid number"

    if not (-90.0 <= lat <= 90.0):
        return None, None, None, f"Latitude {lat} is out of bounds (must be between -90 and 90 degrees)"

    if not (-180.0 <= lon <= 180.0):
        return None, None, None, f"Longitude {lon} is out of bounds (must be between -180 and 180 degrees)"

    if acc <= 0:
        return None, None, None, f"Accuracy must be a positive number in meters, got {acc}"

    return lat, lon, acc, None


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


@app.route("/login", methods=["GET"])
def login_page():
    """
    Serves templates/login.html for role-based citizen & officer authentication.
    """
    login_path = TEMPLATES_DIR / "login.html"
    if login_path.exists():
        return render_template("login.html")
    return "<h1>Civisense Login</h1><p>Login page template not found.</p>", 404


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    """Returns current session user profile or guest status."""
    user = session.get("user")
    if user:
        return jsonify({"authenticated": True, "user": user}), 200
    return jsonify({"authenticated": False, "user": None}), 200


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Authenticates citizen or municipal officer credentials."""
    if not request.is_json:
        return jsonify({"success": False, "error": "Request body must be valid JSON"}), 400

    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    role = data.get("role")

    if not email or not password:
        return jsonify({"success": False, "error": "Email and password are required."}), 400

    user = find_user_by_email(email)
    if not user:
        return jsonify({"success": False, "error": "Invalid email or password. Please check your credentials."}), 401

    pwd_hash = user.get("password_hash")
    if not pwd_hash or not check_password_hash(pwd_hash, password):
        return jsonify({"success": False, "error": "Invalid email or password. Please check your credentials."}), 401

    if role and user.get("role") != role:
        expected_title = "Municipal Officer" if role == "officer" else "Citizen Reporter"
        return jsonify({
            "success": False,
            "error": f"Role Mismatch: This account is not registered as a {expected_title}."
        }), 403

    user_session = {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "department": user.get("department", ""),
        "badge_id": user.get("badge_id", ""),
        "phone": user.get("phone", "")
    }
    session["user"] = user_session

    return jsonify({
        "success": True,
        "message": f"Welcome back, {user['name']}!",
        "user": user_session
    }), 200


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Logs out current user and clears session."""
    session.pop("user", None)
    return jsonify({"success": True, "message": "Signed out of portal successfully."}), 200


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    """Registers a new Citizen account."""
    if not request.is_json:
        return jsonify({"success": False, "error": "Request body must be valid JSON"}), 400

    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    phone = data.get("phone", "").strip()

    if not name or len(name) < 2:
        return jsonify({"success": False, "error": "Full Name must be at least 2 characters."}), 400
    if not email or "@" not in email:
        return jsonify({"success": False, "error": "A valid email address is required."}), 400
    if not password or len(password) < 6:
        return jsonify({"success": False, "error": "Password must be at least 6 characters."}), 400

    if find_user_by_email(email):
        return jsonify({"success": False, "error": "An account with this email address already exists."}), 409

    users = load_users()
    new_user = {
        "id": f"u-citizen-{uuid.uuid4().hex[:8]}",
        "email": email,
        "password_hash": generate_password_hash(password),
        "name": name,
        "role": "citizen",
        "phone": phone
    }
    users.append(new_user)
    save_users(users)

    user_session = {
        "id": new_user["id"],
        "name": new_user["name"],
        "email": new_user["email"],
        "role": "citizen",
        "department": "",
        "badge_id": "",
        "phone": phone
    }
    session["user"] = user_session

    return jsonify({
        "success": True,
        "message": "Citizen registration successful! Welcome to Civisense.",
        "user": user_session
    }), 201


@app.route("/uploads/<path:filename>", methods=["GET"])
def uploaded_file(filename: str):
    """
    Serves uploaded images safely from the uploads directory.
    Uses send_from_directory to automatically prevent directory traversal.
    """
    upload_dir = Path(app.config.get("UPLOAD_FOLDER", DEFAULT_UPLOAD_FOLDER))
    return send_from_directory(str(upload_dir), filename)


@app.route("/api/reverse-geocode", methods=["GET"])
def reverse_geocode():
    """
    Reverse geocodes latitude & longitude into a human-readable address using OSM Nominatim.
    Adheres strictly to Nominatim usage policy (descriptive User-Agent, timeout, non-blocking fallback).
    """
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"success": False, "error": "Missing lat or lon query parameter"}), 400

    try:
        lat_f = float(lat)
        lon_f = float(lon)
        if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
            return jsonify({"success": False, "error": "Coordinates out of bounds"}), 400
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Invalid coordinate format"}), 400

    import urllib.request

    url = f"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat_f}&lon={lon_f}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "CivisenseCivicApp/1.0 (https://civisense.local; civictech@civisense.org)",
            "Accept": "application/json"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            address = data.get("display_name")
            return jsonify({
                "success": True,
                "address": address or "Address details unavailable",
                "raw": data.get("address", {})
            }), 200
    except Exception as err:
        logger.warning("Nominatim reverse geocoding lookup failed: %s", err)
        return jsonify({
            "success": False,
            "error": f"Reverse geocoding unavailable: {str(err)}"
        }), 200


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
    Supports both:
    - Phase 5 multipart/form-data: photo, latitude, longitude, accuracy, description, location
    - Phases 1-4 application/json: description, location
    """
    content_type = request.content_type or ""
    is_multipart = "multipart/form-data" in content_type
    is_json = request.is_json

    if not is_multipart and not is_json:
        return jsonify({
            "success": False,
            "error": "Invalid request: Content-Type must be multipart/form-data or application/json"
        }), 400

    photo_url = None
    photo_filename = None
    lat = None
    lon = None
    accuracy = None
    address = None

    if is_multipart:
        # Phase 5: Photo + Location submission
        if "photo" not in request.files or not request.files["photo"].filename:
            return jsonify({
                "success": False,
                "error": "Field 'photo' is required"
            }), 400

        photo_file = request.files["photo"]
        saved_filename, img_err = validate_and_save_image(photo_file)
        if img_err:
            return jsonify({
                "success": False,
                "error": img_err
            }), 400

        # Validate coordinates & accuracy
        raw_lat = request.form.get("latitude")
        raw_lon = request.form.get("longitude")
        raw_acc = request.form.get("accuracy")

        lat, lon, accuracy, coord_err = validate_coordinates(raw_lat, raw_lon, raw_acc)
        if coord_err:
            # Clean up the saved file to avoid orphaned file
            upload_dir = Path(app.config.get("UPLOAD_FOLDER", DEFAULT_UPLOAD_FOLDER))
            cleanup_file = upload_dir / saved_filename
            if cleanup_file.exists():
                try:
                    cleanup_file.unlink()
                except Exception:
                    pass
            return jsonify({
                "success": False,
                "error": coord_err
            }), 400

        photo_filename = saved_filename
        photo_url = f"/uploads/{saved_filename}"
        address = (request.form.get("address") or "").strip() or None

        raw_desc = (request.form.get("description") or "").strip()
        raw_loc = (request.form.get("location") or "").strip()

        if raw_desc:
            description = raw_desc[:MAX_DESCRIPTION_LEN]
        else:
            description = f"Civic report submitted via photo at coordinates ({lat:.5f}, {lon:.5f})"

        if raw_loc:
            location = raw_loc[:MAX_LOCATION_LEN]
        elif address:
            location = address[:MAX_LOCATION_LEN]
        else:
            location = f"GPS: {lat:.5f}, {lon:.5f}"

    else:
        # Phase 1-4 JSON submission
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

    # Attach authenticated author if present
    curr_user = session.get("user")
    author_id = curr_user.get("id") if curr_user else None
    author_name = curr_user.get("name") if curr_user else "Citizen / Public Reporter"

    complaint = {
        "id": complaint_id,
        "description": description,
        "location": location,
        "photo_url": photo_url,
        "photo_filename": photo_filename,
        "latitude": lat,
        "longitude": lon,
        "accuracy": accuracy,
        "address": address,
        "category": ai_result.get("category", "Other"),
        "severity": ai_result.get("severity", "Medium"),
        "department": ai_result.get("department", "Municipal Grievance Cell (Manual Triage)"),
        "summary": ai_result.get("summary", description[:150]),
        "recommended_action": ai_result.get("recommended_action", "Manual review required."),
        "status": "Pending",  # Initial status is ALWAYS Pending, never auto-resolved
        "ai_status": ai_result.get("ai_status", "unavailable"),
        "author_id": author_id,
        "author_name": author_name,
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
    Restricted: Citizens cannot update complaint status; only Municipal Officers can.
    """
    # Role-based restriction: Citizens cannot update grievance status
    curr_user = session.get("user")
    if curr_user and curr_user.get("role") == "citizen":
        return jsonify({
            "success": False,
            "error": "Unauthorized: Only Municipal Officers are authorized to update complaint status."
        }), 403

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
            if curr_user:
                item["updated_by"] = curr_user.get("name")
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
